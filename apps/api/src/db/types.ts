import type { SeniorityBand } from '@creance/index-model';

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

/** One group's newest settled period, as `latestPeriods` reports it. */
export interface LatestPeriod {
  groupKey: string;
  period: number;
}

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

/**
 * One issued cover key, as the table holds it.
 *
 * The key is not here. `keyHash` is a SHA-256 digest of it, so this row opens
 * nothing on its own, and the route that takes a key computes the same digest
 * and reads by primary key. See apps/api/src/cover-key.ts.
 */
export interface CoverKeyRow {
  keyHash: string;
  policyId: string;
  createdAt: string;
}

/**
 * One commitment of capital to one experience band of one series.
 *
 * The vault holds the money against the series and knows nothing of bands, so
 * this is the record of which band that capital will take. Principal with no
 * row here is unallocated and stands behind all three bands. See
 * apps/api/src/capacity.ts.
 */
export interface BandSubscriptionRow {
  subscriptionId: string;
  /** The series label, the same string `policies.seriesId` carries. */
  seriesId: string;
  band: SeniorityBand;
  /** The account that committed it, as it identifies itself on chain. */
  holder: string;
  /** Minor units of the settlement asset. */
  amount: string;
  /** The vault subscription this belongs to, where there is one. */
  chainTx: string | null;
  createdAt: string;
}

/** Exposure written in one band, as `bandExposure` sums it. */
export interface BandExposureRow {
  band: SeniorityBand;
  amount: string;
}

export interface QuoteRow {
  quoteId: string;
  seriesId: string;
  groupKey: string;
  /**
   * The experience band the price was struck in, or null for a quote that
   * named none. Null is priced against the capital that named no band, which
   * is what every quote before bands existed was priced against.
   */
  band: SeniorityBand | null;
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

/**
 * The statuses a person signing in should be shown a cover for.
 *
 * Not `ACTIVE_POLICY_STATUSES`. That set answers "would a second purchase be
 * refused", so it leaves out `lapsed`, `payment_failed` and `expired`, and a
 * person whose cover has lapsed is exactly the person who most needs to reach
 * it: the dashboard has a Payment due state built for them and a button that
 * takes the payment. Telling them they never bought cover would be false.
 *
 * Everything but `void`, which is a bind that reverted and never became cover.
 * That is also what a cover key opens, and the two ways in have to find the
 * same covers or one of them is lying.
 */
export const SIGN_IN_POLICY_STATUSES: readonly PolicyStatus[] = [
  'binding',
  'bound',
  'active',
  'payment_failed',
  'lapsed',
  'claims_open',
  'claimed',
  'under_review',
  'approved',
  'paid',
  'declined',
  'expired',
];

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
  /**
   * The band the cover was written in, or null for a policy bound before the
   * question was asked. A null policy keeps every term it had: the band was
   * never part of the trigger or the payout, only of the price.
   */
  band: SeniorityBand | null;
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
  /**
   * The nullifier the claim's own check returned, when it is a different
   * number from the policy's.
   *
   * Null when purchase and claim run one registered action, which is the
   * regime docs/DECISIONS.md, T11 calls continuity: then the two are the same
   * value and `nullifier` is the whole story. Non-null when they run two, and
   * then it is the key "one claim per person per series, ever" is taken on.
   */
  claimNullifier: string | null;
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
  /** The action the live person check was scoped to, as the proof carried it. */
  worldAction: string | null;
  /** `user_presence_completed` off the proof itself, never what was asked for. */
  worldPresence: boolean;
  packetHash: string | null;
  packetManifest: Record<string, unknown> | null;
  decision: 'approve' | 'refer' | 'decline' | null;
  reasons: string[];
  /**
   * The sentences a person reads, one per code, as the Adjuster composed them.
   *
   * Served from the admin payload and never from the free claim read: they
   * carry dates and sometimes an employer name, and a claim id is public
   * because the claims topic carries it.
   */
  reasonLines: { code: string; line: string }[];
  /** Whether a corrected packet would be worth submitting, and why. */
  resubmit: { allowed: boolean; why: string } | null;
  confidence: string | null;
  reviewer: string | null;
  decidedBy: string | null;
  decisionHash: string | null;
  decisionRecord: Record<string, unknown> | null;
  amount: string | null;
  qualifyingMonth: number | null;
  claimDeadline: string | null;
  /** The CLAIMS role's signature, reusable until its deadline. */
  authorisation: string | null;
  authorisationDeadline: string | null;
  hcsSubmittedSeq: number | null;
  hcsDecisionSeq: number | null;
  paidTx: string | null;
  submittedAt: string | null;
  decidedAt: string | null;
  paidAt: string | null;
}

/**
 * Everything the submission writes, applied in one transaction.
 *
 * The five fields beside the row are columns 001 created that the admin
 * projection has no business carrying: the credential that was consumed, the
 * two field hashes the packet manifest publishes instead of the values, and the
 * signed message with its signature. They are written and never read back into
 * `ClaimRow`, because the review screen shows the employer and the name in the
 * clear from the sealed columns and has no use for a hash of them.
 */
export interface NewClaimInput {
  claim: ClaimRow;
  evidence: ClaimEvidenceRow[];
  credentialJti: string | null;
  employerHash: string | null;
  nameHash: string | null;
  attestationMessageHash: string | null;
  attestationSignature: string | null;
}

/** What the pay step writes once `payClaim` has returned. */
export interface ClaimPaidInput {
  claimId: string;
  amount: string;
  paidTx: string;
  paidAt: string;
}

/** Everything one decision writes, applied in one transaction. */
export interface RecordDecisionInput {
  claimId: string;
  status: ClaimStatus;
  decision: 'approve' | 'refer' | 'decline';
  reasons: string[];
  reasonLines: { code: string; line: string }[];
  resubmit: { allowed: boolean; why: string } | null;
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
  /**
   * The same two amounts for the band this policy is written in, or for the
   * capital that named no band when the policy names none.
   *
   * Both checks are taken, the series one and the band one. The series one
   * mirrors what `CoverPool.bind` will enforce a moment later and is the one
   * that cannot be argued with; the band one is this system's own rule and
   * stops a band being sold past the capital that actually chose it.
   */
  bandExposure: string;
  bandCapital: string;
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
  /**
   * Record capital committed to one band of one series.
   *
   * The only way a band gets capital. There is no default allocation, no
   * migration that assigns one and no multiplier standing in for one: a band is
   * funded because a real holder committed a real amount to it, or it is not
   * funded at all.
   */
  insertBandSubscription(row: BandSubscriptionRow): Promise<void>;
  /** Every commitment to this series, in the order they were made. */
  bandSubscriptions(seriesId: string): Promise<BandSubscriptionRow[]>;
  /**
   * Exposure written per band on this series, summed over the statuses given.
   *
   * The statuses come from apps/api/src/capacity.ts rather than from here, so
   * that what counts as exposure is decided once and in the open.
   */
  bandExposure(seriesId: string, statuses: readonly PolicyStatus[]): Promise<BandExposureRow[]>;
  policy(policyId: string): Promise<PolicyRow | null>;
  /**
   * The policy the one-active-policy rule would refuse a second purchase
   * against, or null. Read only: the rule itself is taken inside
   * `reservePolicy`, and this is how a screen can say it before a payment.
   */
  activePolicy(nullifier: string, seriesId: string): Promise<PolicyRow | null>;
  /**
   * Every cover this person holds, newest first, for signing in.
   *
   * `activePolicy` answers the one-active-policy rule, which is per series.
   * Signing in has no series to ask about: the person proves who they are and
   * the cover has to be found from that alone. Fifteen series are live, so the
   * alternative is fifteen reads to answer one question.
   *
   * `SIGN_IN_POLICY_STATUSES` and not the one-active-policy set, so a lapsed
   * cover is found rather than reported as no cover at all.
   */
  policiesForPerson(nullifier: string): Promise<PolicyRow[]>;
  /** Records a cover key by its digest. Many keys may open one cover. */
  insertCoverKey(row: CoverKeyRow): Promise<void>;
  /** The cover a key digest opens, or null. */
  policyForCoverKey(keyHash: string): Promise<PolicyRow | null>;
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
  /**
   * Write a submitted claim and its evidence, and move the cover with it.
   *
   * One transaction, because the rule it takes is the one that stops a person
   * collecting twice: the partial unique indexes on `(nullifier, series_id)`
   * and `(claim_nullifier, series_id)` are the enforcement point, and a check
   * followed by an insert is a race. Throws an AppError when a rule refuses.
   */
  insertClaim(input: NewClaimInput): Promise<ClaimRow>;
  /**
   * Submitted claims whose packet hash has not reached the claims topic.
   *
   * The same shape as the unpublished decisions and for the same reason: the
   * claims topic's submit key is the adjuster account's, so the API writes the
   * hash into the row and the Adjuster puts it on the topic.
   */
  claimsAwaitingPacket(limit: number): Promise<ClaimRow[]>;
  /** Where a packet hash reached the claims topic. Touches no other column. */
  recordPacketSequence(claimId: string, sequenceNumber: number): Promise<ClaimRow | null>;
  /** The signature and its deadline, stored so a failed payout can be retried. */
  recordAuthorisation(claimId: string, authorisation: string, deadline: string): Promise<void>;
  /**
   * The payout, once the money has moved.
   *
   * Idempotent on `paid_tx`: a claim that already carries one is returned
   * unchanged, because `payClaim` succeeded and a second write would be a
   * second story about one transfer.
   */
  markClaimPaid(input: ClaimPaidInput): Promise<ClaimRow | null>;
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
  /**
   * Record where a decision reached the claims topic, and nothing else.
   *
   * A human decision is stored with its record and its hash, and the API cannot
   * publish it because the claims topic's submit key is the adjuster account's.
   * The Adjuster publishes it and writes the sequence number back through this,
   * which touches no other column and cannot reopen a decided claim.
   */
  recordDecisionSequence(claimId: string, sequenceNumber: number): Promise<ClaimRow | null>;
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
  /**
   * The newest settled period for every group that has one.
   *
   * One query rather than fifteen, because the free index catalogue answers
   * "which occupations have a reading" for every group in one response and a
   * free route should not cost fifteen round trips to serve.
   */
  latestPeriods(): Promise<LatestPeriod[]>;
  upsertObservations(rows: ObservationRow[]): Promise<number>;
  close(): Promise<void>;
}
