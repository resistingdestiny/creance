import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { hashscanUrl } from '@creance/client';
import { Contract, JsonRpcProvider } from 'ethers';
import type { Pool } from 'pg';

import { EthersChainGateway } from '../../../src/chain/cover-pool.js';
import { loadApiConfig, type ApiConfig } from '../../../src/config.js';
import { seriesNamed } from '../series-argument.js';
import { createPool } from '../../../src/db/postgres.js';
import {
  COVER,
  INVESTOR_ROLES,
  PACKETS,
  coverProblems,
  emptyRecord,
  inUnits,
  packetsNeedingCover,
  parseBoundPolicy,
  stagesToRun,
  type SeedRecord,
  type Stage,
} from './plan.js';
import { SCENARIO, runtime, timecode } from './scenario.js';

/// `pnpm demo:seed`
///
/// Everything DESIGN.md section 7 needs to be true before a camera is switched
/// on, made true against Hedera testnet and then read back.
///
/// It composes the commands that already exist rather than reimplementing any
/// of them: `testnet:bind-backdated` binds the cover, `ats:issue` and
/// `coupons:pay` put the noteholders on the note and in the vault, and the
/// Adjuster's own script renders the two letters. Each of those is already
/// idempotent, so this is too: a second run binds nothing, issues nothing and
/// pays nothing, which is the run that matters on video day.
///
/// "From a clean state" means a fresh local database and the testnet resources
/// that are already there. The accounts, the tokens, the topics, the contracts
/// and the series are shared and are not rebuilt: `pnpm hedera:setup` and
/// `pnpm contracts:deploy` own those and both refuse to do anything twice. See
/// docs/DECISIONS.md.
///
///     pnpm demo:seed                 every stage, in order
///     pnpm demo:seed status          read the world and change none of it
///     pnpm demo:seed policies        bind the two claimable policies
///     pnpm demo:seed investors       the note holdings and the vault positions
///     pnpm demo:seed packets         render, fingerprint and window check
///     pnpm demo:seed verify          read it all back and print the id block
///     pnpm demo:seed --plan          print what a run would do and stop
///     pnpm demo:seed scenario        print the shot list this seed serves
///
/// It writes to testnet and to the database, so it is a command and never part
/// of `pnpm test`.

const ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));
const RECORD = `${ROOT}var/demo/seed.json`;
const FIXTURES = `${ROOT}apps/adjuster/fixtures/`;

/// The month the demonstration keeps in hand. The proof run of 5 September
/// settled 2025-01 to 2026-04 and stopped, so 2026-05 is the second opening
/// that tops the reserve up on camera. Once it is submitted it cannot be
/// submitted again, so the seed reports it and never spends it.
const TOP_UP_PERIOD = 202605;

const RESERVE_ABI = ['function reservedOf(bytes32 seriesId) view returns (uint256)'];

interface Context {
  config: ApiConfig;
  chain: EthersChainGateway;
  vault: Contract;
  pool: Pool;
  record: SeedRecord;
  series: NonNullable<ApiConfig['series'][number]>;
  save: () => void;
}

// ------------------------------------------------------------------- helpers

function readRecord(network: string): SeedRecord {
  if (!existsSync(RECORD)) return emptyRecord(network);
  return JSON.parse(readFileSync(RECORD, 'utf8')) as SeedRecord;
}

function writeRecordFile(record: SeedRecord): void {
  mkdirSync(dirname(RECORD), { recursive: true });
  writeFileSync(RECORD, `${JSON.stringify(record, null, 2)}\n`);
}

/**
 * Run one of the repository's own commands and keep its output.
 *
 * The output is echoed as it arrives, because these are slow chain commands and
 * an operator watching a black screen assumes it hung, and it is kept because
 * the bind command's last block is where the new policy id is.
 */
function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] });
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      output += chunk;
      process.stdout.write(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(`${command} ${args.join(' ')} exited ${String(code)}`));
    });
  });
}

function stage(context: Context, name: Stage, note: string): void {
  context.record.stages[name] = { at: new Date().toISOString(), note };
  context.save();
}

interface PolicyRow {
  policy_id: string;
  status: string;
  claims_payable_from: string;
  ends_at: string;
  wallet: string;
  wallet_evm: string;
  cover_limit: string;
  nft_serial: string | null;
  bind_tx_id: string | null;
  claims: string;
}

async function policyRow(pool: Pool, policyId: string): Promise<PolicyRow | undefined> {
  const rows = await pool.query<PolicyRow>(
    `SELECT p.policy_id, p.status, to_char(p.claims_payable_from, 'YYYY-MM-DD') AS claims_payable_from,
            p.ends_at, p.wallet, p.wallet_evm, p.cover_limit::text AS cover_limit,
            p.nft_serial::text AS nft_serial, p.bind_tx_id,
            (SELECT count(*) FROM claims c WHERE c.policy_id = p.policy_id)::text AS claims
       FROM policies p WHERE p.policy_id = $1`,
    [policyId],
  );
  return rows.rows[0];
}

/// Cover a packet can still be claimed on: it is in the database, the chain has
/// not paid or expired it, and nobody has claimed on it yet. One claim per
/// nullifier per series, so a policy with a claim against it is spent whichever
/// way that claim went.
const CLAIMABLE = new Set(['bound', 'active', 'claims_open']);

function isUsable(row: PolicyRow | undefined): boolean {
  return row !== undefined && CLAIMABLE.has(row.status) && row.claims === '0';
}

function accountOf(config: ApiConfig, role: string): { accountId: string; evmAddress: string } {
  const resources = JSON.parse(
    readFileSync(`${ROOT}docs/hedera.testnet.json`, 'utf8'),
  ) as { accounts: Record<string, { accountId: string; evmAddress: string }> };
  const account = resources.accounts[role];
  if (account === undefined) throw new Error(`docs/hedera.testnet.json has no ${role}`);
  return account;
}

// -------------------------------------------------------------------- status

async function status(context: Context): Promise<void> {
  const { config, chain, series } = context;
  const state = await chain.seriesState(series.seriesId);
  const reserved = (await context.vault.getFunction('reservedOf')(series.seriesId)) as bigint;
  const decimals = config.settlementToken.decimals;

  console.log(`  series            ${series.label} ${series.groupKey}`);
  console.log(`  status            ${state.status}`);
  console.log(`  activeExposure    ${inUnits(state.activeExposure, decimals)} TUSD`);
  console.log(`  reserved          ${inUnits(reserved, decimals)} TUSD`);
  console.log(`  principal left    ${inUnits(state.principalRemaining, decimals)} TUSD`);
  console.log(`  lastObservedMonth ${state.lastObservedMonth}`);
  console.log(
    `  claim window      ${state.windowEndsAt === 0 ? 'none open' : new Date(state.windowEndsAt * 1000).toISOString()}`,
  );

  const counted = await context.pool.query<{ policies: string; claims: string }>(
    `SELECT (SELECT count(*) FROM policies WHERE series_id = $1)::text AS policies,
            (SELECT count(*) FROM claims WHERE series_id = $1)::text AS claims`,
    [series.label],
  );
  const counts = counted.rows[0];
  console.log(`  database          ${counts?.policies ?? '0'} policies, ${counts?.claims ?? '0'} claims`);

  for (const plan of PACKETS) {
    const held = context.record.policies.find((policy) => policy.packet === plan.packet);
    const row = held === undefined ? undefined : await policyRow(context.pool, held.policyId);
    console.log(
      `  packet ${plan.packet}          ${
        isUsable(row) ? `${held?.policyId ?? ''} ready` : 'no cover to claim on yet'
      }`,
    );
  }

  if (state.lastObservedMonth >= TOP_UP_PERIOD) {
    console.log(
      `  top-up month      ${TOP_UP_PERIOD} is already observed, so the reserve cannot be topped up again`,
    );
  } else {
    console.log(`  top-up month      ${TOP_UP_PERIOD} is unspent, so shot 5 opens a month for real`);
  }
  stage(context, 'status', `${state.status}, reserved ${reserved.toString()}`);
}

// ------------------------------------------------------------------ policies

async function policies(context: Context): Promise<void> {
  const usable = new Map<string, boolean>();
  for (const policy of context.record.policies) {
    usable.set(policy.policyId, isUsable(await policyRow(context.pool, policy.policyId)));
  }
  const needed = packetsNeedingCover(context.record, (id) => usable.get(id) === true);
  if (needed.length === 0) {
    console.log('  both packets already have cover to claim on, nothing bound');
    stage(context, 'policies', 'nothing to do');
    return;
  }

  for (const plan of needed) {
    console.log(`  binding cover for packet ${plan.packet} on ${plan.role}`);
    const output = await run('pnpm', [
      '--filter',
      '@creance/api',
      'testnet:bind-backdated',
      '--holder',
      plan.role,
      '--start',
      COVER.startAt,
      '--limit',
      COVER.limit,
      '--premium',
      COVER.premium,
    ]);
    const bound = parseBoundPolicy(output);
    const account = accountOf(context.config, plan.role);
    context.record.policies = [
      ...context.record.policies.filter((policy) => policy.packet !== plan.packet),
      {
        role: plan.role,
        packet: plan.packet,
        policyId: bound.policyId,
        accountId: account.accountId,
        address: account.evmAddress,
        startAt: COVER.startAt,
        claimsPayableFrom: bound.claimsPayableFrom ?? '',
        limit: COVER.limit,
        ...(bound.bindTx === undefined ? {} : { bindTx: bound.bindTx }),
        ...(bound.nftSerial === undefined ? {} : { nftSerial: bound.nftSerial }),
      },
    ];
    context.save();
  }
  stage(context, 'policies', `${needed.length} bound`);
}

// ----------------------------------------------------------------- investors

async function investors(context: Context): Promise<void> {
  // Both are record driven and refuse to repeat themselves, so this is the
  // cheapest way to guarantee the investor screens have something behind them.
  await run('pnpm', ['ats:issue']);
  await run('pnpm', ['coupons:pay']);

  const deployment = JSON.parse(
    readFileSync(`${ROOT}contracts/deployments/testnet.json`, 'utf8'),
  ) as { series?: { label: string; ats?: { note?: { address?: string } } }[] };
  // The series the record carries for the one this run is seeding, which is
  // the head of the list unless `--series` named another.
  const note = deployment.series?.find((entry) => entry.label === context.series.label)?.ats?.note
    ?.address;
  context.record.investors = INVESTOR_ROLES.map((role) => {
    const account = accountOf(context.config, role);
    return {
      role,
      accountId: account.accountId,
      address: account.evmAddress,
      ...(note === undefined ? {} : { note }),
    };
  });
  for (const investor of context.record.investors) {
    console.log(`  ${investor.role} ${investor.accountId} ${investor.address}`);
  }
  stage(context, 'investors', `${context.record.investors.length} noteholders`);
}

// ------------------------------------------------------------------- packets

async function packets(context: Context): Promise<void> {
  const missing = PACKETS.filter((plan) => !existsSync(`${FIXTURES}${plan.document}`));
  if (missing.length > 0) {
    console.log('  the letters are not rendered yet');
    await run('pnpm', ['--filter', '@creance/adjuster', 'fixtures']);
  }

  const state = await context.chain.seriesState(context.series.seriesId);
  const windowEndsAt = new Date(state.windowEndsAt * 1000);
  const staged: SeedRecord['packets'] = [];
  const problems: string[] = [];

  for (const plan of PACKETS) {
    const bytes = readFileSync(`${FIXTURES}${plan.document}`);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (sha256 !== plan.sha256) {
      problems.push(`${plan.document} is not the committed letter: ${sha256}`);
    }
    const held = context.record.policies.find((policy) => policy.packet === plan.packet);
    if (held === undefined) {
      problems.push(`packet ${plan.packet} has no cover: run the policies stage first`);
      continue;
    }
    const row = await policyRow(context.pool, held.policyId);
    if (row === undefined) {
      problems.push(`${held.policyId} is not in this database`);
      continue;
    }
    problems.push(
      ...coverProblems(
        plan,
        { claimsPayableFrom: row.claims_payable_from, endsAt: row.ends_at },
        windowEndsAt,
        new Date(),
      ),
    );
    // The loss window itself is the chain's answer and never recomputed here.
    const separationPeriod =
      Number(plan.separationDate.slice(0, 4)) * 100 + Number(plan.separationDate.slice(5, 7));
    const answer = await context.chain.isInLossWindow(context.series.seriesId, separationPeriod);
    if (!answer.inWindow) {
      problems.push(`${separationPeriod} is not in the loss window CoverPool reports`);
    }
    console.log(
      `  packet ${plan.packet}  ${plan.employer}, ${plan.separationDate}, ${plan.outcome}s`,
    );
    console.log(`           ${held.policyId} ${row.status}, payable from ${row.claims_payable_from}`);
    console.log(`           ${plan.document} ${bytes.length} bytes sha256:${sha256}`);
    console.log(
      `           pnpm --filter @creance/api testnet:claim --policy ${held.policyId} --packet ${plan.packet} --holder ${plan.role}`,
    );
    staged.push({ packet: plan.packet, policyId: held.policyId, sha256, bytes: bytes.length });
  }

  context.record.packets = staged;
  context.save();
  if (problems.length > 0) {
    for (const problem of problems) console.log(`  PROBLEM ${problem}`);
    throw new Error(`${problems.length} problems would stop a take`);
  }
  stage(context, 'packets', `${staged.length} staged`);
}

// -------------------------------------------------------------------- verify

async function verify(context: Context): Promise<void> {
  const { config, series } = context;
  const state = await context.chain.seriesState(series.seriesId);
  const reserved = (await context.vault.getFunction('reservedOf')(series.seriesId)) as bigint;
  const decimals = config.settlementToken.decimals;
  const needed = BigInt(COVER.limit);

  console.log('');
  console.log('the demonstration, as it now stands on testnet');
  console.log('');
  console.log(`  series        ${series.label}  ${hashscanUrl('contract', config.coverPoolAddress)}`);
  console.log(`  vault         ${hashscanUrl('contract', config.vaultAddress)}`);
  console.log(`  settlement    ${config.settlementToken.tokenId}  ${hashscanUrl('token', config.settlementToken.tokenId)}`);
  console.log(`  policy nft    ${config.policyNftTokenId}  ${hashscanUrl('token', config.policyNftTokenId)}`);
  console.log(`  index topic   ${config.indexTopicId}  ${hashscanUrl('topic', config.indexTopicId)}`);
  console.log(`  payments      ${config.paymentsTopicId}  ${hashscanUrl('topic', config.paymentsTopicId)}`);
  console.log(`  claims        ${config.claimsTopicId}  ${hashscanUrl('topic', config.claimsTopicId)}`);
  console.log('');
  for (const plan of PACKETS) {
    const held = context.record.policies.find((policy) => policy.packet === plan.packet);
    if (held === undefined) continue;
    console.log(`  packet ${plan.packet}      ${held.policyId}`);
    console.log(`    holder      ${held.role} ${held.accountId}  ${hashscanUrl('account', held.accountId)}`);
    console.log(`    cover       ${inUnits(held.limit, decimals)} TUSD from ${held.startAt}, claimable ${held.claimsPayableFrom}`);
    if (held.bindTx !== undefined) console.log(`    bind        ${hashscanUrl('transaction', held.bindTx)}`);
    if (held.nftSerial !== undefined) {
      console.log(`    receipt     ${config.policyNftTokenId} serial ${held.nftSerial}`);
    }
  }
  console.log('');
  for (const investor of context.record.investors) {
    console.log(`  ${investor.role}    ${investor.accountId}  ${hashscanUrl('account', investor.accountId)}`);
  }
  console.log('');
  console.log(
    `  reserved      ${inUnits(reserved, decimals)} TUSD, which pays ${(reserved / needed).toString()} claim(s) at the demonstration limit`,
  );
  console.log(`  exposure      ${inUnits(state.activeExposure, decimals)} TUSD`);
  console.log(`  window ends   ${new Date(state.windowEndsAt * 1000).toISOString()}`);
  console.log('');

  if (reserved < needed && state.lastObservedMonth >= TOP_UP_PERIOD) {
    throw new Error(
      `the reserve is ${reserved.toString()} and the approved claim needs ${needed.toString()}, and ${TOP_UP_PERIOD} is spent`,
    );
  }
  if (reserved < needed) {
    console.log(
      `  the reserve is under one cover limit. Shot 5 opens ${TOP_UP_PERIOD} and tops it up, which is the order the shot list runs in.`,
    );
  }
  context.record.seededAt = new Date().toISOString();
  stage(context, 'verify', `reserved ${reserved.toString()}`);
  console.log(`  written to    ${RECORD}`);
}

// ------------------------------------------------------------------ printing

function printScenario(): void {
  console.log(`the cut is ${timecode(runtime())}, ${SCENARIO.length} shots`);
  console.log('');
  for (const beat of SCENARIO) {
    console.log(`${timecode(beat.from)} to ${timecode(beat.to)}  shot ${beat.shot}  ${beat.title}`);
    console.log(`  on camera   ${beat.surface.join(', ')}`);
    for (const line of beat.before) console.log(`  before      ${line}`);
    for (const line of beat.commands) console.log(`  run         ${line}`);
    for (const line of beat.watch) console.log(`  watch       ${line}`);
    console.log('');
  }
}

// -------------------------------------------------------------------- main

const { values, positionals } = parseArgs({
  options: { plan: { type: 'boolean', default: false }, series: { type: 'string' } },
  allowPositionals: true,
});

const requested = positionals[0];
if (requested === 'scenario') {
  printScenario();
  process.exit(0);
}

const steps = stagesToRun(requested);

if (values.plan === true) {
  console.log('pnpm demo:seed would run, in order:');
  for (const name of steps) console.log(`  ${name}`);
  console.log('');
  console.log('nothing above has run. Drop --plan to run it.');
  process.exit(0);
}

const config = loadApiConfig();
assert.equal(config.network, 'testnet', 'this run is testnet only');
assert.ok(config.databaseUrl, 'DATABASE_URL is not set, so there is nowhere to write a policy');
const series = seriesNamed(config, values.series);
assert.ok(series, 'the deployment record has no registered series: run pnpm contracts:deploy');

const record = readRecord(config.network);
record.series = { label: series.label, seriesId: series.seriesId, groupKey: series.groupKey };

const pool = createPool(config.databaseUrl);
const chain = new EthersChainGateway(
  config.coverPoolAddress,
  config.vaultAddress,
  config.rpcUrl,
  config.chainId,
);
const vault = new Contract(
  config.vaultAddress,
  RESERVE_ABI,
  new JsonRpcProvider(config.rpcUrl, config.chainId, { staticNetwork: true }),
);

const context: Context = {
  config,
  chain,
  vault,
  pool,
  record,
  series,
  save: () => {
    writeRecordFile(record);
  },
};

const HANDLERS: Record<Stage, (context: Context) => Promise<void>> = {
  status,
  policies,
  investors,
  packets,
  verify,
};

try {
  for (const name of steps) {
    console.log(name);
    await HANDLERS[name](context);
  }
} finally {
  context.save();
  await pool.end();
}
