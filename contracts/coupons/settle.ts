import {
  ContractExecuteTransaction,
  ScheduleCreateTransaction,
  Timestamp,
  TopicMessageSubmitTransaction,
  TransactionId,
} from '@hiero-ledger/sdk';
import {
  hashscanUrl,
  scheduleTransfer,
  waitForExecution,
  type ScheduledTransfer,
} from '@creance/client';

import { hashscan, send } from '../ats/chain.js';
import type { DeploymentRecord } from '../scripts/deploy/record.js';
import { EXECUTION_POLL, GAS, SCHEDULE_LEAD_SECONDS } from './config.js';
import {
  demoNoteAddress,
  demoSeries,
  noteContract,
  openCouponContext,
  type CouponContext,
  type Party,
} from './context.js';
import {
  couponMemo,
  couponRef,
  couponSettlementMessage,
  encodeCouponSettlement,
  settlementAmount,
  settlementRemainder,
  toBytes32,
} from './plan.js';
import type { CouponHolderSettlement, CouponSettlementRecord } from './record.js';

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

const STEPS = [
  'status',
  'probe',
  'seed',
  'subscribe',
  'pay',
  'publish',
  'verify',
  'all',
] as const;
type Step = (typeof STEPS)[number];

const RUN: Step[] = ['probe', 'seed', 'subscribe', 'pay', 'publish', 'verify'];

/// What each noteholder subscribes for the demonstration: half the principal
/// each, which is what they hold on the note.
const SUBSCRIPTION_PER_INVESTOR = 50_000n * 1_000_000n;

function now(): number {
  return Math.floor(Date.now() / 1000);
}

function couponMeta(record: DeploymentRecord): NonNullable<
  NonNullable<NonNullable<DeploymentRecord['series']>['ats']>['coupon']
> {
  const coupon = record.series?.ats?.coupon;
  if (coupon === undefined) {
    throw new Error('no coupon declared on the note: run `pnpm ats:issue coupon` first');
  }
  return coupon;
}

/// The settlement record for the declared coupon, created on first use so every
/// step can write into the same entry.
function settlementOf(context: CouponContext): CouponSettlementRecord {
  const record = context.record;
  const series = record.series;
  if (series === undefined) throw new Error('no series in the deployment record');
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

async function tokenBalance(context: CouponContext, address: string): Promise<bigint> {
  return (await context.token.getFunction('balanceOf')(address)) as bigint;
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
  console.log(`  vault TUSD      ${await tokenBalance(context, (context.vault.target as string))}`);
  console.log(`  coupon ${coupon.id} at ${coupon.ratePercent} percent, execution ${coupon.executionTimestamp} (now ${now()})`);

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
 * Can a contract call be wrapped in a Scheduled Transaction on testnet today?
 *
 * It decides the shape of the settlement. If a `ContractExecuteTransaction` is
 * schedulable, `fundCoupon` itself could be scheduled for the coupon's
 * execution date and the vault would pay each holder directly. If it is not,
 * the vault has no key with which to sign anything, so the payment is a two
 * step move: `fundCoupon` to the treasury account, then a scheduled transfer
 * from the treasury to the holder.
 *
 * The answer is measured, not assumed, and it is recorded either way.
 */
async function probe(context: CouponContext): Promise<void> {
  const settlement = settlementOf(context);
  if (settlement.scheduledContractCall !== undefined) {
    console.log(`  already measured: ${settlement.scheduledContractCall.status}`);
    return;
  }
  const series = demoSeries(context.record);
  const vaultId = context.record.collateralVault?.contractId ?? (context.vault.target as string);
  // A zero amount call, so that even if the network accepts and executes it,
  // nothing moves: fundCoupon reverts ZeroAmount inside the scheduled call.
  const inner = new ContractExecuteTransaction()
    .setContractId(vaultId)
    .setGas(GAS.fundCoupon)
    .setFunction('fundCoupon');
  const transactionId = TransactionId.generate(context.api.accountId);
  const create = new ScheduleCreateTransaction()
    .setScheduledTransaction(inner)
    .setScheduleMemo(`creance probe schedule contract call ${series.label}`)
    .setExpirationTime(Timestamp.fromDate(new Date((now() + 300) * 1000)))
    .setWaitForExpiry(true)
    .setAdminKey(context.api.key.publicKey)
    .setTransactionId(transactionId);

  let statusText: string;
  let scheduleId: string | undefined;
  try {
    const frozen = await create.freezeWith(context.client).sign(context.api.key);
    const response = await frozen.execute(context.client);
    const receipt = await response.getReceipt(context.client);
    scheduleId = receipt.scheduleId?.toString();
    statusText = `accepted, ${receipt.status.toString()}`;
  } catch (error) {
    const status = (error as { status?: { toString(): string } }).status;
    statusText = status ? status.toString() : (error as Error).message;
  }
  console.log(`  ScheduleCreate around a ContractExecuteTransaction: ${statusText}`);
  settlement.scheduledContractCall = {
    attempted: true,
    status: statusText,
    ...(scheduleId === undefined ? {} : { scheduleId }),
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
    total += settlementAmount(numerator, denominator, context.decimals);
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

// ------------------------------------------------------------- subscribe

/**
 * Subscribe both noteholders in the vault, so the principal the note reports
 * and the principal the vault holds are the same number.
 *
 * `subscribe` pulls the settlement token from `msg.sender`, which is the api
 * account holding SUBSCRIPTION_ROLE, and credits it to the holder named in the
 * call. That is the shape DESIGN.md 3.8 describes: the API pays on the
 * investor's behalf after the ATS mint. So each investor sends its half of the
 * principal to the api account first.
 */
async function subscribe(context: CouponContext): Promise<void> {
  const series = demoSeries(context.record);
  const record = context.record.series;
  if (record === undefined) throw new Error('no series in the deployment record');
  record.subscriptions ??= [];

  for (const investor of context.investors) {
    const already = (await context.vault.getFunction('subscriptionOf')(
      series.id,
      investor.address,
    )) as bigint;
    if (already >= SUBSCRIPTION_PER_INVESTOR) {
      console.log(`  ${investor.role} already subscribed ${already}`);
      continue;
    }
    const amount = SUBSCRIPTION_PER_INVESTOR - already;
    const fund = await send(
      `${investor.role} sends its principal to the api account`,
      context.token
        .connect(investor.wallet)
        .getFunction('transfer')(context.api.address, amount, { gasLimit: GAS.transfer }),
    );
    const approve = await send(
      'approve the vault',
      context.token
        .connect(context.api.wallet)
        .getFunction('approve')(context.vault.target as string, amount, { gasLimit: GAS.approve }),
    );
    const subscribed = await send(
      `subscribe ${investor.role}`,
      context.vault.getFunction('subscribe')(series.id, investor.address, amount, {
        gasLimit: GAS.subscribe,
      }),
    );
    record.subscriptions = [
      ...record.subscriptions.filter((entry) => entry.role !== investor.role),
      {
        role: investor.role,
        accountId: investor.accountId,
        address: investor.address,
        amount: SUBSCRIPTION_PER_INVESTOR.toString(),
        fundTx: fund.hash,
        approveTx: approve.hash,
        subscribeTx: subscribed.hash,
        gasUsed: subscribed.gasUsed,
      },
    ];
    context.save();
  }
  const state = (await context.vault.getFunction('seriesOf')(series.id)) as {
    principalFunded: bigint;
  };
  console.log(`  principalFunded ${state.principalFunded}`);
}

// ------------------------------------------------------------------- pay

/**
 * Move each holder's entitlement out of the premium account and settle it with
 * a Scheduled Transaction.
 *
 * The vault is a contract and a contract has no key, so it cannot sign the
 * transfer inside a schedule. `fundCoupon` therefore moves the amount from the
 * premium account to the api account, which holds TREASURY_ROLE, and the
 * scheduled transfer from the api account to the holder is the payment. The
 * schedule carries `waitForExpiry` and a memo naming the series, the coupon and
 * the holder, so an execution maps back to a coupon with no date arithmetic.
 */
async function pay(context: CouponContext): Promise<void> {
  const settlement = settlementOf(context);
  const series = demoSeries(context.record);
  const coupon = couponMeta(context.record);
  const note = noteContract(demoNoteAddress(context.record), context.provider);
  const reference = toBytes32(settlement.couponRef);

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

    if (entry.fundCouponTx === undefined) {
      const funded = await send(
        `fundCoupon ${investor.role}`,
        context.vault.getFunction('fundCoupon')(series.id, reference, context.api.address, amount, {
          gasLimit: GAS.fundCoupon,
        }),
      );
      entry.fundCouponTx = funded.hash;
      entry.fundCouponGasUsed = funded.gasUsed;
    }

    if (entry.scheduleId === undefined) {
      const memo = couponMemo(series.label, coupon.id, investor.role);
      const scheduled: ScheduledTransfer = await scheduleTransfer({
        client: context.client,
        tokenId: context.tokenId,
        payer: { accountId: context.api.accountId, key: context.api.key },
        to: investor.accountId,
        amount,
        executeAt,
        memo,
        // Without an admin key the schedule is immutable and a coupon that has
        // to be stopped cannot be, so every schedule this build owns carries one.
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
      entry.links = {
        ...(entry.links ?? {}),
        schedule: scheduled.links.schedule,
        scheduleCreate: scheduled.links.create,
        fundCoupon: hashscan('transaction', entry.fundCouponTx),
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
    const execution = await waitForExecution(
      context.mirrorUrl,
      entry.scheduleId,
      { ...EXECUTION_POLL },
    );
    if (execution === null) {
      console.log(`  ${investor.role} schedule ${entry.scheduleId} has not executed`);
      continue;
    }
    // A schedule executes whether or not the transfer inside it succeeded, so
    // only SUCCESS may be recorded as paid.
    entry.executedAt = execution.executedAt;
    entry.executedTransactionId = execution.executedTransactionId;
    entry.result = execution.result;
    entry.settled = execution.settled;
    entry.links = {
      ...(entry.links ?? {}),
      settlement: execution.link,
    };
    console.log(
      `  ${investor.role} executed ${execution.executedTransactionId} result ${execution.result}`,
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
  const settlement = settlementOf(context);
  const series = demoSeries(context.record);

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
  const settlement = settlementOf(context);
  const series = demoSeries(context.record);
  const premium = (await context.vault.getFunction('premiumBalanceOf')(series.id)) as bigint;
  const state = (await context.vault.getFunction('seriesOf')(series.id)) as {
    principalFunded: bigint;
    principalPaid: bigint;
    premiumBalance: bigint;
  };
  console.log(`  premiumBalanceOf ${premium}`);
  console.log(`  principalFunded  ${state.principalFunded}`);
  for (const entry of settlement.holders) {
    const balance = await tokenBalance(context, entry.address);
    console.log(
      `  ${entry.role} paid ${entry.amount} in ${entry.executedTransactionId} (${entry.result}), TUSD balance ${balance}`,
    );
  }
}

// ------------------------------------------------------------------ main

const HANDLERS: Record<Exclude<Step, 'all'>, (context: CouponContext) => Promise<void>> = {
  status,
  probe,
  seed,
  subscribe,
  pay,
  publish,
  verify,
};

async function main(): Promise<void> {
  const requested = (process.argv[2] ?? 'all') as Step;
  if (!STEPS.includes(requested)) {
    throw new Error(`unknown step "${requested}". One of: ${STEPS.join(', ')}`);
  }
  const context = openCouponContext();
  const steps = requested === 'all' ? RUN : [requested];
  for (const name of steps) {
    console.log(name);
    try {
      await HANDLERS[name as Exclude<Step, 'all'>]!(context);
    } finally {
      context.save();
    }
  }
  context.client.close();
}

await main();
