/// Scheduled Transactions for the monthly premium.
///
/// A schedule transaction creates the entity; the scheduled transaction is the
/// thing inside it that eventually executes. Everything here schedules one
/// settlement token transfer per policy per month, so the two words stay apart:
/// `scheduleTransfer` creates one, `waitForExecution` reads the outcome, and
/// `scheduleNext` chains the following month once the current one has run.
///
/// A schedule cannot create another schedule, so the chain is a watcher and not
/// an on-chain loop. See docs/HEDERA.md, section "Scheduled transactions".
///
/// https://docs.hedera.com/hedera/sdks-and-apis/sdks/schedule-transaction/create-a-schedule-transaction
import {
  AccountId,
  Client,
  Hbar,
  Key,
  PrivateKey,
  ScheduleCreateTransaction,
  ScheduleSignTransaction,
  Timestamp,
  TokenId,
  TransactionId,
  TransferTransaction,
} from '@hiero-ledger/sdk';

/// The schedule memo is capped at 100 bytes, the same cap every Hedera memo
/// carries, and it is the only field that links an execution back to a policy.
export const MAX_SCHEDULE_MEMO_BYTES = 100;

/// Every memo this build writes starts here, so a mirror node sweep of the
/// payer's schedules can pick out the ones that belong to Creance.
export const PREMIUM_MEMO_PREFIX = 'creance premium';

const PREMIUM_MEMO_PATTERN = /^creance premium ([A-Za-z0-9:_-]{1,48}) (\d{6})$/;

// -- Period arithmetic, chain free ------------------------------------------

/**
 * A period is `YYYYMM` as a number, the form CoverPool takes on every function
 * that names a month. 2026-04 is 202604.
 */
export function assertPeriod(period: number): number {
  if (!Number.isInteger(period)) {
    throw new Error(`a period is an integer YYYYMM, got ${period}`);
  }
  const month = period % 100;
  const year = (period - month) / 100;
  if (year < 1970 || year > 9999 || month < 1 || month > 12) {
    throw new Error(`a period is YYYYMM with a month of 1 to 12, got ${period}`);
  }
  return period;
}

/** The period a moment falls in, read in UTC. */
export function periodOf(date: Date): number {
  return date.getUTCFullYear() * 100 + date.getUTCMonth() + 1;
}

/** The month index CoverPool counts in: `year * 12 + (month - 1)`. */
export function monthIndexOf(period: number): number {
  const month = assertPeriod(period) % 100;
  return ((period - month) / 100) * 12 + (month - 1);
}

/** The inverse of `monthIndexOf`. */
export function periodFromMonthIndex(index: number): number {
  const year = Math.floor(index / 12);
  return year * 100 + (index - year * 12) + 1;
}

/** Step a period by whole months. Crosses year boundaries in both directions. */
export function addMonths(period: number, months: number): number {
  return periodFromMonthIndex(monthIndexOf(period) + months);
}

/** The month after this one. 202612 becomes 202701. */
export function nextPeriod(period: number): number {
  return addMonths(period, 1);
}

/** The last day of a UTC month, so a day-of-month can be clamped into it. */
function daysInMonth(year: number, monthIndexZeroBased: number): number {
  return new Date(Date.UTC(year, monthIndexZeroBased + 1, 0)).getUTCDate();
}

/**
 * The same wall clock moment one or more months later, in UTC, with the day of
 * month clamped into the target month.
 *
 * `dueDay` is the day the policy is actually due on, which is not always the
 * day the previous premium ran. A policy due on the 31st runs on 28 February,
 * and the step after that has to be 31 March, not 28 March. Pass the unclamped
 * due day and the chain recovers; leave it out and the step is measured from
 * `executeAt`, which is right for a one-off call and wrong for a chain.
 */
export function nextExecuteAt(executeAt: Date, months = 1, dueDay?: number): Date {
  const year = executeAt.getUTCFullYear();
  const monthIndex = executeAt.getUTCMonth() + months;
  const targetYear = year + Math.floor(monthIndex / 12);
  const targetMonth = ((monthIndex % 12) + 12) % 12;
  const wanted = dueDay ?? executeAt.getUTCDate();
  const day = Math.min(wanted, daysInMonth(targetYear, targetMonth));
  return new Date(
    Date.UTC(
      targetYear,
      targetMonth,
      day,
      executeAt.getUTCHours(),
      executeAt.getUTCMinutes(),
      executeAt.getUTCSeconds(),
      executeAt.getUTCMilliseconds(),
    ),
  );
}

/**
 * The memo a premium schedule carries. It names the policy and the accounting
 * period, because the execution consensus timestamp is only close to the due
 * time and must never be used to derive the month.
 */
export function premiumMemo(policyId: string, period: number): string {
  assertPeriod(period);
  if (!/^[A-Za-z0-9:_-]{1,48}$/.test(policyId)) {
    throw new Error(`a policy id is 1 to 48 characters of [A-Za-z0-9:_-], got ${policyId}`);
  }
  const memo = `${PREMIUM_MEMO_PREFIX} ${policyId} ${period}`;
  if (Buffer.byteLength(memo, 'utf8') > MAX_SCHEDULE_MEMO_BYTES) {
    throw new Error(`the schedule memo is over ${MAX_SCHEDULE_MEMO_BYTES} bytes: ${memo}`);
  }
  return memo;
}

/** The policy and period a premium memo names, or null when it is not one. */
export function parsePremiumMemo(memo: string): { policyId: string; period: number } | null {
  const match = PREMIUM_MEMO_PATTERN.exec(memo.trim());
  if (!match) {
    return null;
  }
  const period = Number(match[2]);
  try {
    assertPeriod(period);
  } catch {
    return null;
  }
  return { policyId: match[1] as string, period };
}

/** One month of the premium chain: which policy, which month, when it is due. */
export interface PremiumSlot {
  policyId: string;
  period: number;
  executeAt: Date;
  memo: string;
  /**
   * The day of month the policy is due on, kept unclamped so that one short
   * month does not move every later premium. A policy bound on the 31st has
   * `dueDay` 31 even in the months where `executeAt` says 28.
   */
  dueDay: number;
}

/**
 * Build a slot, with the memo derived rather than passed in. `dueDay` defaults
 * to the day `executeAt` falls on, which is what the first slot of a chain
 * wants; pass it explicitly when a chain is resumed from a clamped date.
 */
export function premiumSlot(
  policyId: string,
  period: number,
  executeAt: Date,
  dueDay = executeAt.getUTCDate(),
): PremiumSlot {
  return { policyId, period, executeAt, memo: premiumMemo(policyId, period), dueDay };
}

/**
 * The slot after this one. This is the whole of `scheduleNext` that can be
 * decided without the network, so it is the part that carries a unit test.
 *
 * The step is measured against `dueDay` and not against the previous
 * `executeAt`, so a chain that passes through February comes back out on its
 * own day of month instead of staying on the 28th for the rest of the term.
 */
export function nextPremiumSlot(slot: PremiumSlot, months = 1): PremiumSlot {
  return premiumSlot(
    slot.policyId,
    addMonths(slot.period, months),
    nextExecuteAt(slot.executeAt, months, slot.dueDay),
    slot.dueDay,
  );
}

// -- Links -------------------------------------------------------------------

export type HashscanKind = 'account' | 'token' | 'topic' | 'transaction' | 'contract' | 'schedule';

/** Explorer link. The schedule route is `/{network}/schedule/{scheduleId}`. */
export function hashscanUrl(kind: HashscanKind, id: string, network = 'testnet'): string {
  return `https://hashscan.io/${network}/${kind}/${id}`;
}

/**
 * The SDK prints a transaction id as `0.0.x@seconds.nanos`, and a scheduled one
 * carries a `?scheduled` suffix. The mirror node and HashScan both want
 * `0.0.x-seconds-nanos` and tell the two apart by a flag, not by the id.
 */
export function toMirrorTransactionId(sdkTransactionId: string): string {
  const withoutSuffix = sdkTransactionId.trim().replace(/\?scheduled$/, '');
  const match = /^(\d+\.\d+\.\d+)@(\d+)\.(\d+)$/.exec(withoutSuffix);
  if (!match) {
    throw new Error(`expected a shard.realm.number@seconds.nanos id, got ${sdkTransactionId}`);
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
}

/** The mirror node record of the schedule entity, which is where execution shows up. */
export function mirrorScheduleUrl(mirrorUrl: string, scheduleId: string): string {
  return `${mirrorUrl.replace(/\/+$/, '')}/schedules/${scheduleId}`;
}

// -- Creating a schedule -----------------------------------------------------

/**
 * The account that pays. It pays twice: the fee for creating the schedule, and
 * the fee for executing the scheduled transfer. It is also the account the
 * settlement token leaves, so its key is the only signature the inner transfer
 * needs and the schedule is complete the moment it is created.
 *
 * The key is optional because DESIGN.md 3.7 allows the other shape too: the API
 * creates the schedule and hands it back for the Steward to sign. Leave the key
 * out, set `preSign` false, and finish it later with `signSchedule`.
 */
export interface SchedulePayer {
  accountId: string | AccountId;
  key?: PrivateKey;
}

export interface ScheduleTransferParams {
  client: Client;
  /** Settlement token id. Amounts are integers in its minor units. */
  tokenId: string | TokenId;
  payer: SchedulePayer;
  to: string | AccountId;
  /** Minor units. 1.00 TUSD at six decimals is 1000000n. */
  amount: bigint;
  /** When the transfer is due. Also the schedule's expiry. */
  executeAt: Date;
  /** Use `premiumMemo` unless you are probing the network. */
  memo: string;
  /**
   * Without an admin key the schedule is immutable and a lapsed policy cannot
   * stop its remaining premiums, so pass one for anything a policy owns.
   */
  adminKey?: Key;
  /**
   * True holds the transfer until the expiry, which is what makes this a
   * schedule. False executes as soon as the signatures are complete, which for
   * a pre-signed transfer means immediately.
   */
  waitForExpiry?: boolean;
  /**
   * True signs the create with the payer key and charges the create to the
   * payer, which completes the schedule in one round trip. False leaves the
   * schedule pending on the payer's signature and charges the create to the
   * client operator.
   */
  preSign?: boolean;
  /** Read the transaction record so the create fee comes back. Costs a query. */
  readFee?: boolean;
  network?: string;
  maxTransactionFee?: Hbar;
}

export interface ScheduledTransfer {
  scheduleId: string;
  /** The id the executed transfer will carry, ending in `?scheduled`. */
  scheduledTransactionId: string;
  /** The id of the create itself. */
  createTransactionId: string;
  memo: string;
  expirationTime: Date;
  waitForExpiry: boolean;
  /** False when the schedule is still waiting for `signSchedule`. */
  preSigned: boolean;
  /** The ScheduleCreate fee in HBAR, only when `readFee` was set. */
  createFeeHbar: string | null;
  links: {
    schedule: string;
    create: string;
    scheduled: string;
  };
}

/**
 * Schedule one settlement token transfer of `amount` minor units from `payer`
 * to `to`, due at `executeAt`, signed by the payer key at creation.
 *
 * The create is paid by the payer as well as the execution: the transaction id
 * is generated against the payer account and the frozen transaction is signed
 * with the payer key, which is the same signature the inner transfer needs.
 *
 * Creating a schedule proves nothing about whether it will pay. A payer without
 * the balance at execution time still gets a successful create, so missed
 * premiums are detected by reading the execution, not the create receipt.
 */
export async function scheduleTransfer(params: ScheduleTransferParams): Promise<ScheduledTransfer> {
  const {
    client,
    tokenId,
    payer,
    to,
    amount,
    executeAt,
    memo,
    adminKey,
    waitForExpiry = true,
    preSign = true,
    readFee = false,
    network = 'testnet',
    maxTransactionFee,
  } = params;

  if (amount <= 0n) {
    throw new Error(`a scheduled transfer moves a positive amount, got ${amount}`);
  }
  if (Buffer.byteLength(memo, 'utf8') > MAX_SCHEDULE_MEMO_BYTES) {
    throw new Error(`the schedule memo is over ${MAX_SCHEDULE_MEMO_BYTES} bytes: ${memo}`);
  }

  if (preSign && !payer.key) {
    throw new Error('a pre-signed schedule needs the payer key; set preSign false to sign later');
  }

  const payerId =
    typeof payer.accountId === 'string' ? AccountId.fromString(payer.accountId) : payer.accountId;

  // The inner transaction is not frozen; the schedule create carries it.
  const transfer = new TransferTransaction()
    .addTokenTransfer(tokenId, payerId, -amount)
    .addTokenTransfer(tokenId, to, amount);

  let create = new ScheduleCreateTransaction()
    .setScheduledTransaction(transfer)
    .setScheduleMemo(memo)
    .setExpirationTime(Timestamp.fromDate(executeAt))
    .setWaitForExpiry(waitForExpiry)
    .setPayerAccountId(payerId);

  if (preSign) {
    create = create.setTransactionId(TransactionId.generate(payerId));
  }
  if (adminKey) {
    create = create.setAdminKey(adminKey);
  }
  if (maxTransactionFee) {
    create = create.setMaxTransactionFee(maxTransactionFee);
  }

  const frozen = create.freezeWith(client);
  const response = await (preSign ? frozen.sign(payer.key as PrivateKey) : Promise.resolve(frozen))
    .then((transaction) => transaction.execute(client));

  let createFeeHbar: string | null = null;
  let receipt;
  if (readFee) {
    const record = await response.getRecord(client);
    receipt = record.receipt;
    createFeeHbar = record.transactionFee.toString();
  } else {
    receipt = await response.getReceipt(client);
  }

  const scheduleId = receipt.scheduleId;
  const scheduledTransactionId = receipt.scheduledTransactionId;
  if (!scheduleId || !scheduledTransactionId) {
    throw new Error('the schedule create receipt carried no schedule id');
  }

  const createTransactionId = response.transactionId.toString();
  return {
    scheduleId: scheduleId.toString(),
    scheduledTransactionId: scheduledTransactionId.toString(),
    createTransactionId,
    memo,
    expirationTime: executeAt,
    waitForExpiry,
    preSigned: preSign,
    createFeeHbar,
    links: {
      schedule: hashscanUrl('schedule', scheduleId.toString(), network),
      create: hashscanUrl('transaction', toMirrorTransactionId(createTransactionId), network),
      scheduled: hashscanUrl(
        'transaction',
        toMirrorTransactionId(scheduledTransactionId.toString()),
        network,
      ),
    },
  };
}

export interface SignScheduleParams {
  client: Client;
  scheduleId: string;
  key: PrivateKey;
  network?: string;
}

export interface ScheduleSignature {
  scheduleId: string;
  transactionId: string;
  status: string;
  link: string;
}

/**
 * Add a signature to a schedule that already exists. This is the second shape
 * DESIGN.md 3.7 allows: the API creates the premium schedules and the Steward
 * signs them, so the payer key never leaves the Steward.
 *
 * A schedule whose signatures are still incomplete at its expiry simply does
 * not execute, which is the same outcome as a payer that cannot pay.
 */
export async function signSchedule(params: SignScheduleParams): Promise<ScheduleSignature> {
  const { client, scheduleId, key, network = 'testnet' } = params;
  const signed = await new ScheduleSignTransaction()
    .setScheduleId(scheduleId)
    .freezeWith(client)
    .sign(key);
  const response = await signed.execute(client);
  const receipt = await response.getReceipt(client);
  const transactionId = response.transactionId.toString();
  return {
    scheduleId,
    transactionId,
    status: receipt.status.toString(),
    link: hashscanUrl('transaction', toMirrorTransactionId(transactionId), network),
  };
}

// -- Reading the outcome -----------------------------------------------------

/** The mirror node's view of a schedule. Fields this build reads, not all of them. */
export interface MirrorSchedule {
  schedule_id: string;
  consensus_timestamp: string;
  creator_account_id: string;
  payer_account_id: string;
  memo: string;
  deleted: boolean;
  executed_timestamp: string | null;
  expiration_time: string | null;
  wait_for_expiry: boolean;
  signatures: unknown[];
}

async function mirrorGet<T>(url: string): Promise<T | null> {
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (response.status === 404) {
    await response.text();
    return null;
  }
  if (!response.ok) {
    throw new Error(`mirror node ${response.status} for ${url}: ${await response.text()}`);
  }
  return (await response.json()) as T;
}

/** The schedule entity, or null while the mirror node has not caught up. */
export async function readSchedule(
  mirrorUrl: string,
  scheduleId: string,
): Promise<MirrorSchedule | null> {
  return mirrorGet<MirrorSchedule>(mirrorScheduleUrl(mirrorUrl, scheduleId));
}

/** What one execution of a premium schedule tells the caller. */
export interface ScheduleExecution {
  scheduleId: string;
  /** Consensus timestamp of the executed transfer, `seconds.nanos`. */
  executedAt: string;
  /** Mirror form of the executed transfer's id, `0.0.x-seconds-nanos`. */
  executedTransactionId: string;
  /** SUCCESS, or the failure the transfer hit. A failed transfer still executes. */
  result: string;
  link: string;
}

interface MirrorTransaction {
  transaction_id: string;
  result: string;
  scheduled: boolean;
  consensus_timestamp: string;
}

/**
 * The transfer that ran at a schedule's execution timestamp. The schedule
 * record carries the timestamp but not the transaction id, so this is a second
 * read keyed on the timestamp, filtered to the scheduled child.
 */
export async function readExecutedTransfer(
  mirrorUrl: string,
  executedTimestamp: string,
): Promise<MirrorTransaction | null> {
  const base = mirrorUrl.replace(/\/+$/, '');
  const body = await mirrorGet<{ transactions: MirrorTransaction[] }>(
    `${base}/transactions?timestamp=${executedTimestamp}`,
  );
  return body?.transactions?.find((tx) => tx.scheduled) ?? null;
}

export interface PollOptions {
  attempts?: number;
  delayMs?: number;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Poll the mirror node until the schedule has executed. Returns null when the
 * budget runs out, which is the missed-premium signal: a schedule whose payer
 * cannot pay expires without executing and the lapse path takes over.
 *
 * Execution is best effort "at the earliest available consensus time after the
 * expiration time", so the executed timestamp is close to but later than the
 * due time. Never assert equality on it, and never derive the accounting month
 * from it; the memo carries the month.
 */
export async function waitForExecution(
  mirrorUrl: string,
  scheduleId: string,
  { attempts = 40, delayMs = 3000 }: PollOptions = {},
  network = 'testnet',
): Promise<ScheduleExecution | null> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const schedule = await readSchedule(mirrorUrl, scheduleId);
    if (schedule?.executed_timestamp) {
      const executed = await readExecutedTransfer(mirrorUrl, schedule.executed_timestamp);
      const transactionId = executed?.transaction_id ?? '';
      return {
        scheduleId,
        executedAt: schedule.executed_timestamp,
        executedTransactionId: transactionId,
        result: executed?.result ?? 'UNKNOWN',
        link: transactionId ? hashscanUrl('transaction', transactionId, network) : '',
      };
    }
    if (schedule?.deleted) {
      return null;
    }
    await sleep(delayMs);
  }
  return null;
}

// -- Chaining the next month -------------------------------------------------

/**
 * What a watcher hands back when a premium executes. T09 turns this into the
 * `CoverPool.recordPremium(policyId, period)` call from the api account, and
 * T18 writes it to the payments topic. Without that call `lapse()` becomes
 * callable once the grace period past `paidThroughMonth` has run out, so an
 * execution nobody records looks exactly like a missed premium.
 */
export interface PremiumExecution extends ScheduleExecution {
  policyId: string;
  period: number;
}

export interface ScheduleNextParams extends Omit<ScheduleTransferParams, 'memo' | 'executeAt'> {
  mirrorUrl: string;
  /** The schedule being watched, and the slot it stands for. */
  scheduleId: string;
  slot: PremiumSlot;
  /** How far the next slot steps. One month unless the demo clock says otherwise. */
  months?: number;
  poll?: PollOptions;
  onExecuted?: (execution: PremiumExecution) => void | Promise<void>;
}

export interface ScheduleNextResult {
  execution: PremiumExecution;
  next: ScheduledTransfer;
  slot: PremiumSlot;
}

/**
 * Wait for one premium to execute and create the following month's.
 *
 * A Hedera schedule cannot create another schedule, so the monthly chain is
 * this watcher and nothing else: poll for the execution, hand it to the
 * callback, then create the next month. The Steward runs it; if the process
 * stops, the chain stops, which is why the schedules are created a few months
 * ahead rather than one at a time.
 */
export async function scheduleNext(
  params: ScheduleNextParams,
): Promise<ScheduleNextResult | null> {
  const { mirrorUrl, scheduleId, slot, months = 1, poll, onExecuted, ...transfer } = params;

  const execution = await waitForExecution(mirrorUrl, scheduleId, poll, transfer.network);
  if (!execution) {
    return null;
  }

  const premium: PremiumExecution = {
    ...execution,
    policyId: slot.policyId,
    period: slot.period,
  };
  if (onExecuted) {
    await onExecuted(premium);
  }

  const nextSlot = nextPremiumSlot(slot, months);
  const next = await scheduleTransfer({
    ...transfer,
    memo: nextSlot.memo,
    executeAt: nextSlot.executeAt,
  });
  return { execution: premium, next, slot: nextSlot };
}
