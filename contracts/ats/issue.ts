import type { Contract, Wallet } from 'ethers';

import { readRecord, recordPath, writeRecord, type DeploymentRecord } from '../scripts/deploy/record.js';
import { bondData, maxSupplyFor, principalFor, regulationData, type BondPlan } from './bond.js';
import {
  ATS,
  ATS_TAG,
  ATS_VERSION,
  COUPON,
  GAS,
  NOTE,
  OPERATOR_ROLES,
  PARTITION_1,
  ROLES,
} from './config.js';
import {
  contractIdOf,
  bondConfigVersion,
  checkAtsAddresses,
  expectRevert,
  factoryAt,
  hashscan,
  noteAt,
  openSession,
  operatorKey,
  send,
  type Session,
} from './chain.js';
import { createKycCredential, grantKycArguments, verifyCredential } from './credential.js';
import { testIsinFor } from './isin.js';
import type { AtsNoteRecord, AtsRecord } from './record.js';

/// `pnpm ats:issue` issues the demo note series through the Asset Tokenization
/// Studio on Hedera testnet and runs the compliance sequence T06 asks for. It
/// is record driven: every step reads contracts/deployments/testnet.json, skips
/// what is already there and writes back what it did, so a relay timeout half
/// way through is recovered by running the same command again.

const SERIES_LABEL = 'ODI-COMP-2026-01';

/// Minted, moved, then minted again, so both noteholders end at half the
/// principal each and total supply is exactly the cap.
const FIRST_MINT = 60n;
const MOVED = 10n;
const SECOND_MINT = 40n;
/// Frozen on the second noteholder, leaving less unfrozen than the transfer
/// that has to fail asks for.
const FROZEN = 45n;

const STEPS = [
  'status',
  'fund',
  'throwaway',
  'issue',
  'roles',
  'issuer',
  'kyc1',
  'mint1',
  'blocked',
  'kyc2',
  'allowed',
  'mint2',
  'controls',
  'coupon',
  'couponcheck',
  'verify',
  'all',
] as const;
type Step = (typeof STEPS)[number];

const RUN: Step[] = [
  'fund',
  'throwaway',
  'issue',
  'roles',
  'issuer',
  'kyc1',
  'mint1',
  'blocked',
  'kyc2',
  'allowed',
  'mint2',
  'controls',
  'coupon',
  'verify',
];

function units(whole: bigint): bigint {
  return whole * 10n ** BigInt(NOTE.decimals);
}

function whole(amount: bigint): string {
  return (amount / 10n ** BigInt(NOTE.decimals)).toString();
}

function atsOf(record: DeploymentRecord): AtsRecord {
  if (record.series === undefined) {
    throw new Error('no series in the deployment record: run `pnpm contracts:deploy` first');
  }
  record.series.ats ??= {
    version: ATS_VERSION,
    tag: ATS_TAG,
    factoryId: ATS.factoryId,
    factory: ATS.factory,
    resolverId: ATS.resolverId,
    resolver: ATS.resolver,
    configId: ATS.bondConfigId,
  };
  return record.series.ats;
}

interface StepEntry {
  tx?: string;
  result: string;
  revert?: string;
  gasUsed?: number;
}

function step(ats: AtsRecord, name: string, entry: StepEntry): void {
  ats.steps = { ...ats.steps, [name]: entry };
}

function noteContract(ats: AtsRecord, runner: Wallet): Contract {
  if (ats.note === undefined) {
    throw new Error('the note is not issued yet: run `pnpm ats:issue issue`');
  }
  return noteAt(ats.note.address, runner);
}

/// The accrual window is a real calendar month, because ATS prices a coupon as
/// balance times nominal times rate times the window in seconds over 365 days,
/// and a thirty day approximation would under pay a long month.
function monthAfter(seconds: number): number {
  const end = new Date(seconds * 1000);
  end.setUTCMonth(end.getUTCMonth() + 1);
  return Math.floor(end.getTime() / 1000);
}

async function deployBond(session: Session, plan: BondPlan, info: string): Promise<AtsNoteRecord> {
  await checkAtsAddresses();
  const factory = factoryAt(session.operator);
  // The only role set at creation is the diamond owner, which is what the SDK
  // sends; every other role is granted afterwards so each grant is its own
  // transaction on the record.
  const rbacs = [{ role: `0x${'00'.repeat(32)}`, members: [plan.owner] }];
  console.log(`  deploying ${plan.name}`);
  console.log(`  isin ${plan.isin}, decimals ${plan.decimals}, max supply ${maxSupplyFor(plan)}`);
  const sent = await send(
    'deployBond',
    factory.deployBond!(bondData(plan, rbacs), regulationData(info), { gasLimit: GAS.deployBond }),
  );
  const deployed = sent.receipt.logs
    .map((log) => {
      try {
        return factory.interface.parseLog({ topics: [...log.topics], data: log.data });
      } catch {
        return null;
      }
    })
    .find((parsed) => parsed?.name === 'BondDeployed');
  const address = deployed?.args?.[1] as string | undefined;
  if (address === undefined) throw new Error('no BondDeployed event in the deployment receipt');
  const contractId = await contractIdOf(address);
  console.log(`  bond ${address} ${contractId ?? '(mirror node not caught up)'}`);
  return {
    contractId,
    address,
    name: plan.name,
    symbol: plan.symbol,
    isin: plan.isin,
    decimals: plan.decimals,
    units: plan.units.toString(),
    nominalValue: plan.nominalValue.toString(),
    principal: principalFor(plan).toString(),
    currency: NOTE.currency,
    maxSupply: maxSupplyFor(plan).toString(),
    startingDate: plan.startingDate,
    maturityDate: plan.maturityDate,
    internalKycActivated: plan.internalKycActivated,
    regulation: 'Regulation S',
    deployTx: sent.hash,
    gasUsed: sent.gasUsed,
  };
}

async function status(session: Session, record: DeploymentRecord): Promise<void> {
  const ats = atsOf(record);
  await checkAtsAddresses();
  const version = await bondConfigVersion(session.provider);
  const balance = await session.provider.getBalance(session.operator.address);
  console.log(`ats           ${ATS_VERSION} at ${ATS_TAG}`);
  console.log(`factory       ${ATS.factoryId} ${ATS.factory}`);
  console.log(`resolver      ${ATS.resolverId} ${ATS.resolver}`);
  console.log(`bond config   ${ATS.bondConfigId} version ${version}`);
  console.log(`operator      ${session.operator.address} ${balance / 10n ** 10n} tinybar`);
  for (const investor of session.investors) {
    const held = await session.provider.getBalance(investor.address);
    console.log(`${investor.role.padEnd(14)}${investor.address} ${held / 10n ** 10n} tinybar`);
  }
  console.log(`outsider      ${session.outsider.address} (${session.outsider.role})`);
  console.log(`throwaway     ${ats.throwaway?.address ?? 'not deployed'}`);
  console.log(`note          ${ats.note?.address ?? 'not issued'}`);
  console.log(`steps done    ${Object.keys(ats.steps ?? {}).join(', ') || 'none'}`);
}

/// Each noteholder signs its own transfer, so each one needs gas of its own.
/// Day 0 funded them for token transfers, not for contract calls.
async function fund(session: Session, record: DeploymentRecord): Promise<void> {
  const ats = atsOf(record);
  const target = 12n * 10n ** 18n;
  for (const investor of session.investors) {
    const held = await session.provider.getBalance(investor.address);
    if (held >= target) {
      console.log(`  ${investor.role} holds ${held / 10n ** 10n} tinybar, enough`);
      continue;
    }
    const tx = await session.operator.sendTransaction({
      to: investor.address,
      value: target - held,
      gasLimit: 500_000,
    });
    const receipt = await tx.wait();
    console.log(`  funded ${investor.role} to 12 HBAR ${tx.hash}`);
    step(ats, `fund-${investor.role}`, {
      tx: tx.hash,
      result: `${investor.role} topped up to 12 HBAR so it can pay for its own calls`,
      gasUsed: receipt === null ? undefined : Number(receipt.gasUsed),
    });
  }
}

/// The first deployment proves the factory and resolver pair, and it is made
/// with the supply cap the SDK would send: the unit count, unscaled. The mint
/// that follows has to fail, and that failure is the finding.
async function throwaway(session: Session, record: DeploymentRecord): Promise<void> {
  const ats = atsOf(record);
  if (ats.throwaway !== undefined) {
    console.log(`  already deployed at ${ats.throwaway.address}`);
    return;
  }
  const version = await bondConfigVersion(session.provider);
  ats.configVersion = version;
  const now = Math.floor(Date.now() / 1000);
  const plan: BondPlan = {
    name: 'Creance ATS Probe',
    symbol: 'CPROBE',
    isin: testIsinFor('T06-THROWAWAY'),
    decimals: NOTE.decimals,
    units: NOTE.units,
    nominalValue: NOTE.nominalValue,
    startingDate: now,
    maturityDate: now + 24 * 60 * 60,
    owner: session.operator.address,
    configVersion: version,
    internalKycActivated: false,
    scaleMaxSupply: false,
  };
  const probe = await deployBond(session, plan, 'Creance throwaway probe, not a series');
  const bond = noteAt(probe.address, session.operator);
  await send(
    'grantRole ROLE_ISSUER',
    bond.grantRole!(ROLES.ROLE_ISSUER, session.operator.address, { gasLimit: GAS.grantRole }),
  );
  const failure = await expectRevert(
    'issueByPartition one whole unit',
    bond,
    'issueByPartition',
    [{ partition: PARTITION_1, tokenHolder: session.operator.address, value: units(1n), data: '0x' }],
    { gasLimit: GAS.issue },
  );
  ats.throwaway = {
    ...probe,
    finding:
      `the supply cap is a raw balance, not a unit count: with maxSupply ${probe.maxSupply} ` +
      `on a ${probe.decimals} decimal note, issuing one whole unit reverts ${failure.revert}`,
  };
  step(ats, 'throwaway', {
    tx: probe.deployTx,
    result: `the example environment factory pair deploys an 8.0.0 bond at config version ${version}`,
    gasUsed: probe.gasUsed,
  });
  step(ats, 'throwaway-max-supply', {
    tx: failure.hash,
    revert: failure.revert,
    result: `one whole unit against an unscaled cap of ${probe.maxSupply} is refused`,
  });
}

async function issue(session: Session, record: DeploymentRecord): Promise<void> {
  const ats = atsOf(record);
  if (ats.note !== undefined) {
    console.log(`  already issued at ${ats.note.address}`);
    return;
  }
  const series = record.series;
  if (series === undefined) throw new Error('no series in the deployment record');
  const version = await bondConfigVersion(session.provider);
  ats.configVersion = version;
  const plan: BondPlan = {
    name: NOTE.name,
    symbol: NOTE.symbol,
    isin: testIsinFor(SERIES_LABEL),
    decimals: NOTE.decimals,
    units: NOTE.units,
    nominalValue: NOTE.nominalValue,
    startingDate: Math.floor(Date.now() / 1000),
    // The vault already froze this maturity for the series. The two
    // instruments have to agree on the day the principal comes back.
    maturityDate: series.maturityAt,
    owner: session.operator.address,
    configVersion: version,
    internalKycActivated: true,
    scaleMaxSupply: true,
  };
  ats.note = await deployBond(session, plan, `Creance Displacement Bond Note, series ${SERIES_LABEL}`);
  step(ats, 'issue', {
    tx: ats.note.deployTx,
    result:
      `series ${SERIES_LABEL} issued as an ATS bond, principal ${ats.note.principal}, ` +
      `internal KYC on, clearing off, not controllable, Regulation S`,
    gasUsed: ats.note.gasUsed,
  });
}

async function roles(session: Session, record: DeploymentRecord): Promise<void> {
  const ats = atsOf(record);
  const bond = noteContract(ats, session.operator);
  for (const role of OPERATOR_ROLES) {
    if ((await bond.hasRole!(ROLES[role], session.operator.address)) as boolean) {
      console.log(`  ${role} already held`);
      continue;
    }
    const sent = await send(
      `grantRole ${role}`,
      bond.grantRole!(ROLES[role], session.operator.address, { gasLimit: GAS.grantRole }),
    );
    ats.roles = { ...ats.roles, [role]: sent.hash };
  }
  for (const role of OPERATOR_ROLES) {
    if (((await bond.hasRole!(ROLES[role], session.operator.address)) as boolean) !== true) {
      throw new Error(`${role} did not take`);
    }
  }
  step(ats, 'roles', { result: `the operator holds ${OPERATOR_ROLES.join(', ')}` });
}

/// The credential issuer has to be registered on the security before any grant.
/// Removing it later revokes every grant it made, silently and with no event,
/// so the registration stands for the life of the series.
async function issuer(session: Session, record: DeploymentRecord): Promise<void> {
  const ats = atsOf(record);
  const bond = noteContract(ats, session.operator);
  if ((await bond.isIssuer!(session.operator.address)) as boolean) {
    console.log('  the operator is already a registered issuer');
  } else {
    const sent = await send(
      'addIssuer',
      bond.addIssuer!(session.operator.address, { gasLimit: GAS.addIssuer }),
    );
    step(ats, 'issuer', {
      tx: sent.hash,
      result: `${session.operator.address} registered as the credential issuer, isIssuer reads true`,
      gasUsed: sent.gasUsed,
    });
  }
  ats.issuer = session.operator.address;
}

async function grantKyc(session: Session, record: DeploymentRecord, index: number): Promise<void> {
  const ats = atsOf(record);
  const investor = session.investors[index];
  if (investor === undefined) throw new Error(`no investor at position ${index}`);
  const bond = noteContract(ats, session.operator);
  if (Number(await bond.getKycStatusFor!(investor.address)) === 1) {
    console.log(`  ${investor.role} already holds KYC`);
    return;
  }
  // The signature is checked here, not on chain: the contract stores the
  // credential id as an opaque string. Signing with the operator key is what
  // makes the issuer on the credential the issuer registered on the security.
  const credential = await createKycCredential(operatorKey(), investor.address);
  if (!(await verifyCredential(credential))) {
    throw new Error('the credential this build just signed does not verify');
  }
  const args = grantKycArguments(credential, investor.address, Date.now());
  console.log(`  ${investor.role} credential ${args.vcId} issued by ${args.issuer}`);
  const sent = await send(
    `grantKyc ${investor.role}`,
    bond.grantKyc!(args.account, args.vcId, args.validFrom, args.validTo, args.issuer, {
      gasLimit: GAS.grantKyc,
    }),
  );
  const status = Number(await bond.getKycStatusFor!(investor.address));
  if (status !== 1) throw new Error(`${investor.role} is still not granted after the grant`);
  ats.kyc = {
    ...ats.kyc,
    [investor.role]: {
      vcId: args.vcId,
      validFrom: args.validFrom,
      validTo: args.validTo,
      tx: sent.hash,
    },
  };
  step(ats, `kyc-${investor.role}`, {
    tx: sent.hash,
    result: `getKycStatusFor(${investor.address}) reads GRANTED (1)`,
    gasUsed: sent.gasUsed,
  });
}

async function mint(session: Session, record: DeploymentRecord, index: number, amount: bigint): Promise<void> {
  const ats = atsOf(record);
  const investor = session.investors[index];
  if (investor === undefined) throw new Error(`no investor at position ${index}`);
  // The guard is the record, not the balance: the demo moves units between the
  // two mints, so a balance can be right without this mint having happened, and
  // minting twice would break the supply cap.
  if (ats.steps?.[`mint-${investor.role}`]?.tx !== undefined) {
    console.log(`  ${investor.role} has already been issued to`);
    return;
  }
  const bond = noteContract(ats, session.operator);
  const before = (await bond.balanceOf!(investor.address)) as bigint;
  const sent = await send(
    `issueByPartition ${whole(units(amount))} units to ${investor.role}`,
    bond.issueByPartition!(
      { partition: PARTITION_1, tokenHolder: investor.address, value: units(amount), data: '0x' },
      { gasLimit: GAS.issue },
    ),
  );
  const after = (await bond.balanceOf!(investor.address)) as bigint;
  step(ats, `mint-${investor.role}`, {
    tx: sent.hash,
    result: `balanceOf(${investor.role}) ${before} to ${after}, ${whole(after)} units`,
    gasUsed: sent.gasUsed,
  });
}

/// The demo moment. The same transfer, with the same parameters, before and
/// after the recipient holds KYC.
async function transfer(
  session: Session,
  record: DeploymentRecord,
  amount: bigint,
  mustFail: boolean,
): Promise<void> {
  const ats = atsOf(record);
  const name = mustFail ? 'transfer-blocked' : 'transfer-allowed';
  if (ats.steps?.[name]?.tx !== undefined) {
    console.log(`  ${name} has already run`);
    return;
  }
  const [from, to] = session.investors;
  if (from === undefined || to === undefined) throw new Error('two investors are required');
  const bond = noteContract(ats, from.wallet);
  const args = [PARTITION_1, { to: to.address, value: units(amount) }, '0x'];
  if (mustFail) {
    const failure = await expectRevert('transferByPartition', bond, 'transferByPartition', args, {
      gasLimit: GAS.transfer,
    });
    step(ats, 'transfer-blocked', {
      tx: failure.hash,
      revert: failure.revert,
      result:
        `${whole(units(amount))} units from ${from.role} to ${to.role} refused while ` +
        `getKycStatusFor(${to.address}) reads NOT_GRANTED (0); internal KYC is the gate`,
    });
    return;
  }
  const before = (await bond.balanceOf!(to.address)) as bigint;
  const sent = await send('transferByPartition', bond.transferByPartition!(...args, { gasLimit: GAS.transfer }));
  const after = (await bond.balanceOf!(to.address)) as bigint;
  step(ats, 'transfer-allowed', {
    tx: sent.hash,
    result:
      `the same ${whole(units(amount))} units, the same parties, now settle: ` +
      `balanceOf(${to.role}) ${before} to ${after}`,
    gasUsed: sent.gasUsed,
  });
}

/// Pause, freeze and the two failures they cause. These are the transfer
/// restriction controls DESIGN.md 3.8 asks the series to carry.
async function controls(session: Session, record: DeploymentRecord): Promise<void> {
  const ats = atsOf(record);
  if (ats.steps?.['freeze-blocks-transfer']?.tx !== undefined) {
    console.log('  the pause and freeze controls have already run');
    return;
  }
  const [first, second] = session.investors;
  if (first === undefined || second === undefined) throw new Error('two investors are required');
  const admin = noteContract(ats, session.operator);
  const holder = noteContract(ats, first.wallet);
  const frozenHolder = noteContract(ats, second.wallet);

  const paused = await send('pause', admin.pause!({ gasLimit: GAS.pause }));
  const whilePaused = await expectRevert(
    'transferByPartition while paused',
    holder,
    'transferByPartition',
    [PARTITION_1, { to: second.address, value: units(1n) }, '0x'],
    { gasLimit: GAS.transfer },
  );
  const unpaused = await send('unpause', admin.unpause!({ gasLimit: GAS.pause }));
  step(ats, 'pause', {
    tx: paused.hash,
    result: 'paused() reads true, under ROLE_PAUSER held by the operator',
    gasUsed: paused.gasUsed,
  });
  step(ats, 'pause-blocks-transfer', {
    tx: whilePaused.hash,
    revert: whilePaused.revert,
    result: 'one unit between two KYC granted noteholders is refused while the note is paused',
  });
  step(ats, 'unpause', {
    tx: unpaused.hash,
    result: 'paused() reads false again and transfers resume',
    gasUsed: unpaused.gasUsed,
  });

  const position = (await admin.balanceOf!(second.address)) as bigint;
  const frozen = await send(
    'freezePartialTokens',
    admin.freezePartialTokens!(second.address, units(FROZEN), { gasLimit: GAS.freeze }),
  );
  // A freeze moves the amount out of the partition balance, so balanceOf now
  // reports what is left to spend and the holder's position is balanceOf plus
  // getFrozenTokens. See docs/harness-notes.md.
  const frozenAmount = (await admin.getFrozenTokens!(second.address)) as bigint;
  const spendable = (await admin.balanceOf!(second.address)) as bigint;
  const tooMuch = spendable + units(1n);
  const whileFrozen = await expectRevert(
    'transferByPartition over the unfrozen balance',
    frozenHolder,
    'transferByPartition',
    [PARTITION_1, { to: first.address, value: tooMuch }, '0x'],
    { gasLimit: GAS.transfer },
  );
  const thawed = await send(
    'unfreezePartialTokens',
    admin.unfreezePartialTokens!(second.address, units(FROZEN), { gasLimit: GAS.freeze }),
  );
  const restored = (await admin.balanceOf!(second.address)) as bigint;
  step(ats, 'freeze', {
    tx: frozen.hash,
    result:
      `getFrozenTokens(${second.role}) reads ${frozenAmount} and balanceOf drops from ` +
      `${position} to ${spendable}: a freeze leaves the partition balance, so the position ` +
      `is balanceOf plus getFrozenTokens`,
    gasUsed: frozen.gasUsed,
  });
  step(ats, 'freeze-blocks-transfer', {
    tx: whileFrozen.hash,
    revert: whileFrozen.revert,
    result: `${tooMuch} is one unit more than the ${spendable} left unfrozen and is refused`,
  });
  step(ats, 'unfreeze', {
    tx: thawed.hash,
    result: `getFrozenTokens(${second.role}) reads 0 and balanceOf is back to ${restored}`,
    gasUsed: thawed.gasUsed,
  });
}

/// ATS declares a coupon and snapshots the holders. It never moves money: the
/// coupon facet has no settlement token anywhere in it. The payment is a
/// Scheduled Transaction from the vault's premium account, which is T14.
async function coupon(session: Session, record: DeploymentRecord): Promise<void> {
  const ats = atsOf(record);
  if (ats.coupon !== undefined) {
    console.log(`  coupon ${ats.coupon.id} already declared`);
    return;
  }
  const bond = noteContract(ats, session.operator);
  const now = Math.floor(Date.now() / 1000);
  // The accrual window is a real calendar month. The record and execution dates
  // are minutes out rather than at the end of that window so the settlement half
  // can be shown inside the event; a live series would put the record date at
  // the end of the accrual month.
  const plan = {
    recordDate: now + 5 * 60,
    executionDate: now + 10 * 60,
    startDate: now,
    endDate: monthAfter(now),
    fixingDate: now + 5 * 60,
    rate: COUPON.rate,
    rateDecimals: COUPON.rateDecimals,
    rateStatus: COUPON.rateStatusSet,
  };
  const id = (await bond.setCoupon!.staticCall(plan, { gasLimit: GAS.setCoupon })) as bigint;
  const sent = await send('setCoupon', bond.setCoupon!(plan, { gasLimit: GAS.setCoupon }));
  ats.coupon = {
    id: id.toString(),
    ratePercent: COUPON.ratePercent,
    rate: COUPON.rate.toString(),
    rateDecimals: COUPON.rateDecimals,
    recordTimestamp: plan.recordDate,
    executionTimestamp: plan.executionDate,
    startTimestamp: plan.startDate,
    endTimestamp: plan.endDate,
    fixingTimestamp: plan.fixingDate,
    tx: sent.hash,
  };
  step(ats, 'coupon', {
    tx: sent.hash,
    result:
      `coupon ${id} declared at ${COUPON.ratePercent} percent a year over ` +
      `${plan.startDate} to ${plan.endDate}, record ${plan.recordDate}, execution ${plan.executionDate}`,
    gasUsed: sent.gasUsed,
  });
}

/// After the record date, read the snapshot and the per holder entitlement.
/// The fraction is what T14 turns into a settlement token transfer.
async function couponcheck(session: Session, record: DeploymentRecord): Promise<void> {
  const ats = atsOf(record);
  if (ats.coupon === undefined) throw new Error('no coupon declared yet');
  const bond = noteContract(ats, session.operator);
  const id = BigInt(ats.coupon.id);
  // The second return is isDisabled_, not an existence flag: a coupon that was
  // never declared reads back as an all zero struct rather than reverting.
  const [registered, isDisabled] = (await bond.getCoupon!(id)) as [
    { coupon: { recordDate: bigint }; snapshotId: bigint },
    boolean,
  ];
  console.log(
    `  coupon ${id} recordDate ${registered.coupon.recordDate}, snapshot ${registered.snapshotId}, disabled ${isDisabled}`,
  );
  const lines: string[] = [`snapshotId ${registered.snapshotId}, isDisabled ${isDisabled}`];
  for (const investor of session.investors) {
    const detail = (await bond.getCouponFor!(id, investor.address)) as {
      tokenBalance: bigint;
      couponAmount: { numerator: bigint; denominator: bigint; recordDateReached: boolean };
    };
    const { numerator, denominator, recordDateReached } = detail.couponAmount;
    const minor = denominator === 0n ? 0n : (numerator * 10n ** 6n) / denominator;
    console.log(
      `  ${investor.role} balance ${detail.tokenBalance} numerator ${numerator} denominator ${denominator} -> ${minor} minor units`,
    );
    lines.push(
      `${investor.role} balance ${detail.tokenBalance}, ${numerator}/${denominator} = ${minor} minor units, recordDateReached ${recordDateReached}`,
    );
  }
  step(ats, 'coupon-entitlement', { result: lines.join('; ') });
}

async function verify(session: Session, record: DeploymentRecord): Promise<void> {
  const ats = atsOf(record);
  const bond = noteContract(ats, session.operator);
  const reads: [string, unknown][] = [
    ['name', await bond.name!()],
    ['symbol', await bond.symbol!()],
    ['decimals', await bond.decimals!()],
    ['totalSupply', await bond.totalSupply!()],
    ['getMaturityDate', await bond.getMaturityDate!()],
    ['isInternalKycActivated', await bond.isInternalKycActivated!()],
    ['isClearingActivated', await bond.isClearingActivated!()],
    ['paused', await bond.paused!()],
  ];
  for (const [name, value] of reads) console.log(`  ${name.padEnd(24)}${value}`);
  const balances: string[] = [];
  for (const investor of session.investors) {
    const held = (await bond.balanceOf!(investor.address)) as bigint;
    console.log(`  balanceOf ${investor.role.padEnd(14)}${held} (${whole(held)} units)`);
    balances.push(`${investor.role} ${held}`);
  }
  const outsider = (await bond.getKycStatusFor!(session.outsider.address)) as bigint;
  console.log(`  getKycStatusFor ${session.outsider.role} ${outsider}`);
  step(ats, 'verify', {
    result:
      `${reads.map(([name, value]) => `${name} ${String(value)}`).join(', ')}; ` +
      `${balances.join(', ')}; getKycStatusFor(${session.outsider.role}) ${outsider}`,
  });
  if (ats.note?.contractId === undefined && ats.note !== undefined) {
    ats.note.contractId = await contractIdOf(ats.note.address);
  }
  if (ats.note?.contractId !== undefined) {
    console.log(`  ${hashscan('contract', ats.note.contractId)}`);
  }
}

const HANDLERS: Record<Exclude<Step, 'all'>, (s: Session, r: DeploymentRecord) => Promise<void>> = {
  status,
  fund,
  throwaway,
  issue,
  roles,
  issuer,
  kyc1: (s, r) => grantKyc(s, r, 0),
  mint1: (s, r) => mint(s, r, 0, FIRST_MINT),
  blocked: (s, r) => transfer(s, r, MOVED, true),
  kyc2: (s, r) => grantKyc(s, r, 1),
  allowed: (s, r) => transfer(s, r, MOVED, false),
  mint2: (s, r) => mint(s, r, 1, SECOND_MINT),
  controls,
  coupon,
  couponcheck,
  verify,
};

async function main(): Promise<void> {
  const requested = (process.argv[2] ?? 'all') as Step;
  if (!STEPS.includes(requested)) {
    throw new Error(`unknown step "${requested}". One of: ${STEPS.join(', ')}`);
  }
  const session = openSession();
  const record = readRecord();
  const steps = requested === 'all' ? RUN : [requested];
  for (const name of steps) {
    console.log(name);
    try {
      await HANDLERS[name as Exclude<Step, 'all'>]!(session, record);
    } finally {
      writeRecord(record);
    }
  }
  console.log(`record: ${recordPath()}`);
}

await main();
