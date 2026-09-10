import type { Contract, Wallet } from 'ethers';

import { entryFor } from '../scripts/deploy/catalogue.js';
import {
  defaultSeries,
  findSeries,
  readRecord,
  recordPath,
  writeRecord,
  type DeploymentRecord,
  type SeriesRecord,
} from '../scripts/deploy/record.js';
import type { BondPlan } from './bond.js';
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
  hashscan,
  noteAt,
  openSession,
  operatorKey,
  send,
  type Session,
} from './chain.js';
import {
  monthAfter,
  nextCouponPeriod,
  type CouponPeriodPlan,
} from '../coupons/plan.js';
import { createKycCredential, grantKycArguments, verifyCredential } from './credential.js';
import { deployNote, emptyAtsRecord, planFor } from './note.js';
import { testIsinFor } from './isin.js';
import type { AtsCouponRecord, AtsRecord } from './record.js';

/// `pnpm ats:issue` issues a note series through the Asset Tokenization Studio
/// on Hedera testnet and runs the compliance sequence T06 asks for. It is
/// record driven: every step reads contracts/deployments/testnet.json, skips
/// what is already there and writes back what it did, so a relay timeout half
/// way through is recovered by running the same command again.
///
/// The series is the second argument, or the `ATS_SERIES` environment
/// variable, named by group key or by label. With neither it is the head of
/// the record, which is the demo series, so `pnpm ats:issue` with no arguments
/// does exactly what it did when the record held one series.
///
///     pnpm ats:issue                          the demo series, every step
///     pnpm ats:issue issue office_admin_support   one step, one other series

/// The series every handler acts on, resolved once in main().
let target = (process.env.ATS_SERIES ?? '').trim();

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
  'period',
  'nextcoupon',
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

/// The series this run acts on. It has to be in the record already: the vault
/// series and the note are two sides of one instrument and the note takes the
/// vault's maturity, so the chain registration comes first.
function seriesOf(record: DeploymentRecord): SeriesRecord {
  const series = target === '' ? defaultSeries(record) : findSeries(record, target);
  if (series === undefined) {
    throw new Error(
      target === ''
        ? 'no series in the deployment record: run `pnpm contracts:deploy` first'
        : `no series "${target}" in the deployment record: run \`pnpm series:capacity\` first`,
    );
  }
  return series;
}

function atsOf(record: DeploymentRecord): AtsRecord {
  const series = seriesOf(record);
  series.ats ??= emptyAtsRecord();
  return series.ats;
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
  for (const entry of declaredCoupons(ats)) {
    console.log(
      `coupon ${entry.id.padEnd(7)}${entry.startTimestamp} to ${entry.endTimestamp}, record ${entry.recordTimestamp}, execution ${entry.executionTimestamp}`,
    );
  }
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
  const probe = await deployNote(session, plan, 'Creance throwaway probe, not a series');
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
  const series = seriesOf(record);
  const version = await bondConfigVersion(session.provider);
  ats.configVersion = version;
  const plan = planFor(series, session.operator.address, version);
  ats.note = await deployNote(session, plan, `Creance Displacement Bond Note, series ${series.label}`);
  step(ats, 'issue', {
    tx: ats.note.deployTx,
    result:
      `series ${series.label} issued as an ATS bond, principal ${ats.note.principal}, ` +
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

/// Every coupon declared on the note, oldest first.
///
/// The record carried one coupon before it carried a list, so the list is
/// seeded from that field the first time either is read and both are written
/// from then on. Nothing else in the build reads `ats.coupon`.
function declaredCoupons(ats: AtsRecord): AtsCouponRecord[] {
  ats.coupons ??= ats.coupon === undefined ? [] : [ats.coupon];
  return ats.coupons;
}

/// Whether `pnpm coupons:pay` has settled a declared coupon for every holder
/// it recorded. A coupon with no holders recorded has not been paid at all.
function couponSettled(series: SeriesRecord, couponId: string): boolean {
  const holders = series.couponSettlements?.[couponId]?.holders ?? [];
  return holders.length > 0 && holders.every((holder) => holder.settled === true);
}

/// The note's maturity, which is the last date an accrual window may end on.
function noteMaturity(ats: AtsRecord): number {
  return ats.note?.maturityDate ?? 0;
}

/// Declare one coupon on the note and write it into the record.
async function declareCoupon(
  session: Session,
  ats: AtsRecord,
  plan: CouponPeriodPlan,
): Promise<AtsCouponRecord> {
  const bond = noteContract(ats, session.operator);
  const call = {
    recordDate: plan.recordDate,
    executionDate: plan.executionDate,
    startDate: plan.startDate,
    endDate: plan.endDate,
    fixingDate: plan.fixingDate,
    rate: COUPON.rate,
    rateDecimals: COUPON.rateDecimals,
    rateStatus: COUPON.rateStatusSet,
  };
  // staticCall first: setCoupon returns the id it assigned, and a transaction
  // receipt does not carry a return value through the relay.
  const id = (await bond.setCoupon!.staticCall(call, { gasLimit: GAS.setCoupon })) as bigint;
  const sent = await send('setCoupon', bond.setCoupon!(call, { gasLimit: GAS.setCoupon }));
  const declared: AtsCouponRecord = {
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
    ...(plan.broughtForward ? { recordDateBroughtForward: true } : {}),
  };
  declaredCoupons(ats).push(declared);
  step(ats, `coupon-${declared.id}`, {
    tx: sent.hash,
    result:
      `coupon ${declared.id} declared at ${COUPON.ratePercent} percent a year over ` +
      `${plan.startDate} to ${plan.endDate}, record ${plan.recordDate}, execution ` +
      `${plan.executionDate}${plan.broughtForward ? ', record date brought forward' : ''}`,
    gasUsed: sent.gasUsed,
  });
  console.log(
    `  coupon ${declared.id} over ${plan.startDate} to ${plan.endDate}, record ${plan.recordDate}, execution ${plan.executionDate}`,
  );
  return declared;
}

/// ATS declares a coupon and snapshots the holders. It never moves money: the
/// coupon facet has no settlement token anywhere in it. The payment is a
/// Scheduled Transaction from the vault's premium account, which is T14.
///
/// This is the first period, which is the one the note is issued with. The
/// ones after it are the `period` step.
async function coupon(session: Session, record: DeploymentRecord): Promise<void> {
  const ats = atsOf(record);
  const declared = declaredCoupons(ats);
  if (declared.length > 0) {
    console.log(`  coupon ${declared[0]!.id} already declared`);
    return;
  }
  const now = Math.floor(Date.now() / 1000);
  // The accrual window is a real calendar month. The record and execution dates
  // are minutes out rather than at the end of that window so the settlement half
  // can be shown inside the event; a live series would put the record date at
  // the end of the accrual month.
  const first = await declareCoupon(session, ats, {
    recordDate: now + 5 * 60,
    executionDate: now + 10 * 60,
    startDate: now,
    endDate: monthAfter(now),
    fixingDate: now + 5 * 60,
    broughtForward: true,
  });
  ats.coupon = first;
}

/// The next accrual period, declared so it can be settled today.
///
/// One period per run, and it refuses while an earlier period is payable and
/// unpaid, because a note that declares coupons faster than it settles them is
/// a note in arrears rather than a series accruing.
async function period(session: Session, record: DeploymentRecord): Promise<void> {
  const ats = atsOf(record);
  const series = seriesOf(record);
  const declared = declaredCoupons(ats);
  if (declared.length === 0) {
    throw new Error('no coupon declared yet: run `pnpm ats:issue coupon` first');
  }
  const now = Math.floor(Date.now() / 1000);
  const owing = declared.find(
    (entry) => entry.executionTimestamp <= now && !couponSettled(series, entry.id),
  );
  if (owing !== undefined) {
    throw new Error(
      `coupon ${owing.id} is payable and unsettled: run \`pnpm coupons:pay all ${owing.id}\` before declaring another period`,
    );
  }
  const previousEnd = Math.max(...declared.map((entry) => entry.endTimestamp));
  await declareCoupon(
    session,
    ats,
    nextCouponPeriod({
      previousEnd,
      now,
      maturityDate: noteMaturity(ats),
      recordDate: 'brought forward',
    }),
  );
}

/// The period after the last one, declared on its own dates.
///
/// Its record date is the end of its own accrual window rather than minutes
/// out, so it is the next payment the note owes and not one more period to
/// settle today. It is what the investor screen reads as the next payment.
async function nextcoupon(session: Session, record: DeploymentRecord): Promise<void> {
  const ats = atsOf(record);
  const declared = declaredCoupons(ats);
  if (declared.length === 0) {
    throw new Error('no coupon declared yet: run `pnpm ats:issue coupon` first');
  }
  const now = Math.floor(Date.now() / 1000);
  const ahead = declared.find((entry) => entry.recordTimestamp > now);
  if (ahead !== undefined) {
    console.log(`  coupon ${ahead.id} is already declared with a record date ahead of now`);
    return;
  }
  const previousEnd = Math.max(...declared.map((entry) => entry.endTimestamp));
  await declareCoupon(
    session,
    ats,
    nextCouponPeriod({
      previousEnd,
      now,
      maturityDate: noteMaturity(ats),
      recordDate: 'at the window end',
    }),
  );
}

/// After the record date, read the snapshot and the per holder entitlement,
/// for every coupon declared on the note. The fraction is what T14 turns into
/// a settlement token transfer.
async function couponcheck(session: Session, record: DeploymentRecord): Promise<void> {
  const ats = atsOf(record);
  const declared = declaredCoupons(ats);
  if (declared.length === 0) throw new Error('no coupon declared yet');
  const bond = noteContract(ats, session.operator);
  const count = (await bond.getCouponCount!()) as bigint;
  console.log(`  getCouponCount ${count}, ${declared.length} in the record`);
  for (const entry of declared) {
    const id = BigInt(entry.id);
    // The second return is isDisabled_, not an existence flag: a coupon that was
    // never declared reads back as an all zero struct rather than reverting.
    const [registered, isDisabled] = (await bond.getCoupon!(id)) as [
      { coupon: { recordDate: bigint; startDate: bigint; endDate: bigint }; snapshotId: bigint },
      boolean,
    ];
    console.log(
      `  coupon ${id} over ${registered.coupon.startDate} to ${registered.coupon.endDate}, ` +
        `recordDate ${registered.coupon.recordDate}, snapshot ${registered.snapshotId}, disabled ${isDisabled}`,
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
    step(ats, `coupon-entitlement-${entry.id}`, { result: lines.join('; ') });
  }
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
  period,
  nextcoupon,
  couponcheck,
  verify,
};

async function main(): Promise<void> {
  const requested = (process.argv[2] ?? 'all') as Step;
  if (!STEPS.includes(requested)) {
    throw new Error(`unknown step "${requested}". One of: ${STEPS.join(', ')}`);
  }
  const named = (process.argv[3] ?? '').trim();
  if (named !== '') {
    // Fail on a name the catalogue does not know before any transaction is
    // sent, rather than issuing a note against the wrong series.
    target = entryFor(named).label;
  }
  const session = openSession();
  const record = readRecord();
  console.log(`series        ${seriesOf(record).label}`);
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
