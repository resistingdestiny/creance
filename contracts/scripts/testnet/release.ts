import assert from 'node:assert/strict';
import { Contract, JsonRpcProvider, Wallet } from 'ethers';

import {
  ATTACHMENT_SHOCK,
  CHAIN_ID,
  EXHAUSTION_SHOCK,
  GAS,
  LEVEL_LINE,
  RPC_URL,
  SERIES_TERMS,
  readResources,
} from '../deploy/config.js';
import { readRecord, writeRecord } from '../deploy/record.js';
import { deriveRoleKeyHex, hashscanUrl, normaliseRawKeyHex } from '../hedera/derive.js';
import { CollateralVault__factory, CoverPool__factory } from '../../types/ethers-contracts/index.js';

/// `pnpm --filter @creance/contracts demo:release`
///
/// The last beat of DESIGN.md section 7 on testnet: a claim window closes, the
/// unclaimed reserve returns to the vault and the noteholders' principal is
/// down by exactly the claim that was paid.
///
/// It runs on a short window series opened for the purpose, and it says so
/// rather than pretending. The demo series ODI-COMP-2026-01 takes its claim
/// window from the observation that opened it, thirty days, which puts its
/// window end at 2026-10-05: `closeWindow` reverts `WindowNotOver` until then
/// and the event is over before it. The terms are frozen at registration and
/// there is no setter, so the only honest way to show a release inside the
/// event is a second series whose window is measured in seconds. Maturity is
/// already shown the same way, on the short dated series `pnpm coupons:mature`
/// opens (docs/HEDERA.md, "The maturity demonstration").
///
/// Everything in it is real: a real HTS principal into the vault, a real
/// policy, a real observation that opens a month, a real payout through
/// ECRECOVER and a real release. Nothing is a mock and nothing is a fixture.
///
///     --window SECONDS   how long the claim window runs, default 120
///
/// It writes to testnet and costs fees, so it is a command and never part of
/// `pnpm test`.

const DAY = 24 * 60 * 60;
const UNIT = 1_000_000n; // TUSD has six decimals.
const PRINCIPAL = 30n * UNIT;
const COVER_LIMIT = 10n * UNIT;

/// The month that opens. It is the demo series' own opening month, so the
/// release runs against the shape the video shows rather than a made up one,
/// and because it is in the past the separation term of the window is already
/// spent and the observation term is what `closeWindow` waits for.
const OPEN_PERIOD = 202604;

/// The separation of the one policy that claims. Inside the open month, so
/// `isInLossWindow` qualifies it, and well after the waiting period on cover
/// that started 300 days ago.
const SEPARATION = Date.UTC(2026, 3, 15) / 1000;

const ERC20_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
];

function toBytes32(label: string): string {
  const bytes = Buffer.from(label, 'ascii');
  if (bytes.length > 32) throw new Error(`label too long for bytes32: ${label}`);
  return `0x${Buffer.concat([bytes, Buffer.alloc(32 - bytes.length)]).toString('hex')}`;
}

function windowSeconds(): number {
  const flag = process.argv.indexOf('--window');
  if (flag === -1) return 120;
  const value = Number(process.argv[flag + 1]);
  assert.ok(Number.isInteger(value) && value > 0, '--window takes a whole number of seconds');
  return value;
}

async function main(): Promise<void> {
  const resources = readResources();
  assert.equal(resources.network, 'testnet', 'this run is testnet only');

  const record = readRecord();
  const vaultRecord = record.collateralVault;
  const poolRecord = record.coverPool;
  assert.ok(vaultRecord, 'no vault in the deployment record; run pnpm contracts:deploy first');
  assert.ok(poolRecord, 'no pool in the deployment record; run pnpm contracts:deploy first');

  const provider = new JsonRpcProvider(RPC_URL, CHAIN_ID, { staticNetwork: true });
  const operatorHex = normaliseRawKeyHex(process.env.HEDERA_OPERATOR_KEY ?? '');
  assert.ok(operatorHex, 'HEDERA_OPERATOR_KEY is not set');
  const operator = new Wallet(`0x${operatorHex}`, provider);
  const api = new Wallet(`0x${deriveRoleKeyHex(operatorHex, 'creance/testnet/api')}`, provider);
  const oracle = new Wallet(`0x${deriveRoleKeyHex(operatorHex, 'creance/testnet/oracle')}`, provider);

  const holder = resources.accounts['policyholder-1'];
  const investor = resources.accounts['investor-1'];
  assert.ok(holder && investor, 'docs/hedera.testnet.json is missing a demonstration account');

  const token = new Contract(resources.settlementToken.evmAddress, ERC20_ABI, operator);
  const vault = CollateralVault__factory.connect(vaultRecord.address, operator);
  const pool = CoverPool__factory.connect(poolRecord.address, operator);

  const now = Math.floor(Date.now() / 1000);
  const window = windowSeconds();
  const label = `T24-REL-${now}`;
  const seriesId = toBytes32(label);
  const claimant = toBytes32(`${label}-P1`);
  const bystander = toBytes32(`${label}-P2`);
  const claimId = toBytes32(`${label}-C1`);
  const packetHash = toBytes32(`${label}-packet`);
  const decisionHash = toBytes32(`${label}-decision`);
  const nullifierHash = toBytes32(`${label}-nullifier-1`);
  const links: Record<string, string> = {};

  console.log(`series  ${label}, claim window ${window} seconds from the observation`);
  console.log(`vault   ${vaultRecord.address}`);
  console.log(`pool    ${poolRecord.address}`);

  // 1. The principal, from the token's treasury through the api account, which
  // is what subscribes on a noteholder's behalf.
  await (await token.getFunction('transfer')(api.address, PRINCIPAL, { gasLimit: GAS.associate })).wait();
  await (
    await token.connect(api).getFunction('approve')(vaultRecord.address, PRINCIPAL, {
      gasLimit: GAS.associate,
    })
  ).wait();

  // 2. The series, with everything the demo series carries except the two
  // claim window terms.
  const maturityAt = now + 400 * DAY;
  await (
    await vault.openSeries(seriesId, '0x0000000000000000000000000000000000000000', maturityAt, {
      gasLimit: GAS.openSeries,
    })
  ).wait();
  const registerTx = await pool.registerSeries(
    {
      seriesId,
      group: toBytes32('computer_math'),
      attachmentShock: ATTACHMENT_SHOCK,
      levelLine: LEVEL_LINE,
      exhaustionShock: EXHAUSTION_SHOCK,
      ...SERIES_TERMS,
      claimWindowFromObservation: window,
      claimWindowFromSeparation: 60,
    },
    { gasLimit: GAS.registerSeries },
  );
  await registerTx.wait();
  links.registerSeries = hashscanUrl('transaction', registerTx.hash);
  console.log(`registered in ${registerTx.hash}`);

  const subscribeTx = await vault
    .connect(api)
    .subscribe(seriesId, investor.evmAddress, PRINCIPAL, { gasLimit: 1_500_000 });
  await subscribeTx.wait();
  links.subscribe = hashscanUrl('transaction', subscribeTx.hash);
  console.log(`subscribed ${PRINCIPAL / UNIT} TUSD for investor-1`);

  // 3. Two policies, both exposed when the month opens and only one of them
  // claiming. That is what makes the release worth showing: the reserve is
  // taken against every exposed limit, and what the claims do not use goes back
  // to the noteholders rather than staying locked up.
  const startAt = now - 300 * DAY;
  for (const [index, policyId] of [claimant, bystander].entries()) {
    const bindTx = await pool.connect(api).bind(
      {
        policyId,
        seriesId,
        holder: holder.evmAddress,
        nullifierHash: toBytes32(`${label}-nullifier-${index + 1}`),
        limit: COVER_LIMIT,
        premium: 28n * UNIT,
        startAt,
        hcsReceiptSeq: 0n,
      },
      { gasLimit: 800_000 },
    );
    await bindTx.wait();
    links[`bind${index + 1}`] = hashscanUrl('transaction', bindTx.hash);
  }
  console.log(`bound two policies of ${COVER_LIMIT / UNIT} TUSD each`);

  // 4. The month opens on the level form, exactly as 2026-04 did on the demo
  // series, and the vault reserves the exposed limit.
  const observeTx = await pool.connect(oracle).submitObservation(
    {
      seriesId,
      period: OPEN_PERIOD,
      odi: 3_000n,
      ebar: -6_000n,
      hcsSequence: 16n,
      sourceHash: toBytes32(`${label}-source`),
    },
    { gasLimit: 1_000_000 },
  );
  await observeTx.wait();
  links.submitObservation = hashscanUrl('transaction', observeTx.hash);
  const reservedAfterOpen = await vault.reservedOf(seriesId);
  const windowEndsAt = await pool.windowEndsAtOf(seriesId);
  console.log(`${OPEN_PERIOD} opened, reserved ${reservedAfterOpen}`);
  console.log(`window ends at ${windowEndsAt} (${new Date(Number(windowEndsAt) * 1000).toISOString()})`);
  assert.equal(reservedAfterOpen, COVER_LIMIT * 2n, 'both exposed limits should be reserved');

  // 5. One claim paid out of that reserve, authorised by the api account's own
  // key and recovered inside the contract.
  const authDeadline = now + 1800;
  const signature = await api.signTypedData(
    {
      name: 'DisplacementBond',
      version: '1',
      chainId: CHAIN_ID,
      verifyingContract: poolRecord.address,
    },
    {
      ClaimAuthorisation: [
        { name: 'policyId', type: 'bytes32' },
        { name: 'claimId', type: 'bytes32' },
        { name: 'nullifierHash', type: 'bytes32' },
        { name: 'packetHash', type: 'bytes32' },
        { name: 'decisionHash', type: 'bytes32' },
        { name: 'payee', type: 'address' },
        { name: 'amount', type: 'uint256' },
        { name: 'separationAt', type: 'uint64' },
        { name: 'deadline', type: 'uint64' },
      ],
    },
    {
      policyId: claimant,
      claimId,
      nullifierHash,
      packetHash,
      decisionHash,
      payee: holder.evmAddress,
      amount: COVER_LIMIT,
      separationAt: SEPARATION,
      deadline: authDeadline,
    },
  );
  const payTx = await pool.payClaim(
    {
      policyId: claimant,
      claimId,
      separationAt: SEPARATION,
      packetHash,
      decisionHash,
      amount: COVER_LIMIT,
      payee: holder.evmAddress,
      authDeadline,
    },
    signature,
    { gasLimit: 1_500_000 },
  );
  await payTx.wait();
  links.payClaim = hashscanUrl('transaction', payTx.hash);
  const reservedAfterPayout = await vault.reservedOf(seriesId);
  console.log(`paid ${COVER_LIMIT / UNIT} TUSD, reserved now ${reservedAfterPayout}`);

  // 6. The wait, which is the whole point: `closeWindow` refuses before the
  // deadline rather than reverting somewhere a caller cannot read.
  const remaining = Number(windowEndsAt) - Math.floor(Date.now() / 1000) + 2;
  if (remaining > 0) {
    console.log(`waiting ${remaining} seconds for the window to end`);
    await new Promise((resolve) => setTimeout(resolve, remaining * 1000));
  }

  const closeTx = await pool.closeWindow(seriesId, { gasLimit: 1_500_000 });
  const closeReceipt = await closeTx.wait();
  links.closeWindow = hashscanUrl('transaction', closeTx.hash);
  const released = closeReceipt?.logs
    .map((log) => {
      try {
        return vault.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((event) => event?.name === 'Released');
  console.log(`closed in ${closeTx.hash}, gas ${closeReceipt?.gasUsed ?? 0n}`);
  console.log(`Released ${released?.args[1] ?? 0n}, reserve now ${released?.args[2] ?? 0n}`);

  const after = await pool.seriesOf(seriesId);
  const principalRemaining = await vault.principalRemaining(seriesId);
  assert.equal(released?.args[1], COVER_LIMIT, 'the unclaimed limit should have been released');
  assert.equal(await vault.reservedOf(seriesId), 0n, 'the reserve should be empty');
  assert.equal(after.status, 1n, 'the series should be back to Active');
  assert.equal(principalRemaining, PRINCIPAL - COVER_LIMIT, 'principal should be down by the payout');

  console.log('');
  console.log(`series             ${label}`);
  console.log(`principal          ${PRINCIPAL} funded, ${principalRemaining} remaining`);
  console.log(`reserved on open   ${reservedAfterOpen}`);
  console.log(`reserved on payout ${reservedAfterPayout}`);
  console.log(`released           ${released?.args[1] ?? 0n}`);
  for (const [name, link] of Object.entries(links)) console.log(`${name.padEnd(18)} ${link}`);

  record.demoRelease = {
    series: label,
    at: new Date().toISOString(),
    windowSeconds: window,
    principalFunded: PRINCIPAL.toString(),
    principalRemaining: principalRemaining.toString(),
    reservedOnOpen: reservedAfterOpen.toString(),
    released: (released?.args[1] ?? 0n).toString(),
    links,
  };
  writeRecord(record);
}

await main();
