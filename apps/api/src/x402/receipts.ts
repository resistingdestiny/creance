/// The x402 settlement message on the payments topic.
///
/// DESIGN.md 3.7: "Every settled payment is written to the HCS payments topic
/// with the facilitator's transaction id, so the audit trail is on-chain and
/// verifiable independently of our database." This is that message.
///
/// It follows the versioned convention the payments topic already carries
/// (docs/DECISIONS.md, "The coupon settlement message on the payments topic,
/// version 1"): a `v`, a `kind`, every amount as an integer string in the
/// asset's minor units, and the transaction id a reader pastes into HashScan.
/// T14 writes `coupon`, T07 writes `policy`, this writes `settlement`, and T18
/// builds the read side from all three.
///
/// Two rules, both load bearing.
///
/// Nothing derived from a person goes on this topic. It is public: no
/// nullifier, no credential, no wallet beyond the account that paid, which is
/// already visible on chain in the transfer itself.
///
/// A message is written only after the facilitator reported a settled
/// transfer. An unsettled payment in the audit trail is worse than a missing
/// one, because the trail is the thing that is supposed to be checkable without
/// asking us.

export const SETTLEMENT_MESSAGE_VERSION = 1;

export interface SettlementMessage {
  v: number;
  kind: 'settlement';
  /** The route as the price table names it, for example `GET /v1/index/:group`. */
  endpoint: string;
  /** x402 protocol version, scheme and CAIP-2 network. */
  x402: number;
  scheme: string;
  network: string;
  payer: string;
  payTo: string;
  amount: string;
  asset: string;
  decimals: number;
  /** The facilitator's own transaction id, `0.0.<feePayer>@<seconds>.<nanos>`. */
  tx: string;
  /** The facilitator host, so the trail still reads if we ever run our own. */
  facilitator: string;
  /** The quote id or the policy id this payment bought, when there is one. */
  ref?: string;
  at: string;
}

export interface SettlementMessageInput {
  endpoint: string;
  scheme: string;
  network: string;
  payer: string;
  payTo: string;
  amount: string;
  asset: string;
  decimals: number;
  transactionId: string;
  facilitator: string;
  ref?: string | null;
  at?: Date;
}

export function settlementMessage(input: SettlementMessageInput): SettlementMessage {
  return {
    v: SETTLEMENT_MESSAGE_VERSION,
    kind: 'settlement',
    endpoint: input.endpoint,
    x402: 2,
    scheme: input.scheme,
    network: input.network,
    payer: input.payer,
    payTo: input.payTo,
    amount: input.amount,
    asset: input.asset,
    decimals: input.decimals,
    tx: input.transactionId,
    facilitator: hostOf(input.facilitator),
    ...(input.ref === undefined || input.ref === null ? {} : { ref: input.ref }),
    at: (input.at ?? new Date()).toISOString(),
  };
}

/** The host alone. The scheme and the path add nothing a reader needs. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
