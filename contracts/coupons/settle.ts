import { TopicMessageSubmitTransaction } from '@hiero-ledger/sdk';
import { hashscanUrl, scheduleContractCall, waitForExecution } from '@creance/client';

import { contractIdOf, send } from '../ats/chain.js';
import type { AtsCouponRecord } from '../ats/record.js';
import type { DeploymentRecord } from '../scripts/deploy/record.js';
import { EXECUTION_POLL, GAS, PROBE_LEAD_SECONDS, SCHEDULE_LEAD_SECONDS } from './config.js';
import {
  demoNoteAddress,
  demoSeries,
  noteContract,
  openCouponContext,
  type CouponContext,
  type Party,
} from './context.js';
import {
  couponDue,
  couponMemo,
  couponRef,
  couponSettlementMessage,
  encodeCouponSettlement,
  settlementAmount,
  settlementRemainder,
  toBytes32,
  type CouponDueVerdict,
} from './plan.js';
import type { CouponHolderSettlement, CouponSettlementRecord } from './record.js';
import { subscribe } from './subscribe.js';
import { fundAccounts, tokenBalanceOf } from './vault.js';

/// `pnpm coupons:pay` settles a declared ATS coupon on Hedera testnet.
///
/// The two halves stay apart, as docs/DECISIONS.md sets out: the Asset
/// Tokenization Studio coupon action declares the rate, the window and each
/// holder's entitlement, and it never moves money because there is no
/// settlement token anywhere in the coupon facet. The money moves as a Hedera
/// Scheduled Transaction of the settlement token, funded out of the vault's
/// premium account, and the link between the two is recorded rather than
/// inferred.
///
/// Record driven like `pnpm ats:issue`: every step reads
/// contracts/deployments/testnet.json, skips what is already there and writes
/// back what it did, so a relay timeout half way through is recovered by
/// running the same command again.
///
/// The coupon is the second argument, or the `COUPON_ID` environment variable.
/// With neither it is the earliest declared coupon that is payable and not yet
/// settled, so a note that has declared three periods and paid one is caught up
/// by running the command again.
///
///     pnpm coupons:pay              the period that is owed, every step
///     pnpm coupons:pay all 3        one named coupon
///     pnpm coupons:pay status       what the chain says, no transactions
///
/// When nothing is owed, because every declared period is paid and the next
/// one's record date is months away, the run says so and skips the steps
/// that read an entitlement rather than failing on the note's zero answer.
/// A coupon named on the command line is different: the operator asked for
/// that one, so a coupon that is not due is an error there.

const STEPS = [
  'status',
  'fund',
  'probe',
  'seed',
  'subscribe',
  'pay',
  'publish',
  'verify',
  'all',
] as const;
type Step = (typeof STEPS)[number];

const RUN: Step[] = ['fund', 'probe', 'seed', 'subscribe', 'pay', 'publish', 'verify'];

/// The steps that read a coupon entitlement off the note, which is the answer
/// the note does not have before the record date.
const NEEDS_DUE: ReadonlySet<Step> = new Set<Step>(['seed', 'pay']);

function now(): number {
  return Math.floor(Date.now() / 1000);
}

/// The coupon this run settles, from the argument or the environment. Empty
/// means the run picks the period that is owed.
let target = (process.env.COUPON_ID ?? '').trim();

/// The SDK prints an HBAR amount with its symbol on the end. The record is read
/// by machines, so it keeps the number.
function hbarAmount(value: string | null): string | undefined {
  if (value === null) return undefined;
  const match = /-?\d+(\.\d+)?/.exec(value);
  return match?.[0];
}

/// Every coupon declared on the note, oldest first. The record carried one
/// coupon before it carried a list, so a record written then still reads.
function declaredCoupons(record: DeploymentRecord): AtsCouponRecord[] {
  const ats = demoSeries(record).ats;
  if (ats === undefined) return [];
  return ats.coupons ?? (ats.coupon === undefined ? [] : [ats.coupon]);
}

/// Whether every holder recorded against a coupon was paid.
function alreadySettled(record: DeploymentRecord, couponId: string): boolean {
  const holders = demoSeries(record).couponSettlements?.[couponId]?.holders ?? [];
  return holders.length > 0 && holders.every((holder) => holder.settled === true);
}

/// Which coupon this run is about, decided once.
///
/// Resolved once and remembered, because the answer depends on what is settled
/// and the `pay` step changes that: a run whose `publish` step asked again
/// would publish the next period's empty settlement instead of the one it just
/// paid.
let chosen: AtsCouponRecord | undefined;

function couponMeta(record: DeploymentRecord): AtsCouponRecord {
  if (chosen !== undefined) return chosen;
  const declared = declaredCoupons(record);
  if (declared.length === 0) {
    throw new Error('no coupon declared on the note: run `pnpm ats:issue coupon` first');
  }
  if (target !== '') {
    const named = declared.find((entry) => entry.id === target);
    if (named === undefined) {
      throw new Error(
        `no coupon ${target} on the note: declared are ${declared.map((entry) => entry.id).join(', ')}`,
      );
    }
    chosen = named;
    return chosen;
  }
  // The period that is owed: payable, and not paid. Failing that the last one
  // declared, so every step reports "already settled" rather than throwing.
  chosen =
    declared.find(
      (entry) => entry.executionTimestamp <= now() && !alreadySettled(record, entry.id),
    ) ?? declared[declared.length - 1];
  return chosen as AtsCouponRecord;
}

/// The settlement record for the declared coupon if a step has written one.
/// The steps that only read use this, so a run that settles nothing leaves no
/// empty entry behind in the tracked record.
function recordedSettlement(context: CouponContext): CouponSettlementRecord | undefined {
  const coupon = couponMeta(context.record);
  return demoSeries(context.record).couponSettlements?.[coupon.id];
}

/// The settlement record for the declared coupon, created on first use so every
/// step can write into the same entry.
function settlementOf(context: CouponContext): CouponSettlementRecord {
  const record = context.record;
  const series = demoSeries(record);
  const coupon = couponMeta(record);
  series.couponSettlements ??= {};
  series.couponSettlements[coupon.id] ??= {
    couponId: coupon.id,
    seriesLabel: series.label,
    couponRef: couponRef(series.label, coupon.id),
    recordDate: coupon.recordTimestamp,
    executionDate: coupon.executionTimestamp,
    startDate: coupon.startTimestamp,
    endDate: coupon.endTimestamp,
    ratePercent: coupon.ratePercent,
    holders: [],
  };
  return series.couponSettlements[coupon.id] as CouponSettlementRecord;
}

function holderEntry(
  settlement: CouponSettlementRecord,
  investor: Party,
): CouponHolderSettlement | undefined {
  return settlement.holders.find((holder) => holder.role === investor.role);
}

/// The 0.0.x id of the vault, which is what a ContractExecuteTransaction takes.
/// It is not in the deployment record from T04, so it is resolved once on the
/// mirror node and written back.
async function vaultContractId(context: CouponContext): Promise<string> {
  const vaultRecord = context.record.collateralVault;
  if (vaultRecord === undefined) throw new Error('no vault in the deployment record');
  if (vaultRecord.contractId === undefined) {
    const resolved = await contractIdOf(vaultRecord.address);
    if (resolved === undefined) {
      throw new Error(`the mirror node does not know ${vaultRecord.address}`);
    }
    vaultRecord.contractId = resolved;
    context.save();
  }
  return vaultRecord.contractId;
}

/// What a scheduled contract call did, read back from the mirror node.
///
/// The contract result of a scheduled call is not reachable by its transaction
/// id: `/contracts/results/{transactionId}` answers 404 for it. It is reachable
/// by the consensus timestamp of the execution, which is what the schedule
/// record carries. See docs/harness-notes.md.
async function contractResultAt(
  context: CouponContext,
  executedAt: string,
): Promise<{ result: string; gasUsed?: number; revert?: string } | undefined> {
  const response = await fetch(`${context.mirrorUrl}/contracts/results?timestamp=${executedAt}`);
  if (!response.ok) return undefined;
  const body = (await response.json()) as {
    results?: { result?: string; error_message?: string | null; gas_used?: number }[];
  };
  const outcome = body.results?.[0];
  if (outcome === undefined) return undefined;
  return {
    result: outcome.result ?? '',
    ...(outcome.gas_used === undefined ? {} : { gasUsed: outcome.gas_used }),
    ...(decodeRevert(context, outcome.error_message) === undefined
      ? {}
      : { revert: decodeRevert(context, outcome.error_message) as string }),
  };
}

/// The custom error name behind four bytes of revert data. Every error the
/// vault can raise is in its ABI, so a revert reads back as a name.
function decodeRevert(context: CouponContext, data: string | null | undefined): string | undefined {
  if (data === null || data === undefined || !data.startsWith('0x') || data.length < 10) {
    return data ?? undefined;
  }
  try {
    const parsed = context.vault.interface.parseError(data);
    if (parsed !== null) {
      return parsed.args.length > 0
        ? `${parsed.name}(${parsed.args.map((value) => String(value)).join(', ')})`
        : parsed.name;
    }
  } catch {
    // Not one of the vault's own errors; the raw data is still evidence.
  }
  return data;
}

// ---------------------------------------------------------------- status

async function status(context: CouponContext): Promise<void> {
  const { record } = context;
  const series = demoSeries(record);
  const coupon = couponMeta(record);
  const note = noteContract(demoNoteAddress(record), context.provider);

  const premium = (await context.vault.getFunction('premiumBalanceOf')(series.id)) as bigint;
  const state = (await context.vault.getFunction('seriesOf')(series.id)) as {
    principalFunded: bigint;
    principalPaid: bigint;
    principalRedeemed: bigint;
    reserved: bigint;
    maturityAt: bigint;
  };
  console.log(`  series          ${series.label} ${series.id}`);
  console.log(`  principalFunded ${state.principalFunded}`);
  console.log(`  principalPaid   ${state.principalPaid}`);
  console.log(`  reserved        ${state.reserved}`);
  console.log(`  premiumBalance  ${premium}`);
  console.log(`  vault TUSD      ${await tokenBalanceOf(context, (context.vault.target as string))}`);
  for (const entry of declaredCoupons(record)) {
    console.log(
      `  coupon ${entry.id} at ${entry.ratePercent} percent over ${entry.startTimestamp} to ` +
        `${entry.endTimestamp}, execution ${entry.executionTimestamp}, settled ` +
        `${alreadySettled(record, entry.id)}${entry.recordDateBroughtForward === true ? ', record date brought forward' : ''}`,
    );
  }
  console.log(`  this run would settle coupon ${coupon.id} (now ${now()})`);

  // What the next period costs and who pays for it. The premium account is
  // seeded from a policyholder and the schedules are paid for by the api
  // account, so a run that is about to run short says so before it starts.
  for (const party of [context.policyholder, ...context.investors, context.api, context.operator]) {
    const hbar = await context.provider.getBalance(party.address);
    const tusd = await tokenBalanceOf(context, party.address);
    console.log(`  ${party.role.padEnd(15)}${hbar / 10n ** 18n} HBAR, ${tusd} TUSD minor units`);
  }

  for (const investor of context.investors) {
    const detail = (await note.getFunction('getCouponFor')(BigInt(coupon.id), investor.address)) as {
      tokenBalance: bigint;
      couponAmount: { numerator: bigint; denominator: bigint; recordDateReached: boolean };
    };
    const { numerator, denominator, recordDateReached } = detail.couponAmount;
    const amount = denominator === 0n ? 0n : settlementAmount(numerator, denominator, context.decimals);
    const subscription = (await context.vault.getFunction('subscriptionOf')(
      series.id,
      investor.address,
    )) as bigint;
    console.log(
      `  ${investor.role} note ${detail.tokenBalance}, subscription ${subscription}, ` +
        `entitlement ${numerator}/${denominator} = ${amount} minor units, recordDateReached ${recordDateReached}`,
    );
  }
}

// ---------------------------------------------------------------- probe

/**
 * Can a contract call be wrapped in a Scheduled Transaction on testnet today,
 * and does the vault see the schedule payer as the caller?
 *
 * It decides the shape of the settlement. If a `ContractExecuteTransaction` is
 * schedulable and executes with the payer as `msg.sender`, then `fundCoupon`
 * itself can be scheduled for the coupon's execution date and the vault pays
 * each noteholder straight out of the premium account. If it is not, the vault
 * has no key with which to sign anything, and the payment has to be two moves:
 * `fundCoupon` to the treasury account, then a scheduled transfer from there.
 *
 * The probe schedules `fundCoupon` with a zero amount, which is free and cannot
 * move money: the vault checks the role before it checks the amount, so the
 * revert name is the answer. `ZeroAmount` means the role check passed and the
 * caller is the payer. An access control error means it did not.
 */
async function probe(context: CouponContext): Promise<void> {
  const recorded = recordedSettlement(context);
  if (recorded?.scheduledContractCall?.result !== undefined) {
    console.log(`  already measured: ${recorded.scheduledContractCall.status}`);
    return;
  }
  // The answer is a property of the network and the vault, not of a coupon, so
  // a measurement taken for an earlier period stands. Re-probing would cost
  // another schedule fee to learn the same thing.
  const earlier = Object.values(demoSeries(context.record).couponSettlements ?? {}).find(
    (entry) => entry.scheduledContractCall?.result !== undefined,
  );
  if (earlier !== undefined) {
    console.log(
      `  measured on coupon ${earlier.couponId}: ${earlier.scheduledContractCall?.status}, ` +
        `${earlier.scheduledContractCall?.result} ${earlier.scheduledContractCall?.revert ?? ''}`,
    );
    return;
  }
  const settlement = settlementOf(context);
  const series = demoSeries(context.record);
  const vaultId = await vaultContractId(context);
  const data = context.vault.interface.encodeFunctionData('fundCoupon', [
    series.id,
    toBytes32(settlement.couponRef),
    context.api.address,
    0n,
  ]);
  const executeAt = new Date((now() + PROBE_LEAD_SECONDS) * 1000);

  let statusText: string;
  let scheduleId: string | undefined;
  try {
    const created = await scheduleContractCall({
      client: context.client,
      contractId: vaultId,
      callData: data,
      gas: GAS.fundCoupon,
      payer: { accountId: context.api.accountId, key: context.api.key },
      executeAt,
      memo: `creance probe scheduled fundCoupon ${series.label}`,
      adminKey: context.api.key.publicKey,
    });
    scheduleId = created.scheduleId;
    statusText = 'create SUCCESS';
  } catch (error) {
    const status = (error as { status?: { toString(): string } }).status;
    statusText = `create rejected ${status ? status.toString() : (error as Error).message}`;
  }
  console.log(`  ScheduleCreate around a ContractExecuteTransaction: ${statusText}`);

  let result: string | undefined;
  let revert: string | undefined;
  if (scheduleId !== undefined) {
    console.log(`  waiting for ${scheduleId} to execute at ${executeAt.toISOString()}`);
    const execution = await waitForExecution(context.mirrorUrl, scheduleId, { ...EXECUTION_POLL });
    if (execution !== null) {
      result = execution.result;
      const outcome = await contractResultAt(context, execution.executedAt);
      revert = outcome?.revert;
      console.log(`  executed ${execution.executedTransactionId} result ${result} ${revert ?? ''}`);
    } else {
      result = 'never executed';
    }
  }
  settlement.scheduledContractCall = {
    attempted: true,
    status: statusText,
    ...(scheduleId === undefined ? {} : { scheduleId }),
    ...(result === undefined ? {} : { result }),
    ...(revert === undefined ? {} : { revert }),
  };
}

// ----------------------------------------------------------------- seed

/**
 * Put the coupon's own cost into the premium account.
 *
 * The premium account is empty because no policy has been bound yet: T07 binds
 * policies and it is blocked behind T02, so there is no premium inflow to pay
 * this coupon from. A policyholder account therefore sends the amount as a
 * stand-in premium and the api account, which holds TREASURY_ROLE, attributes
 * it to the series. The live path is the same second call made by the premium
 * schedule watcher after each settled premium. See docs/DECISIONS.md.
 *
 * The 20 TUSD already sitting in the vault belongs to the T04 throwaway series
 * and is deliberately left alone: `attributePremium` names the series, so only
 * what this step sends is credited to the demo series.
 */
async function seed(context: CouponContext): Promise<void> {
  const settlement = settlementOf(context);
  if (settlement.premiumSeed !== undefined) {
    console.log(`  premium already seeded: ${settlement.premiumSeed.amount} minor units`);
    return;
  }
  const series = demoSeries(context.record);
  const note = noteContract(demoNoteAddress(context.record), context.provider);
  const coupon = couponMeta(context.record);

  let total = 0n;
  for (const investor of context.investors) {
    const detail = (await note.getFunction('getCouponFor')(BigInt(coupon.id), investor.address)) as {
      couponAmount: { numerator: bigint; denominator: bigint; recordDateReached: boolean };
    };
    const { numerator, denominator } = detail.couponAmount;
    // A zero denominator is the note saying the record date has not passed,
    // which main() decides before this step runs; read it as nothing owed
    // rather than as arithmetic to refuse.
    total += denominator === 0n ? 0n : settlementAmount(numerator, denominator, context.decimals);
  }
  if (total === 0n) throw new Error('the coupon owes nothing: check the record date has passed');

  const vaultAddress = context.vault.target as string;
  const before = (await context.vault.getFunction('premiumBalanceOf')(series.id)) as bigint;
  if (before >= total) {
    console.log(`  premium balance is already ${before}, nothing to seed`);
    return;
  }
  const wanted = total - before;

  const transfer = await send(
    'stand-in premium transfer',
    context.token
      .connect(context.policyholder.wallet)
      .getFunction('transfer')(vaultAddress, wanted, { gasLimit: GAS.transfer }),
  );
  const attribute = await send(
    'attributePremium',
    context.vault.getFunction('attributePremium')(series.id, wanted, {
      gasLimit: GAS.attributePremium,
    }),
  );
  const after = (await context.vault.getFunction('premiumBalanceOf')(series.id)) as bigint;
  console.log(`  premiumBalanceOf ${before} to ${after}`);
  settlement.premiumSeed = {
    from: context.policyholder.accountId,
    amount: wanted.toString(),
    transferTx: transfer.hash,
    attributeTx: attribute.hash,
    attributeGasUsed: attribute.gasUsed,
  };
}

// ------------------------------------------------------------------- pay

/**
 * Pay each noteholder their entitlement with a Scheduled Transaction that
 * carries the vault's own `fundCoupon` call.
 *
 * The settlement token goes straight from the premium account to the
 * noteholder: the schedule holds a contract call, not a transfer, so no
 * intermediate account ever holds a noteholder's coupon. The vault has no key
 * of its own, and it does not need one, because a scheduled contract call runs
 * under the schedule payer's authority and the payer here is the api account,
 * which holds TREASURY_ROLE. That was measured before it was relied on: see the
 * probe step and docs/harness-notes.md.
 *
 * `fundCoupon` pays only from `premiumBalance` and reverts `InsufficientPremium`
 * rather than touching principal, so the guard against paying a coupon out of
 * the noteholders' own money is in the contract and not in this script.
 */
async function pay(context: CouponContext): Promise<void> {
  const settlement = settlementOf(context);
  const series = demoSeries(context.record);
  const coupon = couponMeta(context.record);
  const note = noteContract(demoNoteAddress(context.record), context.provider);
  const reference = toBytes32(settlement.couponRef);
  const vaultId = await vaultContractId(context);

  if (now() < coupon.executionTimestamp) {
    throw new Error(
      `coupon ${coupon.id} becomes payable at ${coupon.executionTimestamp}, which is ${
        coupon.executionTimestamp - now()
      } seconds away`,
    );
  }

  const executeAt = new Date((now() + SCHEDULE_LEAD_SECONDS) * 1000);
  const pending: { investor: Party; entry: CouponHolderSettlement }[] = [];

  for (const investor of context.investors) {
    let entry = holderEntry(settlement, investor);
    if (entry?.settled === true) {
      console.log(`  ${investor.role} already settled in ${entry.executedTransactionId}`);
      continue;
    }
    const detail = (await note.getFunction('getCouponFor')(BigInt(coupon.id), investor.address)) as {
      couponAmount: { numerator: bigint; denominator: bigint; recordDateReached: boolean };
    };
    const { numerator, denominator, recordDateReached } = detail.couponAmount;
    // recordDateReached is the signal, not snapshotId: the snapshot is taken
    // lazily and reads back as zero long after the record date has passed.
    if (!recordDateReached) {
      throw new Error(`the record date for coupon ${coupon.id} has not been reached`);
    }
    const amount = settlementAmount(numerator, denominator, context.decimals);
    const remainder = settlementRemainder(numerator, denominator, context.decimals);
    console.log(`  ${investor.role} ${numerator}/${denominator} = ${amount} minor units`);

    entry = {
      ...(entry ?? {}),
      role: investor.role,
      accountId: investor.accountId,
      address: investor.address,
      numerator: numerator.toString(),
      denominator: denominator.toString(),
      amount: amount.toString(),
      remainder: remainder.toString(),
    };

    if (entry.scheduleId === undefined) {
      const memo = couponMemo(series.label, coupon.id, investor.role);
      const callData = context.vault.interface.encodeFunctionData('fundCoupon', [
        series.id,
        reference,
        investor.address,
        amount,
      ]);
      const scheduled = await scheduleContractCall({
        client: context.client,
        contractId: vaultId,
        callData,
        gas: GAS.fundCoupon,
        payer: { accountId: context.api.accountId, key: context.api.key },
        executeAt,
        memo,
        // Without an admin key a schedule is immutable, and a coupon that has to
        // be stopped before it executes cannot be, so every schedule this build
        // owns carries one.
        adminKey: context.api.key.publicKey,
        waitForExpiry: true,
        readFee: true,
      });
      console.log(
        `  scheduled ${scheduled.scheduleId} for ${executeAt.toISOString()}, create fee ${scheduled.createFeeHbar}`,
      );
      entry.scheduleId = scheduled.scheduleId;
      entry.scheduleCreateTx = scheduled.createTransactionId;
      entry.scheduleMemo = memo;
      entry.executeAt = executeAt.toISOString();
      entry.createFeeHbar = hbarAmount(scheduled.createFeeHbar);
      entry.links = {
        ...(entry.links ?? {}),
        schedule: scheduled.links.schedule,
        scheduleCreate: scheduled.links.create,
      };
    }

    settlement.holders = [
      ...settlement.holders.filter((holder) => holder.role !== investor.role),
      entry,
    ];
    context.save();
    pending.push({ investor, entry });
  }

  for (const { investor, entry } of pending) {
    if (entry.scheduleId === undefined) continue;
    console.log(`  waiting for ${investor.role} schedule ${entry.scheduleId}`);
    const execution = await waitForExecution(context.mirrorUrl, entry.scheduleId, {
      ...EXECUTION_POLL,
    });
    if (execution === null) {
      console.log(`  ${investor.role} schedule ${entry.scheduleId} has not executed`);
      continue;
    }
    // A schedule executes whether or not the transaction inside it succeeded, so
    // only SUCCESS is a payment. A reverted fundCoupon leaves the premium
    // account untouched and the holder unpaid, and it must not be recorded or
    // published as though the coupon had been settled.
    const outcome = await contractResultAt(context, execution.executedAt);
    entry.executedAt = execution.executedAt;
    entry.executedTransactionId = execution.executedTransactionId;
    entry.result = execution.result;
    entry.settled = execution.settled;
    entry.gasUsed = outcome?.gasUsed;
    entry.links = { ...(entry.links ?? {}), settlement: execution.link };
    console.log(
      `  ${investor.role} executed ${execution.executedTransactionId} result ${execution.result}` +
        `${outcome?.revert === undefined ? '' : ` ${outcome.revert}`}, gas ${outcome?.gasUsed ?? 0}`,
    );
    context.save();
  }
}

// --------------------------------------------------------------- publish

/**
 * Write each settled coupon to the payments topic, under the api key, which is
 * the topic's submit key. The message carries the coupon id, the holder, the
 * fraction the entitlement came from, the computed amount, the schedule id and
 * the executed transaction, so the audit read side T18 builds never has to
 * recompute anything or trust this script's arithmetic.
 */
async function publish(context: CouponContext): Promise<void> {
  const settlement = recordedSettlement(context);
  const series = demoSeries(context.record);
  if (settlement === undefined) {
    console.log(`  coupon ${couponMeta(context.record).id} has no settlement, nothing to publish`);
    return;
  }

  for (const entry of settlement.holders) {
    if (entry.settled !== true) {
      console.log(`  ${entry.role} did not settle, nothing to publish`);
      continue;
    }
    if (entry.topicSequenceNumber !== undefined) {
      console.log(`  ${entry.role} already published at sequence ${entry.topicSequenceNumber}`);
      continue;
    }
    const message = encodeCouponSettlement(
      couponSettlementMessage({
        seriesLabel: series.label,
        seriesId: series.id,
        couponId: settlement.couponId,
        holderAccountId: entry.accountId,
        holderAddress: entry.address,
        numerator: BigInt(entry.numerator),
        denominator: BigInt(entry.denominator),
        amount: BigInt(entry.amount),
        tokenId: context.tokenId,
        scheduleId: entry.scheduleId ?? '',
        transactionId: entry.executedTransactionId ?? '',
        result: entry.result ?? '',
        paidAt: entry.executedAt ?? '',
      }),
    );
    const response = await new TopicMessageSubmitTransaction()
      .setTopicId(context.paymentsTopicId)
      .setMessage(message)
      .execute(context.client);
    const receipt = await response.getReceipt(context.client);
    entry.topicSequenceNumber = receipt.topicSequenceNumber?.toString();
    entry.topicTx = response.transactionId.toString();
    entry.links = {
      ...(entry.links ?? {}),
      topic: hashscanUrl('topic', context.paymentsTopicId),
    };
    console.log(`  ${entry.role} published at sequence ${entry.topicSequenceNumber}`);
    context.save();
  }
}

// ---------------------------------------------------------------- verify

async function verify(context: CouponContext): Promise<void> {
  const settlement = recordedSettlement(context);
  const series = demoSeries(context.record);
  const premium = (await context.vault.getFunction('premiumBalanceOf')(series.id)) as bigint;
  const state = (await context.vault.getFunction('seriesOf')(series.id)) as {
    principalFunded: bigint;
    principalPaid: bigint;
    premiumBalance: bigint;
  };
  console.log(`  premiumBalanceOf ${premium}`);
  console.log(`  principalFunded  ${state.principalFunded}`);
  if (settlement === undefined) {
    console.log(`  coupon ${couponMeta(context.record).id} has no settlement, nothing paid`);
    return;
  }
  for (const entry of settlement.holders) {
    const balance = await tokenBalanceOf(context, entry.address);
    console.log(
      `  ${entry.role} paid ${entry.amount} in ${entry.executedTransactionId} (${entry.result}), TUSD balance ${balance}`,
    );
  }
}

// ------------------------------------------------------------------ main

const HANDLERS: Record<Exclude<Step, 'all'>, (context: CouponContext) => Promise<void>> = {
  status,
  fund: fundAccounts,
  probe,
  seed,
  subscribe,
  pay,
  publish,
  verify,
};

/// Whether the chosen coupon can be settled today, asked of the note once.
///
/// `recordDateReached` is read for every holder rather than assumed from the
/// dates, because it is the note's own answer and the entitlement is empty
/// without it. See docs/harness-notes.md on why `snapshotId` is not the signal.
async function dueVerdict(context: CouponContext): Promise<CouponDueVerdict> {
  const coupon = couponMeta(context.record);
  const note = noteContract(demoNoteAddress(context.record), context.provider);
  let recordDateReached = context.investors.length > 0;
  for (const investor of context.investors) {
    const detail = (await note.getFunction('getCouponFor')(BigInt(coupon.id), investor.address)) as {
      couponAmount: { recordDateReached: boolean };
    };
    recordDateReached = recordDateReached && detail.couponAmount.recordDateReached;
  }
  return couponDue({
    couponId: coupon.id,
    executionTimestamp: coupon.executionTimestamp,
    now: now(),
    recordDateReached,
  });
}

async function main(): Promise<void> {
  const requested = (process.argv[2] ?? 'all') as Step;
  if (!STEPS.includes(requested)) {
    throw new Error(`unknown step "${requested}". One of: ${STEPS.join(', ')}`);
  }
  const named = (process.argv[3] ?? '').trim();
  if (named !== '') target = named;
  const context = openCouponContext();
  const coupon = couponMeta(context.record);
  console.log(`coupon        ${coupon.id}`);
  const steps = requested === 'all' ? RUN : [requested];

  // Decided once, up front, so a run whose coupons are up to date reports
  // that in one line and still runs the steps that do not need an entitlement.
  const skipped = new Set<Step>();
  if (steps.some((step) => NEEDS_DUE.has(step))) {
    const verdict = await dueVerdict(context);
    if (!verdict.due) {
      if (target !== '') {
        throw new Error(`coupon ${coupon.id} is not due: ${verdict.reason}`);
      }
      const names = steps.filter((step) => NEEDS_DUE.has(step));
      console.log(`coupon ${coupon.id} is not due: ${verdict.reason}, skipping ${names.join(' and ')}`);
      for (const step of names) skipped.add(step);
    }
  }

  for (const name of steps) {
    console.log(name);
    if (skipped.has(name)) {
      console.log(`  skipped, coupon ${coupon.id} is not due`);
      continue;
    }
    try {
      await HANDLERS[name as Exclude<Step, 'all'>]!(context);
    } finally {
      context.save();
    }
  }
  context.client.close();
}

await main();
