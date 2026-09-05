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
