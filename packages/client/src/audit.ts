/// The audit trail, read side: one parser for every message this build writes
/// to the payments topic and the claims topic.
///
/// DESIGN.md 3.7 asks for an audit trail that is "on-chain and verifiable
/// independently of our database". That only holds if the messages can be read
/// back by something that is not the writer, so the reader lives here, in the
/// shared client, and both apps/api and apps/web use it rather than each
/// growing its own idea of what a coupon message looks like.
///
/// Five kinds are on the payments topic and two on the claims topic. Three of
/// the five already have writers: `coupon` (contracts/coupons), `policy`
/// (apps/api/src/receipts.ts, two messages per policy) and `settlement`
/// (apps/api/src/x402). The type definitions there stay where they are; these
/// mirror them, and a test round-trips each writer's own output through this
/// parser so the mirror cannot drift silently.
///
/// Two rules make the parser tolerant rather than strict, and both are about
/// what a reader must do when the writer is newer than it is.
///
/// An unknown `kind` is not an error. A topic is append-only and shared: a
/// later ticket adds a kind and every deployed reader must still render the
/// history around it. Unknown kinds come back as `unknown` with their fields
/// intact.
///
/// A `v` above the one we know is not an error either. Version 1 fields are
/// read where they are present and the rest is carried in `fields`, because
/// versions here are additive by convention (docs/DECISIONS.md, "The coupon
/// settlement message on the payments topic, version 1").
///
/// Mirror node REST reference:
/// https://docs.hedera.com/hedera/sdks-and-apis/rest-api

export const AUDIT_MESSAGE_VERSION = 1;

/** Written by contracts/coupons/settle.ts when a coupon transfer executes. */
export interface CouponMessage {
  v: number;
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

/** The first of the two messages a policy writes: the receipt the bind quotes. */
export interface PolicyBindingMessage {
  v: number;
  kind: 'policy';
  status: 'binding';
  series: string;
  seriesId: string;
  policy: string;
  group: string;
  holder: string;
  holderAddress: string;
  limit: string;
  premium: string;
  token: string;
  startAt: string;
  quotedAt: string;
}

/** The second: what the chain did with it. `receiptSeq` points at the first. */
export interface PolicyOutcomeMessage {
  v: number;
  kind: 'policy';
  status: 'bound' | 'failed';
  series: string;
  policy: string;
  receiptSeq: number;
  bindTx?: string;
  nft?: string;
  serial?: number;
  reason?: string;
  at: string;
}

export type PolicyMessage = PolicyBindingMessage | PolicyOutcomeMessage;

/** Written by apps/api/src/x402 after the facilitator reports a settled transfer. */
export interface SettlementMessage {
  v: number;
  kind: 'settlement';
  endpoint: string;
  x402: number;
  scheme: string;
  network: string;
  payer: string;
  payTo: string;
  amount: string;
  asset: string;
  decimals: number;
  tx: string;
  facilitator: string;
  ref?: string;
  at: string;
}

/** A recurring monthly premium, executed by a Scheduled Transaction. */
export interface PremiumMessage {
  v: number;
  kind: 'premium';
  policy: string;
  /** The month the premium covers, YYYYMM. */
  period: number;
  scheduleId: string;
  tx: string;
  amount: string;
  asset: string;
  decimals: number;
  payer: string;
  at: string;
}

/** A claim payout, made by CoverPool.payClaim against both hashes. */
export interface PayoutMessage {
  v: number;
  kind: 'payout';
  policy: string;
  claimId: string;
  packetHash: string;
  decisionHash: string;
  amount: string;
  asset: string;
  decimals: number;
  tx: string;
  at: string;
}

/** Claims topic. DESIGN.md 3.9: only the hashes, never the evidence. */
export interface ClaimPacketMessage {
  v: number;
  kind: 'claim_packet';
  policy: string;
  claimId: string;
  packetHash: string;
  /** One `sha256:<hex>` per evidence file. No names, no contents, no sizes. */
  evidence: string[];
  at: string;
}

export interface ClaimDecisionMessage {
  v: number;
  kind: 'claim_decision';
  policy: string;
  claimId: string;
  decisionHash: string;
  decision: 'approve' | 'refer' | 'decline';
  at: string;
}

/** A kind this reader does not know, or a known kind missing its own fields. */
export interface UnknownTopicMessage {
  v: number | null;
  kind: 'unknown';
  /** What the message called itself, when it called itself anything. */
  declaredKind: string | null;
  fields: Record<string, unknown>;
}

export type PaymentsTopicMessage =
  | CouponMessage
  | PolicyMessage
  | SettlementMessage
  | PremiumMessage
  | PayoutMessage;

export type ClaimsTopicMessage = ClaimPacketMessage | ClaimDecisionMessage;

export type TopicAuditMessage = PaymentsTopicMessage | ClaimsTopicMessage | UnknownTopicMessage;

/**
 * Parse one topic message.
 *
 * Anything that is not a JSON object comes back as `unknown` with no fields,
 * because a topic can carry bytes this build never wrote and a reader that
 * throws on them cannot show the history around them.
 */
export function parseTopicMessage(text: string): TopicAuditMessage {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return { v: null, kind: 'unknown', declaredKind: null, fields: {} };
  }
  return readTopicMessage(body);
}

/** The same, when the caller already has the decoded object. */
export function readTopicMessage(body: unknown): TopicAuditMessage {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { v: null, kind: 'unknown', declaredKind: null, fields: {} };
  }
  const fields = body as Record<string, unknown>;
  const version = typeof fields['v'] === 'number' ? fields['v'] : null;
  const kind = typeof fields['kind'] === 'string' ? fields['kind'] : null;
  const unknown: UnknownTopicMessage = {
    v: version,
    kind: 'unknown',
    declaredKind: kind,
    fields,
  };
  if (version === null || kind === null) return unknown;

  switch (kind) {
    case 'coupon':
      return hasStrings(fields, ['couponId', 'amount', 'token', 'transactionId', 'paidAt'])
        ? (fields as unknown as CouponMessage)
        : unknown;
    case 'policy':
      return readPolicy(fields) ?? unknown;
    case 'settlement':
      return hasStrings(fields, ['endpoint', 'payer', 'amount', 'asset', 'tx', 'at']) &&
        typeof fields['decimals'] === 'number'
        ? (fields as unknown as SettlementMessage)
        : unknown;
    case 'premium':
      return hasStrings(fields, ['policy', 'scheduleId', 'tx', 'amount', 'asset', 'at']) &&
        typeof fields['period'] === 'number' &&
        typeof fields['decimals'] === 'number'
        ? (fields as unknown as PremiumMessage)
        : unknown;
    case 'payout':
      return hasStrings(fields, [
        'policy',
        'claimId',
        'packetHash',
        'decisionHash',
        'amount',
        'asset',
        'tx',
        'at',
      ]) && typeof fields['decimals'] === 'number'
        ? (fields as unknown as PayoutMessage)
        : unknown;
    case 'claim_packet':
      return hasStrings(fields, ['policy', 'claimId', 'packetHash', 'at']) &&
        Array.isArray(fields['evidence'])
        ? (fields as unknown as ClaimPacketMessage)
        : unknown;
    case 'claim_decision':
      return hasStrings(fields, ['policy', 'claimId', 'decisionHash', 'decision', 'at'])
        ? (fields as unknown as ClaimDecisionMessage)
        : unknown;
    default:
      return unknown;
  }
}

function readPolicy(fields: Record<string, unknown>): PolicyMessage | null {
  const status = fields['status'];
  if (status === 'binding') {
    return hasStrings(fields, ['policy', 'series', 'limit', 'premium', 'startAt'])
      ? (fields as unknown as PolicyBindingMessage)
      : null;
  }
  if (status === 'bound' || status === 'failed') {
    return hasStrings(fields, ['policy', 'series', 'at']) &&
      typeof fields['receiptSeq'] === 'number'
      ? (fields as unknown as PolicyOutcomeMessage)
      : null;
  }
  return null;
}

function hasStrings(fields: Record<string, unknown>, names: string[]): boolean {
  return names.every((name) => typeof fields[name] === 'string');
}

/** The amount on a message, with its scale when the message carries one. */
export interface AuditAmount {
  amount: string;
  asset: string | null;
  /** Null when the message names a token but not its scale, as `coupon` does. */
  decimals: number | null;
}

/**
 * The handful of facts every kind has in common, pulled out once so that a
 * caller rendering a list does not switch on the kind five times.
 *
 * `at` is null on a `policy` binding message, which carries the moment cover
 * starts and the moment the price was struck but not the moment it was
 * written. A reader that needs a time for it uses the consensus timestamp the
 * mirror node reports, which is the better answer anyway.
 */
export interface AuditFacts {
  kind: string;
  version: number | null;
  at: string | null;
  /** The transaction a reader pastes into HashScan, when the kind has one. */
  transactionId: string | null;
  amount: AuditAmount | null;
  /** The policy this message belongs to, when it names one. */
  policy: string | null;
}

export function auditFacts(message: TopicAuditMessage): AuditFacts {
  const common = { version: message.v, kind: message.kind } as const;
  switch (message.kind) {
    case 'coupon':
      return {
        ...common,
        at: message.paidAt,
        transactionId: message.transactionId,
        amount: { amount: message.amount, asset: message.token, decimals: null },
        policy: null,
      };
    case 'policy':
      return message.status === 'binding'
        ? {
            ...common,
            at: null,
            transactionId: null,
            amount: { amount: message.premium, asset: message.token, decimals: null },
            policy: message.policy,
          }
        : {
            ...common,
            at: message.at,
            transactionId: message.bindTx ?? null,
            amount: null,
            policy: message.policy,
          };
    case 'settlement':
      return {
        ...common,
        at: message.at,
        transactionId: message.tx,
        amount: { amount: message.amount, asset: message.asset, decimals: message.decimals },
        policy: null,
      };
    case 'premium':
    case 'payout':
      return {
        ...common,
        at: message.at,
        transactionId: message.tx,
        amount: { amount: message.amount, asset: message.asset, decimals: message.decimals },
        policy: message.policy,
      };
    case 'claim_packet':
    case 'claim_decision':
      return {
        ...common,
        at: message.at,
        transactionId: null,
        amount: null,
        policy: message.policy,
      };
    default:
      return {
        kind: 'unknown',
        version: message.v,
        at: typeof message.fields['at'] === 'string' ? message.fields['at'] : null,
        transactionId: null,
        amount: null,
        policy: typeof message.fields['policy'] === 'string' ? message.fields['policy'] : null,
      };
  }
}
