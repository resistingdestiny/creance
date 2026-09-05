/// The policy receipt on the payments topic.
///
/// The acceptance for this ticket asks for the receipt on the index topic. The
/// index topic's submit key is the oracle's and the API cannot write to it, so
/// the receipt goes to the payments topic, whose submit key the api account
/// holds. T14 already writes versioned messages there with a `kind` field
/// (docs/DECISIONS.md, "The coupon settlement message on the payments topic,
/// version 1"), so a `kind: "policy"` message sits beside the coupons without
/// a new topic or a change to the read side. The choice is recorded in
/// docs/DECISIONS.md as the acceptance line asks.
///
/// Two messages per bind, not one, and the reason is the ordering that
/// `CoverPool.bind` forces: `hcsReceiptSeq` is a bind input, so the receipt has
/// to exist before the contract call, and a call that then reverts would leave
/// a receipt claiming a policy that does not exist. So the first message says
/// `status: "binding"` and the second says `bound` or `failed` and carries the
/// bind transaction and the NFT serial. A reader takes the second message as
/// the outcome and the first only as the sequence number the chain records.
///
/// Both are well under the roughly 1 KB HCS cap. Every amount is an integer
/// string in the settlement token's minor units, matching the coupon message.

export const POLICY_MESSAGE_VERSION = 1;

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
  /** When the price was struck, which is before startAt, never the expiry. */
  quotedAt: string;
}

export interface PolicyBoundMessage {
  v: number;
  kind: 'policy';
  /**
   * `bound` means CoverPool holds the policy. `failed` means it does not and
   * the binding message above it describes nothing.
   */
  status: 'bound' | 'failed';
  series: string;
  policy: string;
  /** The sequence number of the binding message this one resolves. */
  receiptSeq: number;
  bindTx?: string;
  nft?: string;
  serial?: number;
  /**
   * Why, when something went wrong. It appears on a `failed` message and also
   * on a `bound` one whose policy receipt did not mint, because the cover is
   * real either way and only the receipt is missing.
   */
  reason?: string;
  at: string;
}

export interface PolicyBindingInput {
  seriesLabel: string;
  seriesKey: string;
  policyId: string;
  groupKey: string;
  holderAccountId: string;
  holderAddress: string;
  limit: bigint;
  premium: bigint;
  tokenId: string;
  startAt: Date;
  quotedAt: Date;
}

export function policyBindingMessage(input: PolicyBindingInput): PolicyBindingMessage {
  return {
    v: POLICY_MESSAGE_VERSION,
    kind: 'policy',
    status: 'binding',
    series: input.seriesLabel,
    seriesId: input.seriesKey,
    policy: input.policyId,
    group: input.groupKey,
    holder: input.holderAccountId,
    holderAddress: input.holderAddress,
    limit: input.limit.toString(),
    premium: input.premium.toString(),
    token: input.tokenId,
    startAt: input.startAt.toISOString(),
    quotedAt: input.quotedAt.toISOString(),
  };
}

export interface PolicyOutcomeInput {
  seriesLabel: string;
  policyId: string;
  receiptSeq: number;
  /**
   * `bound` when CoverPool accepted the policy, `failed` when it did not.
   *
   * Stated rather than inferred from `reason`, because the two are
   * independent: a bind whose NFT mint failed afterwards is `bound` with a
   * reason, and reading the status off the presence of a reason would publish
   * it as a policy that does not exist.
   */
  status: 'bound' | 'failed';
  bindTx?: string;
  nftTokenId?: string;
  serial?: number;
  reason?: string;
  at?: Date;
}

export function policyBoundMessage(input: PolicyOutcomeInput): PolicyBoundMessage {
  return {
    v: POLICY_MESSAGE_VERSION,
    kind: 'policy',
    status: input.status,
    series: input.seriesLabel,
    policy: input.policyId,
    receiptSeq: input.receiptSeq,
    ...(input.bindTx === undefined ? {} : { bindTx: input.bindTx }),
    ...(input.nftTokenId === undefined ? {} : { nft: input.nftTokenId }),
    ...(input.serial === undefined ? {} : { serial: input.serial }),
    ...(input.reason === undefined ? {} : { reason: input.reason }),
    at: (input.at ?? new Date()).toISOString(),
  };
}

/** The HCS message cap is roughly 1 KB. Refuse rather than have it chunked. */
export const MAX_TOPIC_MESSAGE_BYTES = 1024;

export function encodeTopicMessage(message: unknown): string {
  const text = JSON.stringify(message);
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes > MAX_TOPIC_MESSAGE_BYTES) {
    throw new Error(`topic message is ${bytes} bytes, over the ${MAX_TOPIC_MESSAGE_BYTES} cap`);
  }
  return text;
}
