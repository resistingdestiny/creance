import { Contract, type InterfaceAbi } from 'ethers';

import { ERC20_ABI } from '../../coupons/abi.js';
import { emptyAtsRecord, seedNote } from '../../ats/note.js';
import { hashscan, openSession, send, type Session } from '../../ats/chain.js';
import {
  CollateralVault__factory,
  CoverPool__factory,
} from '../../types/ethers-contracts/index.js';
import { catalogue, thresholdsFor, type CatalogueEntry } from './catalogue.js';
import { GAS, MIRROR_URL, SERIES_TERMS, readResources } from './config.js';
import {
  findSeries,
  readRecord,
  recordPath,
  upsertSeries,
  writeRecord,
  type DeploymentRecord,
  type SeriesRecord,
} from './record.js';

/// `pnpm series:capacity` gives every occupation group a series with capacity
/// behind it, so more than one occupation can be bought.
///
/// Three things have to be true before an occupation is buyable, and they are
/// deliberately decoupled (see the ticket and docs/DECISIONS.md):
///
///   1. the series is opened in the CollateralVault and registered on the
///      CoverPool with that group's frozen calibration,
///   2. capacity is subscribed against it, or a quote prices and the bind
///      that follows fails for want of collateral,
///   3. a Displacement Bond Note exists for it as an ATS bond.
///
/// The third is the heaviest and least predictable call in the system, so it
/// runs as a second pass over series that already have capacity. A note that
/// fails to deploy leaves its cover buyable, is written into the record as a
/// failure and does not stop the next series.
///
///     pnpm series:capacity status              what is on chain, per group
///     pnpm series:capacity register            steps 1 and 2, every group
///     pnpm series:capacity notes               step 3, every group
///     pnpm series:capacity all                 register, then notes
///     pnpm series:capacity register office_admin_support   one group
///
/// It is idempotent against the chain rather than against the record: each
/// step reads what the vault, the pool and the note already say and does only
/// what is missing. The record is written after every series, so a run killed
/// half way leaves everything it finished on disk and the next run carries on.

const STEPS = ['status', 'register', 'notes', 'all'] as const;
type Step = (typeof STEPS)[number];

/// The capacity each new series is funded with, in whole settlement units. It
/// is the size of the note the series issues, so the collateral in the vault
/// and the principal the note reports are the same number. The demo series is
/// four times the size and is already funded; nothing here touches it.
const CAPACITY = 25_000n;

/// The account the seed capacity is credited to. `subscribe` pulls the
/// settlement token from the caller, which has to be the api account because
/// that is where SUBSCRIPTION_ROLE lives, and credits the holder named in the
/// call. The operator is named because the operator's own tokens are the ones
/// at risk.
const SEED_HOLDER = 'operator';

/// Enough HBAR for the api account to sign its own calls. ethers reserves
/// twice the base fee times the gas limit before it will send, so an account
/// with a 2,000,000 gas call ahead of it needs several HBAR free whatever the
/// call ends up costing. The floor is separate from the target so a run that
/// does nothing else sends nothing: topping up to exactly the target every
/// time would make every repeat run cost a transfer.
const API_HBAR_TARGET = 12n * 10n ** 18n;
const API_HBAR_FLOOR = 6n * 10n ** 18n;

function toBytes32(label: string): string {
  const bytes = Buffer.from(label, 'ascii');
  if (bytes.length > 32) throw new Error(`label too long for bytes32: ${label}`);
  return `0x${Buffer.concat([bytes, Buffer.alloc(32 - bytes.length)]).toString('hex')}`;
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

interface Runner {
  session: Session;
  record: DeploymentRecord;
  vault: ReturnType<typeof CollateralVault__factory.connect>;
  /// The vault connected to the api key, which is the only key that may call
  /// subscribe.
  vaultAsApi: ReturnType<typeof CollateralVault__factory.connect>;
  pool: ReturnType<typeof CoverPool__factory.connect>;
  token: Contract;
  /// The operator's 0.0.x id, which the subscription record names because the
  /// operator is the holder the capacity is credited to.
  operatorAccountId: string;
  tokenId: string;
  decimals: number;
  save: () => void;
}

function openRunner(): Runner {
  const resources = readResources();
  if (resources.network !== 'testnet') {
    throw new Error(`refusing to run against ${resources.network}: this build is testnet only`);
  }
  const session = openSession();
  const record = readRecord();
  const vaultRecord = record.collateralVault;
  const poolRecord = record.coverPool;
  if (vaultRecord === undefined || poolRecord === undefined) {
    throw new Error('no vault or pool in the deployment record: run `pnpm contracts:deploy` first');
  }
  return {
    session,
    record,
    vault: CollateralVault__factory.connect(vaultRecord.address, session.operator),
    vaultAsApi: CollateralVault__factory.connect(vaultRecord.address, session.api.wallet),
    pool: CoverPool__factory.connect(poolRecord.address, session.operator),
    token: new Contract(
      resources.settlementToken.evmAddress,
      ERC20_ABI as unknown as InterfaceAbi,
      session.operator,
    ),
    operatorAccountId: resources.operator.accountId,
    tokenId: resources.settlementToken.tokenId,
    decimals: resources.settlementToken.decimals,
    save: () => writeRecord(record),
  };
}

/// The settlement token's decimals as the mirror node reports them, checked
/// against the recorded value rather than trusted. Getting this wrong scales
/// every subscription by a million. The mirror node is asked rather than the
/// ERC-20 facade because the token is an HTS token and the mirror node is
/// where its consensus level record lives.
/// https://docs.hedera.com/hedera/sdks-and-apis/rest-api
async function checkDecimals(runner: Runner): Promise<number> {
  const response = await fetch(`${MIRROR_URL}/tokens/${runner.tokenId}`);
  if (!response.ok) {
    throw new Error(`the mirror node does not know the settlement token ${runner.tokenId}`);
  }
  const body = (await response.json()) as { decimals?: string };
  const onChain = Number(body.decimals);
  if (!Number.isInteger(onChain)) {
    throw new Error(`the mirror node reports no decimals for ${runner.tokenId}`);
  }
  if (onChain !== runner.decimals) {
    throw new Error(
      `the settlement token reports ${onChain} decimals, docs/hedera.testnet.json says ${runner.decimals}`,
    );
  }
  return onChain;
}

function minorUnits(whole: bigint, decimals: number): bigint {
  return whole * 10n ** BigInt(decimals);
}

/// Step 1. Open the series in the vault and register it on the pool.
///
/// The note address is not known here and cannot be: the note takes the
/// vault's maturity, so the vault has to be opened first. `openSeries` is
/// therefore called with the zero address, which is what the demo series
/// already carries. See docs/DECISIONS.md.
async function openAndRegister(runner: Runner, entry: CatalogueEntry): Promise<SeriesRecord> {
  const seriesId = toBytes32(entry.label);
  const group = toBytes32(entry.groupKey);
  const thresholds = thresholdsFor(entry.groupKey);
  const existing = await runner.vault.seriesOf(seriesId);
  const maturityAt =
    existing.maturityAt !== 0n
      ? Number(existing.maturityAt)
      : Math.floor(Date.now() / 1000) + SERIES_TERMS.term;

  const series: SeriesRecord = {
    id: seriesId,
    label: entry.label,
    group: entry.groupKey,
    attachmentShock: thresholds.attachmentShock.toString(),
    levelLine: thresholds.levelLine.toString(),
    exhaustionShock: thresholds.exhaustionShock.toString(),
    payoutMode: 'full',
    maturityAt,
    ...findSeries(runner.record, entry.label),
  };

  if (existing.maturityAt === 0n) {
    const tx = await runner.vault.openSeries(seriesId, ZERO_ADDRESS, maturityAt, {
      gasLimit: GAS.openSeries,
    });
    await tx.wait();
    series.openSeriesTx = tx.hash;
    console.log(`  opened in the vault ${tx.hash}, matures at ${maturityAt}`);
  } else {
    console.log('  already open in the vault');
  }

  const registered = await runner.pool.seriesOf(seriesId);
  if (registered.status === 0n) {
    // Printed in both forms so a judge can check them against the published
    // calibration without decoding the scale.
    console.log(
      `  attachment ${Number(thresholds.attachmentShock) / 10_000} points ` +
        `(${thresholds.attachmentShock}), ` +
        `level line ${Number(thresholds.levelLine) / 10_000} points (${thresholds.levelLine}), ` +
        `exhaustion ${Number(thresholds.exhaustionShock) / 10_000} points ` +
        `(${thresholds.exhaustionShock})`,
    );
    const tx = await runner.pool.registerSeries(
      {
        seriesId,
        group,
        attachmentShock: thresholds.attachmentShock,
        levelLine: thresholds.levelLine,
        exhaustionShock: thresholds.exhaustionShock,
        ...SERIES_TERMS,
      },
      { gasLimit: GAS.registerSeries },
    );
    await tx.wait();
    series.registerSeriesTx = tx.hash;
    console.log(`  registered on the pool ${tx.hash}`);
  } else {
    console.log('  already registered on the pool');
  }
  return series;
}

/// Step 2. Fund the series so a bind has collateral behind it.
///
/// The measure is the series' own `principalFunded`, not the seed holder's
/// subscription, because what a bind is checked against is the collateral the
/// series holds however it got there. The demo series already holds 100,000
/// from its two noteholders and this adds nothing to it.
///
/// Only the shortfall moves. A run that sent the principal and then died on
/// the approve would otherwise send it a second time, and the operator would
/// be out the difference with the vault none the wiser.
async function fundCapacity(runner: Runner, series: SeriesRecord, wanted: bigint): Promise<void> {
  const holder = runner.session.operator.address;
  const funded = (await runner.vault.seriesOf(series.id)).principalFunded;
  if (funded >= wanted) {
    console.log(`  capacity ${funded} already funded`);
    return;
  }
  const amount = wanted - funded;
  const api = runner.session.api;
  const held = (await runner.token.getFunction('balanceOf')(api.address)) as bigint;
  const subscriptions = series.subscriptions ?? [];
  const entry = {
    role: SEED_HOLDER,
    accountId: runner.operatorAccountId,
    address: holder,
    amount: wanted.toString(),
  } as NonNullable<SeriesRecord['subscriptions']>[number];

  if (held < amount) {
    const fund = await send(
      'the operator sends the capacity to the api account',
      runner.token.getFunction('transfer')(api.address, amount - held, { gasLimit: GAS.transfer }),
    );
    entry.fundTx = fund.hash;
  }
  const approve = await send(
    'the api account approves the vault',
    (runner.token.connect(api.wallet) as Contract).getFunction('approve')(
      runner.vault.target as string,
      amount,
      { gasLimit: GAS.approve },
    ),
  );
  entry.approveTx = approve.hash;
  const subscribed = await send(
    `subscribe ${amount}`,
    runner.vaultAsApi.subscribe(series.id, holder, amount, { gasLimit: GAS.subscribe }),
  );
  entry.subscribeTx = subscribed.hash;
  entry.gasUsed = subscribed.gasUsed;
  series.subscriptions = [...subscriptions.filter((s) => s.role !== SEED_HOLDER), entry];
}

/// The api account signs the subscribe, so it needs HBAR of its own. It has
/// none by default: every other path it is on is paid for by somebody else.
async function fundApiAccount(runner: Runner): Promise<void> {
  const api = runner.session.api;
  const held = await runner.session.provider.getBalance(api.address);
  if (held >= API_HBAR_FLOOR) {
    console.log(`api account holds ${held / 10n ** 18n} HBAR, enough`);
    return;
  }
  const tx = await runner.session.operator.sendTransaction({
    to: api.address,
    value: API_HBAR_TARGET - held,
    gasLimit: 500_000,
  });
  await tx.wait();
  console.log(`topped the api account up to 12 HBAR in ${tx.hash}`);
}

async function register(runner: Runner, wanted: CatalogueEntry[]): Promise<void> {
  const decimals = await checkDecimals(runner);
  const capacity = minorUnits(CAPACITY, decimals);
  for (const entry of wanted) {
    console.log(`${entry.label} (${entry.groupKey})`);
    // Checked before every series, not once at the start. Funding one series
    // costs the api account about 1.7 HBAR, almost all of it the approve,
    // which is an HTS call at about 730,000 gas, so twelve HBAR is spent
    // after seven series and a run over fifteen would die half way.
    await fundApiAccount(runner);
    const series = await openAndRegister(runner, entry);
    // Written before the funding, so an interrupted run never loses a
    // registration it paid for.
    upsertSeries(runner.record, series);
    runner.save();
    await fundCapacity(runner, series, capacity);
    upsertSeries(runner.record, series);
    runner.save();
  }
}

/// Step 3. The notes, one series at a time, each failure caught and reported.
async function notes(runner: Runner, wanted: CatalogueEntry[]): Promise<string[]> {
  const failures: string[] = [];
  for (const entry of wanted) {
    const series = findSeries(runner.record, entry.label);
    if (series === undefined) {
      console.log(`${entry.label} has no capacity yet, skipping its note`);
      continue;
    }
    console.log(`${entry.label} (${entry.groupKey})`);
    series.ats ??= emptyAtsRecord();
    try {
      await seedNote(runner.session, series, series.ats);
      delete series.noteFailure;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      // Reported, not swallowed: the series keeps its capacity and stays
      // buyable, and the record says what went wrong and when.
      series.noteFailure = { at: new Date().toISOString(), reason };
      failures.push(`${entry.label}: ${reason}`);
      console.error(`  note failed for ${entry.label}: ${reason}`);
    }
    upsertSeries(runner.record, series);
    runner.save();
  }
  return failures;
}

async function status(runner: Runner, wanted: CatalogueEntry[]): Promise<void> {
  const decimals = await checkDecimals(runner);
  const capacity = minorUnits(CAPACITY, decimals);
  const balance = await runner.session.provider.getBalance(runner.session.operator.address);
  const tokens = (await runner.token.getFunction('balanceOf')(
    runner.session.operator.address,
  )) as bigint;
  console.log(`operator      ${balance / 10n ** 18n} HBAR, ${tokens / 10n ** BigInt(decimals)} TUSD`);
  console.log(`capacity      ${CAPACITY} per series, ${wanted.length} in the catalogue`);
  console.log('');
  console.log('series                group                           chain  capacity  note');
  for (const entry of wanted) {
    const seriesId = toBytes32(entry.label);
    const [vault, pool] = await Promise.all([
      runner.vault.seriesOf(seriesId),
      runner.pool.seriesOf(seriesId),
    ]);
    const onChain = vault.maturityAt !== 0n && pool.status !== 0n ? 'yes' : 'no';
    const principalFunded = vault.principalFunded;
    const funded = principalFunded >= capacity ? 'yes' : `${principalFunded / 10n ** BigInt(decimals)}`;
    const note = findSeries(runner.record, entry.label)?.ats?.note?.address;
    console.log(
      `${entry.label.padEnd(22)}${entry.groupKey.padEnd(32)}${onChain.padEnd(7)}` +
        `${funded.padEnd(10)}${note ?? 'none'}`,
    );
  }
}

/// The catalogue entries a run acts on. With no names it is all of them, in
/// catalogue order, which puts the demo series first and the copy deck's
/// worked example second.
function wantedFrom(names: string[]): CatalogueEntry[] {
  const all = catalogue();
  if (names.length === 0) return all;
  return names.map((name) => {
    const wanted = name.trim().toLowerCase();
    const entry = all.find(
      (candidate) =>
        candidate.groupKey.toLowerCase() === wanted || candidate.label.toLowerCase() === wanted,
    );
    if (entry === undefined) throw new Error(`no series in the catalogue for "${name}"`);
    return entry;
  });
}

async function main(): Promise<void> {
  const step = (process.argv[2] ?? 'status') as Step;
  if (!STEPS.includes(step)) {
    throw new Error(`unknown step "${step}". One of: ${STEPS.join(', ')}`);
  }
  const runner = openRunner();
  const wanted = wantedFrom(process.argv.slice(3));

  let failures: string[] = [];
  try {
    if (step === 'status') await status(runner, wanted);
    if (step === 'register' || step === 'all') await register(runner, wanted);
    if (step === 'notes' || step === 'all') failures = await notes(runner, wanted);
  } finally {
    runner.save();
  }
  console.log(`record: ${recordPath()}`);
  if (failures.length > 0) {
    console.error(`\n${failures.length} note deploy(s) failed, their cover is still buyable:`);
    for (const failure of failures) console.error(`  ${failure}`);
    console.error(`vault ${hashscan('contract', runner.vault.target as string)}`);
    process.exitCode = 1;
  }
}

await main();
