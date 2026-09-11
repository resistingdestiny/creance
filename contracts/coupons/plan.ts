/// The chain free half of a coupon settlement: the arithmetic that turns an ATS
/// entitlement into a settlement token amount, the memo that carries the
/// accounting record on the Scheduled Transaction, and the payments topic
/// message T18 reads back.
///
/// Everything here is pure, so `pnpm test` covers all of it and never touches
/// testnet.

/// Every coupon schedule memo starts here, the same way every premium memo
/// starts with "creance premium", so a mirror node sweep of the payer's
/// schedules can tell the two apart.
export const COUPON_MEMO_PREFIX = 'creance coupon';

/// The Hedera memo cap, in bytes rather than characters.
export const MAX_SCHEDULE_MEMO_BYTES = 100;

/// The consensus message cap this build holds itself to, the same one the index
/// observations use.
export const MAX_TOPIC_MESSAGE_BYTES = 1024;

const LABEL = /^[A-Za-z0-9:_-]{1,32}$/;
const ROLE = /^[A-Za-z0-9:_-]{1,32}$/;
const COUPON_ID = /^[0-9]{1,20}$/;

const MEMO_PATTERN = /^creance coupon ([A-Za-z0-9:_-]{1,32}) ([0-9]{1,20}) ([A-Za-z0-9:_-]{1,32})$/;

/**
 * The settlement amount for one holder, in the settlement token's minor units.
 *
 * ATS returns the entitlement as an exact fraction in **whole currency units**,
 * not in token units: the on chain formula divides out both the token decimals
 * and the nominal value decimals. So the caller multiplies by the settlement
 * token's own scale, and getting that wrong is a factor of a million. See
 * docs/harness-notes.md.
 *
 * The division truncates. Rounding up would pay out more than the note owes
 * across a full holder list, so the remainder stays in the premium account.
 */
export function settlementAmount(
  numerator: bigint,
  denominator: bigint,
  decimals: number,
): bigint {
  if (denominator <= 0n) {
    throw new Error(`a coupon entitlement needs a positive denominator, got ${denominator}`);
  }
  if (numerator < 0n) {
    throw new Error(`a coupon entitlement cannot be negative, got ${numerator}`);
  }
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    throw new Error(`the settlement token decimals must be 0 to 18, got ${decimals}`);
  }
  return (numerator * 10n ** BigInt(decimals)) / denominator;
}

/** What the truncation left behind, as a fraction of one minor unit. */
export function settlementRemainder(
  numerator: bigint,
  denominator: bigint,
  decimals: number,
): bigint {
  settlementAmount(numerator, denominator, decimals);
  return (numerator * 10n ** BigInt(decimals)) % denominator;
}

/**
 * The identifier the vault records against a coupon payment. `fundCoupon` takes
 * a bytes32 and only ever emits it, so it carries the human reference rather
 * than a hash: series label, then the ATS coupon id.
 */
export function couponRef(seriesLabel: string, couponId: string | bigint): string {
  const id = couponId.toString();
  if (!LABEL.test(seriesLabel)) {
    throw new Error(`a series label is 1 to 32 characters of [A-Za-z0-9:_-], got ${seriesLabel}`);
  }
  if (!COUPON_ID.test(id)) {
    throw new Error(`a coupon id is a decimal integer, got ${id}`);
  }
  return `${seriesLabel}#${id}`;
}

/** The ASCII label right padded into 32 bytes, the form every id takes on chain. */
export function toBytes32(label: string): string {
  const bytes = Buffer.from(label, 'ascii');
  if (bytes.length > 32) {
    throw new Error(`label too long for bytes32: ${label}`);
  }
  return `0x${Buffer.concat([bytes, Buffer.alloc(32 - bytes.length)]).toString('hex')}`;
}

/** The ASCII label a bytes32 identifier carries, trailing zero bytes removed. */
export function fromBytes32(value: string): string {
  const hex = value.startsWith('0x') ? value.slice(2) : value;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(`expected a 32 byte hex value, got ${value}`);
  }
  return Buffer.from(hex, 'hex').toString('ascii').replace(/\0+$/, '');
}

/**
 * The memo a coupon schedule carries. It names the series, the ATS coupon and
 * the holder, because the execution consensus timestamp says nothing about
 * which coupon was paid and the transaction id belongs to the schedule's
 * creator rather than to either party.
 */
export function couponMemo(
  seriesLabel: string,
  couponId: string | bigint,
  holderRole: string,
): string {
  const id = couponId.toString();
  couponRef(seriesLabel, id);
  if (!ROLE.test(holderRole)) {
    throw new Error(`a holder role is 1 to 32 characters of [A-Za-z0-9:_-], got ${holderRole}`);
  }
  const memo = `${COUPON_MEMO_PREFIX} ${seriesLabel} ${id} ${holderRole}`;
  if (Buffer.byteLength(memo, 'utf8') > MAX_SCHEDULE_MEMO_BYTES) {
    throw new Error(`the schedule memo is over ${MAX_SCHEDULE_MEMO_BYTES} bytes: ${memo}`);
  }
  return memo;
}

/** What a coupon memo names, or null when the memo is not one. */
export function parseCouponMemo(
  memo: string,
): { seriesLabel: string; couponId: string; holderRole: string } | null {
  const match = MEMO_PATTERN.exec(memo.trim());
  if (!match) {
    return null;
  }
  return {
    seriesLabel: match[1] as string,
    couponId: match[2] as string,
    holderRole: match[3] as string,
  };
}

/**
 * One coupon settlement as it goes to the payments topic. T18 reads these back
 * as the audit trail, so the shape is fixed here and versioned.
 *
 * Amounts are integer strings in the settlement token's minor units, never
 * floats, and the fraction the amount came from travels with it so a reader can
 * redo the arithmetic against the note.
 */
export interface CouponSettlementMessage {
  v: 1;
  kind: 'coupon';
  series: string;
  seriesId: string;
  couponId: string;
  holder: string;
  holderAddress: string;
  numerator: string;
  denominator: string;
  amount: string;
  token: string;
  scheduleId: string;
  transactionId: string;
  result: string;
  paidAt: string;
}

export interface CouponSettlementInput {
  seriesLabel: string;
  seriesId: string;
  couponId: string | bigint;
  holderAccountId: string;
  holderAddress: string;
  numerator: bigint;
  denominator: bigint;
  amount: bigint;
  tokenId: string;
  scheduleId: string;
  transactionId: string;
  result: string;
  paidAt: string;
}

/** Build the message. Nothing derived at read time, so T18 never recomputes. */
export function couponSettlementMessage(input: CouponSettlementInput): CouponSettlementMessage {
  return {
    v: 1,
    kind: 'coupon',
    series: input.seriesLabel,
    seriesId: input.seriesId,
    couponId: input.couponId.toString(),
    holder: input.holderAccountId,
    holderAddress: input.holderAddress,
    numerator: input.numerator.toString(),
    denominator: input.denominator.toString(),
    amount: input.amount.toString(),
    token: input.tokenId,
    scheduleId: input.scheduleId,
    transactionId: input.transactionId,
    result: input.result,
    paidAt: input.paidAt,
  };
}

/** The bytes that go on the topic, with the size cap enforced here. */
export function encodeCouponSettlement(message: CouponSettlementMessage): string {
  const json = JSON.stringify(message);
  const size = Buffer.byteLength(json, 'utf8');
  if (size > MAX_TOPIC_MESSAGE_BYTES) {
    throw new Error(`the coupon settlement message is ${size} bytes, over ${MAX_TOPIC_MESSAGE_BYTES}`);
  }
  return json;
}

/// The dates of one coupon period, in the shape ATS `setCoupon` takes them.
export interface CouponPeriodPlan {
  recordDate: number;
  executionDate: number;
  startDate: number;
  endDate: number;
  fixingDate: number;
  /// True when the record date was brought forward so the period could be
  /// settled before its accrual window closed. It is on the record because a
  /// compressed cadence has to be said out loud wherever it is relied on. See
  /// docs/DECISIONS.md, T06.
  broughtForward: boolean;
}

/// The same calendar month the first coupon accrued over. ATS prices a coupon
/// as balance times nominal times rate times the window in seconds over 365
/// days, so a thirty day approximation would under pay a long month.
export function monthAfter(seconds: number): number {
  const end = new Date(seconds * 1000);
  end.setUTCMonth(end.getUTCMonth() + 1);
  return Math.floor(end.getTime() / 1000);
}

/// How far ahead a brought forward record date sits, and its execution date
/// after it. The first coupon used these two leads and settled, so a second
/// and a third period keep them rather than picking new ones.
export const RECORD_LEAD_SECONDS = 5 * 60;
export const EXECUTION_LEAD_SECONDS = 10 * 60;

/// A period declared on its own dates is paid the day after its record date,
/// which is the ordinary shape for a bond coupon.
export const EXECUTION_AFTER_RECORD_SECONDS = 24 * 60 * 60;

export interface CouponPeriodInput {
  /// Where the last declared period ended. The next one starts there, so the
  /// series accrues month after month with no gap and no overlap.
  previousEnd: number;
  now: number;
  /// The note's maturity. ATS refuses an accrual window that ends after it.
  maturityDate: number;
  /// `brought forward` puts the record date minutes out so the period can be
  /// settled today; `at the window end` puts it where a live series would,
  /// which makes the period the next payment the note owes rather than one
  /// more to settle now.
  recordDate: 'brought forward' | 'at the window end';
}

/**
 * The next monthly coupon period on a series that already has one.
 *
 * Only the record and execution dates move. The accrual window is always the
 * calendar month after the last one, because the window is what ATS prices the
 * coupon over and shortening it would pay less than a month of interest while
 * calling itself a month.
 */
export function nextCouponPeriod(input: CouponPeriodInput): CouponPeriodPlan {
  const { previousEnd, now, maturityDate } = input;
  if (!Number.isInteger(previousEnd) || previousEnd <= 0) {
    throw new Error(`the previous period must end at a unix timestamp, got ${previousEnd}`);
  }
  if (!Number.isInteger(now) || now <= 0) {
    throw new Error(`now must be a unix timestamp, got ${now}`);
  }
  const startDate = previousEnd;
  const endDate = monthAfter(startDate);
  if (maturityDate > 0 && endDate > maturityDate) {
    throw new Error(
      `a period ending ${endDate} runs past the note's maturity ${maturityDate}: the series has paid its last coupon`,
    );
  }
  const broughtForward = input.recordDate === 'brought forward';
  const recordDate = broughtForward ? now + RECORD_LEAD_SECONDS : endDate;
  const executionDate = broughtForward
    ? now + EXECUTION_LEAD_SECONDS
    : endDate + EXECUTION_AFTER_RECORD_SECONDS;
  return { recordDate, executionDate, startDate, endDate, fixingDate: recordDate, broughtForward };
}

/// What deciding whether a coupon is due needs: the note's own execution date,
/// the clock, and the note's answer about its record date.
export interface CouponDueInput {
  couponId: string | bigint;
  /// When the note says the coupon becomes payable.
  executionTimestamp: number;
  now: number;
  /// What `getCouponFor` answered. Before the record date the note returns a
  /// zero fraction, so the entitlement cannot be read and a settlement cannot
  /// be built. See docs/harness-notes.md.
  recordDateReached: boolean;
}

/// `due` means the settlement can go ahead. Otherwise `reason` is one plain
/// clause an operator reads in a log line, with the date spelled out because a
/// unix timestamp on its own says nothing about how far away it is.
export type CouponDueVerdict = { due: true } | { due: false; reason: string };

/** The day a unix timestamp falls on, in UTC, the way a log line names it. */
export function dayOf(seconds: number): string {
  return new Date(seconds * 1000).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * Whether a declared coupon can be settled now.
 *
 * Decided once, before any step reads an entitlement, because the note answers
 * a coupon whose record date has not passed with a zero fraction and
 * `settlementAmount` rightly refuses a zero denominator. The caller is what
 * should not be asking, so the caller decides here first. A coupon is due when
 * its execution date has passed and the note confirms the record date was
 * reached; either on its own is not enough, since the record date is what
 * fixes the holders and the execution date is what fixes the payment.
 */
export function couponDue(input: CouponDueInput): CouponDueVerdict {
  const { executionTimestamp, now, recordDateReached } = input;
  if (!Number.isInteger(executionTimestamp) || executionTimestamp <= 0) {
    throw new Error(`a coupon execution date is a unix timestamp, got ${executionTimestamp}`);
  }
  if (!Number.isInteger(now) || now <= 0) {
    throw new Error(`now must be a unix timestamp, got ${now}`);
  }
  if (now < executionTimestamp) {
    return {
      due: false,
      reason: `payable at ${executionTimestamp}, ${dayOf(executionTimestamp)}`,
    };
  }
  if (!recordDateReached) {
    return {
      due: false,
      reason: `the note has not reached its record date, although it is payable at ${executionTimestamp}, ${dayOf(executionTimestamp)}`,
    };
  }
  return { due: true };
}
