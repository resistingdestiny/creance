/// The rows the policy endpoints read and write, and the interface behind
/// which they live.
///
/// Every amount is a decimal string in the settlement asset's minor units, the
/// same form the wire and the contracts use, so nothing on the path from the
/// request body to `CoverPool.bind` ever becomes a JavaScript number. Periods
/// are YYYYMM integers, matching the `uint32` the contracts take.
///
/// The interface exists so that `pnpm test` needs no database: the unit tests
/// drive `MemoryRepository` and the testnet stage drives `PostgresRepository`.

export interface GroupRow {
  groupKey: string;
  label: string;
  blsSeries: string;
  pickerOrder: number;
}

export type SeriesStatus =
  | 'drafted'
  | 'issued'
  | 'subscribing'
  | 'active'
  | 'claims_open'
  | 'settling'
  | 'matured'
  | 'redeemed';

export interface SeriesRow {
  seriesId: string;
  /** The bytes32 key on chain. */
  seriesKey: string;
  groupKey: string;
  status: SeriesStatus;
  principal: string;
  couponRateBps: number;
  attachmentShock: number;
  levelLine: number;
  exhaustionShock: number | null;
  payoutMode: 'full' | 'indexed';
  termMonths: number;
  waitingPeriodDays: number;
  gracePeriodDays: number;
  claimWindowObsDays: number;
  claimWindowSepDays: number;
  lookbackMonths: number;
  /**
   * The auto-approval gate, per series. Neither number is on chain: the frozen
   * terms are what a policyholder is owed, and how much of the adjudication we
   * automate is ours to set. Minor units, and three decimals, as the columns
   * hold them.
   */
  autoApprovalLimit: string;
  autoApprovalConfidence: number;
  coverPool: string | null;
  collateralVault: string | null;
  maturesAt: string | null;
}

export interface UserRow {
  nullifier: string;
  groupKey: string | null;
  wallet: string | null;
  walletEvm: string | null;
}

export interface CredentialRow {
  jti: string;
  kind: 'eligibility' | 'claim';
  nullifier: string;
  seriesId: string | null;
  groupKey: string | null;
  policyId: string | null;
  wallet: string | null;
  walletEvm: string | null;
  presence: boolean;
  issuer: string;
  issuedAt: string;
  expiresAt: string;
  consumedAt: string | null;
}

export interface QuoteRow {
  quoteId: string;
  seriesId: string;
  groupKey: string;
  wallet: string;
  walletEvm: string | null;
  coverLimit: string;
  premium: string;
  asset: string;
  assetDecimals: number;
  annualRateBps: number;
  pricingBasis: Record<string, unknown>;
  issuedVia: 'x402' | 'credential' | 'open';
  /** When the price was struck. The binding receipt publishes this as quotedAt. */
  createdAt: string;
  expiresAt: string;
  consumedAt: string | null;
  policyId: string | null;
}

export type PolicyStatus =
  | 'binding'
  | 'bound'
  | 'active'
  | 'payment_failed'
  | 'lapsed'
  | 'claims_open'
  | 'claimed'
  | 'under_review'
  | 'approved'
  | 'paid'
  | 'declined'
  | 'expired'
  | 'void';

/** The statuses the one-active-policy rule counts. Mirrors the partial index. */
export const ACTIVE_POLICY_STATUSES: readonly PolicyStatus[] = [
  'binding',
  'bound',
  'active',
  'claims_open',
  'claimed',
  'under_review',
  'approved',
  'paid',
  'declined',
];

export interface PolicyRow {
  policyId: string;
  seriesId: string;
  groupKey: string;
  nullifier: string;
  wallet: string;
  walletEvm: string;
  coverLimit: string;
  premium: string;
  asset: string;
  assetDecimals: number;
  status: PolicyStatus;
  quoteId: string | null;
  credentialJti: string | null;
  startsAt: string;
  endsAt: string;
  claimsPayableFrom: string;
  paidThrough: number;
  nextDue: string | null;
  nftTokenId: string | null;
  nftSerial: number | null;
  hcsTopic: string | null;
  hcsReceiptSeq: number | null;
  bindTxId: string | null;
}

export interface PaymentRow {
  paymentId: string;
  endpoint: string;
  payer: string;
  payTo: string;
  amount: string;
  asset: string;
  assetDecimals: number;
  facilitator: string | null;
  facilitatorTx: string | null;
  chainTxId: string | null;
  status: 'uncollected' | 'settled' | 'failed';
  ref: string | null;
  settledAt: string | null;
  hcsTopic: string | null;
  hcsSeq: number | null;
  requestId: string;
}

/**
 * The columns of a claim the audit trail reads, and only those.
 *
 * A claim row carries the attestation, the employer and the separation date,
 * which are about a person; `GET /v1/audit/:policyId` is free, so it must not
 * be able to reach them even by accident. T13 and T25 own the full row and
 * will define it; this is the projection the read side needs and nothing more.
 */
export interface ClaimAuditRow {
  claimId: string;
  status: string;
  packetHash: string | null;
  decisionHash: string | null;
  decision: 'approve' | 'refer' | 'decline' | null;
  amount: string | null;
  hcsSubmittedSeq: number | null;
  hcsDecisionSeq: number | null;
  paidTx: string | null;
  submittedAt: string | null;
  decidedAt: string | null;
  paidAt: string | null;
}

export type ClaimStatus =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'approved'
  | 'declined'
  | 'paid'
  | 'expired'
  | 'void';

/** One evidence file, as the row holds it. The key material never leaves here. */
export interface ClaimEvidenceRow {
  evidenceId: string;
  claimId: string;
  kind: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  /** `sha256:<hex>` over the plaintext, which is what the claimant can recompute. */
  sha256: string;
  objectKey: string;
  encIv: Buffer;
  encTag: Buffer;
  encDek: Buffer;
  encKekId: string;
  uploadedAt: string;
}

/**
 * The whole claim, as the review queue reads it.
 *
 * This is the row the admin endpoints project from, and it is deliberately
 * separate from `ClaimAuditRow`: the audit trail is free and public and must
 * not be able to reach the employer, the name or the separation date even by
 * accident, so the two projections are two types and not one type with a flag.
 */
export interface ClaimRow {
  claimId: string;
  policyId: string;
  seriesId: string;
  nullifier: string;
  groupKey: string;
  status: ClaimStatus;
  /**
   * Still sealed. The repository holds no key material: the claims module
   * unwraps these for the admin path and nothing else ever sees them.
   */
  employerNameEnc: Buffer | null;
  claimantNameEnc: Buffer | null;
  jobTitle: string | null;
  separationDate: string;
  separationType: string;
  attestationMethod: 'eip191' | 'hedera_sign_message' | 'unsigned_accepted' | null;
  attestationVerified: boolean;
  statementAccepted: boolean;
  verifiedAt: string | null;
  packetHash: string | null;
  packetManifest: Record<string, unknown> | null;
  decision: 'approve' | 'refer' | 'decline' | null;
  reasons: string[];
  confidence: string | null;
  reviewer: string | null;
  decidedBy: string | null;
  decisionHash: string | null;
  decisionRecord: Record<string, unknown> | null;
  amount: string | null;
  qualifyingMonth: number | null;
  claimDeadline: string | null;
  hcsSubmittedSeq: number | null;
  hcsDecisionSeq: number | null;
  submittedAt: string | null;
  decidedAt: string | null;
}

/** Everything one decision writes, applied in one transaction. */
export interface RecordDecisionInput {
  claimId: string;
  status: ClaimStatus;
  decision: 'approve' | 'refer' | 'decline';
  reasons: string[];
  confidence: string | null;
  decisionHash: string | null;
  decisionRecord: Record<string, unknown> | null;
  hcsDecisionSeq: number | null;
  amount: string | null;
  decidedBy: string;
  /** A human's name, when a human decided. Null for the Adjuster. */
  reviewer: string | null;
  decidedAt: string;
}

export interface ObservationRow {
  groupKey: string;
  seriesId: string | null;
  period: number;
  uG: number | null;
  uAll: number | null;
  e: number | null;
  ebar: number | null;
  odi: number | null;
  open: boolean;
  openReason: 'shock' | 'level' | 'both' | null;
  status: 'final' | 'revised' | 'insufficient_history' | 'no_source';
  modelVersion: string;
  source: string | null;
  sourceHash: string | null;
  computedAt: string;
  hcsTopic: string | null;
  hcsSeq: number | null;
  submitTx: string | null;
  replay: boolean;
}

/** Everything the bind commit needs, checked and written in one transaction. */
export interface ReservePolicyInput {
  policy: PolicyRow;
  /** The credential to consume, or null when the caller had none to consume. */
  credentialJti: string | null;
  quoteId: string;
  /** The exposure already committed on chain, in minor units. */
  activeExposure: string;
  /** The principal still behind the series, in minor units. */
  principalRemaining: string;
  payment: PaymentRow;
}

export interface Repository {
  groups(): Promise<GroupRow[]>;
  group(groupKey: string): Promise<GroupRow | null>;
  upsertSeries(row: SeriesRow): Promise<void>;
  series(seriesId: string): Promise<SeriesRow | null>;
  upsertUser(row: UserRow): Promise<void>;
  insertCredential(row: CredentialRow): Promise<void>;
  credential(jti: string): Promise<CredentialRow | null>;
  insertQuote(row: QuoteRow): Promise<void>;
  quote(quoteId: string): Promise<QuoteRow | null>;
  policy(policyId: string): Promise<PolicyRow | null>;
  /**
   * The policy the one-active-policy rule would refuse a second purchase
   * against, or null. Read only: the rule itself is taken inside
   * `reservePolicy`, and this is how a screen can say it before a payment.
   */
  activePolicy(nullifier: string, seriesId: string): Promise<PolicyRow | null>;
  /**
   * Check the one-active-policy rule and the capacity, consume the credential
   * and the quote, and write the policy and its first premium, all atomically.
   * Throws an AppError when a rule refuses.
   */
  reservePolicy(input: ReservePolicyInput): Promise<void>;
  updatePolicy(
    policyId: string,
    patch: Partial<
      Pick<
        PolicyRow,
        'status' | 'nftTokenId' | 'nftSerial' | 'hcsTopic' | 'hcsReceiptSeq' | 'bindTxId'
      >
    >,
  ): Promise<void>;
  /** A settlement for an endpoint that had no row waiting, from T08's gate. */
  insertPayment(row: PaymentRow): Promise<void>;
  /** The row a bind wrote at `uncollected`, found by the policy it belongs to. */
  paymentByRef(endpoint: string, ref: string): Promise<PaymentRow | null>;
  /** The idempotency key: one settled row per facilitator transaction. */
  paymentByFacilitatorTx(facilitatorTx: string): Promise<PaymentRow | null>;
  /**
   * Every payment recorded against one policy, oldest first.
   *
   * Two references, because a policy is paid for twice under two names: the
   * bind premium carries the policy id as its `ref`, and the index read and
   * the quote that came before it carry the quote id, which the policy row
   * still points at. Both belong on the policy's receipt.
   */
  paymentsForPolicy(policyId: string, quoteId: string | null): Promise<PaymentRow[]>;
  /** The claims on a policy, projected down to what the audit trail shows. */
  claimAudit(policyId: string): Promise<ClaimAuditRow[]>;
  /** One claim, whole, for the review queue. */
  claim(claimId: string): Promise<ClaimRow | null>;
  /** The queue, oldest first, which is the order a queue is worked. */
  claimsByStatus(status: ClaimStatus, limit: number): Promise<ClaimRow[]>;
  /** Other non-void claims for this person in this series, excluding one id. */
  priorClaimCount(nullifier: string, seriesId: string, exceptClaimId: string): Promise<number>;
  /** The evidence rows of one claim, with their key material. */
  claimEvidence(claimId: string): Promise<ClaimEvidenceRow[]>;
  /** How many other claims carry a file with this hash. Rule R29. */
  evidenceSeenElsewhere(claimId: string, hashes: string[]): Promise<Set<string>>;
  /**
   * Write the decision. Refuses a claim that is not decidable, which is the
   * lock: two Adjuster passes, or an Adjuster racing a human, produce one
   * decision and the loser is told so rather than overwriting.
   */
  recordDecision(input: RecordDecisionInput): Promise<ClaimRow>;
  updatePayment(
    paymentId: string,
    patch: Partial<
      Pick<
        PaymentRow,
        'hcsTopic' | 'hcsSeq' | 'status' | 'payer' | 'facilitator' | 'facilitatorTx' | 'settledAt'
      >
    >,
  ): Promise<void>;
  observations(groupKey: string, limit: number): Promise<ObservationRow[]>;
  upsertObservations(rows: ObservationRow[]): Promise<number>;
  close(): Promise<void>;
}
