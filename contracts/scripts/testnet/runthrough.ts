import assert from 'node:assert/strict';
import { Contract, JsonRpcProvider, Wallet } from 'ethers';

import {
  ATTACHMENT_SHOCK,
  CHAIN_ID,
  EXHAUSTION_SHOCK,
  GAS,
  LEVEL_LINE,
  MIRROR_URL,
  RPC_URL,
  SERIES_TERMS,
  readResources,
} from '../deploy/config.js';
import { readRecord, writeRecord } from '../deploy/record.js';
import { deriveRoleKeyHex, hashscanUrl, normaliseRawKeyHex } from '../hedera/derive.js';
import {
  CollateralVault__factory,
  CoverPool__factory,
} from '../../types/ethers-contracts/index.js';

/// One lifecycle against Hedera testnet, on a throwaway series so the demo
/// series is left untouched. It proves the three things the local network
/// cannot: that an HTS token moves out of the vault through its ERC-20 facade,
/// that an EIP-712 signature from a key derived Hedera account passes
/// ECRECOVER inside the contract, and what the money path actually costs in
/// gas.
///
/// The window in this run cannot be closed on testnet, because windowEndsAt is
/// sixty days past the end of the separation month by design. Closing is
/// covered in the local suite.

const DAY = 24 * 60 * 60;
const UNIT = 1_000_000n; // TUSD has six decimals.
const PRINCIPAL = 30n * UNIT;
const COVER_LIMIT = 10n * UNIT;

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

function operatorKeyHex(): string {
  return normaliseRawKeyHex(process.env.HEDERA_OPERATOR_KEY ?? '');
}

function periodOf(date: Date): number {
  return date.getUTCFullYear() * 100 + date.getUTCMonth() + 1;
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
  const operatorHex = operatorKeyHex();
  const operator = new Wallet(`0x${operatorHex}`, provider);
  const api = new Wallet(`0x${deriveRoleKeyHex(operatorHex, 'creance/testnet/api')}`, provider);
  const oracle = new Wallet(
    `0x${deriveRoleKeyHex(operatorHex, 'creance/testnet/oracle')}`,
    provider,
  );

  const apiAccount = resources.accounts.api;
  const oracleAccount = resources.accounts.oracle;
  const holderAccount = resources.accounts['policyholder-1'];
  const investorAccount = resources.accounts['investor-1'];
  assert.ok(apiAccount && oracleAccount && holderAccount && investorAccount, 'missing accounts');
  assert.equal(
    api.address.toLowerCase(),
    apiAccount.evmAddress.toLowerCase(),
    'the derived api key does not match the recorded api account',
  );
  assert.equal(
    oracle.address.toLowerCase(),
    oracleAccount.evmAddress.toLowerCase(),
    'the derived oracle key does not match the recorded oracle account',
  );

  const token = new Contract(resources.settlementToken.evmAddress, ERC20_ABI, operator);
  const vault = CollateralVault__factory.connect(vaultRecord.address, operator);
  const pool = CoverPool__factory.connect(poolRecord.address, operator);

  const now = Math.floor(Date.now() / 1000);
  const label = `T04-SMOKE-${now}`;
  const seriesId = toBytes32(label);
  const policyId = toBytes32(`${label}-P1`);
  const claimId = toBytes32(`${label}-C1`);
  const packetHash = toBytes32(`${label}-packet`);
  const decisionHash = toBytes32(`${label}-decision`);
  const gas: Record<string, number> = {};
  const links: Record<string, string> = {};

  console.log(`series ${label}`);
  console.log(`vault  ${vaultRecord.address}`);
  console.log(`pool   ${poolRecord.address}`);

  // 1. Fund the api account so it can subscribe on the investor's behalf. The
  // operator is the settlement token's treasury.
  const fundTx = await token.getFunction('transfer')(api.address, PRINCIPAL, {
    gasLimit: GAS.associate,
  });
  await fundTx.wait();
  console.log(`funded the api account with ${PRINCIPAL / UNIT} TUSD in ${fundTx.hash}`);

  const approveTx = await token
    .connect(api)
    .getFunction('approve')(vaultRecord.address, PRINCIPAL, { gasLimit: GAS.associate });
  await approveTx.wait();

  // 2. Open and register the throwaway series.
  const maturityAt = now + 400 * DAY;
  await (await vault.openSeries(seriesId, '0x0000000000000000000000000000000000000000', maturityAt, { gasLimit: GAS.openSeries })).wait();
  await (
    await pool.registerSeries(
      {
        seriesId,
        group: toBytes32('computer_math'),
        attachmentShock: ATTACHMENT_SHOCK,
        levelLine: LEVEL_LINE,
        exhaustionShock: EXHAUSTION_SHOCK,
        ...SERIES_TERMS,
      },
      { gasLimit: GAS.registerSeries },
    )
  ).wait();
  console.log('series opened and registered');

  // 3. Subscribe the principal. This is a real HTS transfer into a contract
  // through the ERC-20 facade.
  const subscribeTx = await vault
    .connect(api)
    .subscribe(seriesId, investorAccount.evmAddress, PRINCIPAL, { gasLimit: 1_500_000 });
  gas.subscribe = Number((await subscribeTx.wait())!.gasUsed);
  links.subscribe = hashscanUrl('transaction', subscribeTx.hash);
  console.log(`subscribed ${PRINCIPAL / UNIT} TUSD in ${subscribeTx.hash}, gas ${gas.subscribe}`);
  assert.equal(await vault.principalRemaining(seriesId), PRINCIPAL);

  // 4. Bind a policy that started two hundred days ago, so its waiting period
  // is behind it and its term still has months to run.
  const startAt = now - 200 * DAY;
  const bindTx = await pool.connect(api).bind(
    {
      policyId,
      seriesId,
      holder: holderAccount.evmAddress,
      nullifierHash: toBytes32(`${label}-nullifier`),
      limit: COVER_LIMIT,
      premium: 28n * UNIT,
      startAt,
      hcsReceiptSeq: 0n,
    },
    { gasLimit: 800_000 },
  );
  gas.bind = Number((await bindTx.wait())!.gasUsed);
  links.bind = hashscanUrl('transaction', bindTx.hash);
  console.log(`bound a ${COVER_LIMIT / UNIT} TUSD policy in ${bindTx.hash}, gas ${gas.bind}`);

  // 5. Publish the observation that opens the month, from the oracle account.
  // The smoothed excess crosses the negative level line while the year on year
  // ODI stays below the shock attachment, which is the real demo case.
  const period = periodOf(new Date());
  const observeTx = await pool.connect(oracle).submitObservation(
    {
      seriesId,
      period,
      odi: 3_000n,
      ebar: -6_000n,
      hcsSequence: 1n,
      sourceHash: toBytes32(`${label}-source`),
    },
    { gasLimit: 1_000_000 },
  );
  gas.submitObservationOpening = Number((await observeTx.wait())!.gasUsed);
  links.submitObservation = hashscanUrl('transaction', observeTx.hash);
  console.log(
    `observed ${period} in ${observeTx.hash}, gas ${gas.submitObservationOpening}`,
  );

  const series = await pool.seriesOf(seriesId);
  assert.equal(series.status, 2n, 'the series should be in a claim window');
  assert.equal(await vault.reservedOf(seriesId), COVER_LIMIT, 'the exposed limit should be reserved');

  // 6. The API signs the claim authorisation and anybody submits it. The
  // signature has to pass ECRECOVER inside the contract, which is only
  // possible because the api account carries an ECDSA key with a key derived
  // EVM address rather than a long-zero one.
  const separationAt = now - DAY;
  const authDeadline = now + 1800;
  const domain = {
    name: 'DisplacementBond',
    version: '1',
    chainId: CHAIN_ID,
    verifyingContract: poolRecord.address,
  };
  const types = {
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
  };
  const signature = await api.signTypedData(domain, types, {
    policyId,
    claimId,
    nullifierHash: toBytes32(`${label}-nullifier`),
    packetHash,
    decisionHash,
    payee: holderAccount.evmAddress,
    amount: COVER_LIMIT,
    separationAt,
    deadline: authDeadline,
  });

  const balanceBefore: bigint = await token.getFunction('balanceOf')(holderAccount.evmAddress);
  const payTx = await pool.payClaim(
    {
      policyId,
      claimId,
      separationAt,
      packetHash,
      decisionHash,
      amount: COVER_LIMIT,
      payee: holderAccount.evmAddress,
      authDeadline,
    },
    signature,
    { gasLimit: 1_500_000 },
  );
  gas.payClaim = Number((await payTx.wait())!.gasUsed);
  links.payClaim = hashscanUrl('transaction', payTx.hash);
  console.log(`paid the claim in ${payTx.hash}, gas ${gas.payClaim}`);

  const balanceAfter: bigint = await token.getFunction('balanceOf')(holderAccount.evmAddress);
  assert.equal(balanceAfter - balanceBefore, COVER_LIMIT, 'the payee did not receive the payout');
  assert.equal((await pool.policyOf(policyId)).status, 3n, 'the policy should be Paid');
  assert.equal(await vault.principalRemaining(seriesId), PRINCIPAL - COVER_LIMIT);

  // 7. Read the ClaimPaid event back from the mirror node, which is the read
  // path the web app and the API use.
  const logs = await fetch(
    `${MIRROR_URL}/contracts/${poolRecord.address}/results/logs?limit=5&order=desc`,
  );
  assert.ok(logs.ok, `the mirror node returned ${logs.status} for the contract logs`);
  const body = (await logs.json()) as { logs: Array<{ topics: string[] }> };
  const claimPaidTopic = pool.interface.getEvent('ClaimPaid').topicHash;
  assert.ok(
    body.logs.some((entry) => entry.topics[0] === claimPaidTopic),
    'the ClaimPaid event is not in the mirror node log yet',
  );
  console.log('ClaimPaid read back from the mirror node');

  // The window cannot be closed inside this run: it runs sixty days past the
  // end of the separation month on purpose, so a claimant is never cut off by
  // the publication lag.
  const windowEndsAt = await pool.windowEndsAtOf(seriesId);
  console.log(`window ends at ${windowEndsAt} (${new Date(Number(windowEndsAt) * 1000).toISOString()})`);

  record.gasUsed = { ...record.gasUsed, ...gas };
  record.testnetRunthrough = { series: label, at: new Date().toISOString(), links };
  writeRecord(record);
  console.log('\ngas measured on testnet:');
  for (const [name, used] of Object.entries(gas)) console.log(`  ${name.padEnd(26)} ${used}`);
}

await main();
