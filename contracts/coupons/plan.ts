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
