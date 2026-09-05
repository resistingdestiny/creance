import { AppError } from '../errors.js';
import {
  ACTIVE_POLICY_STATUSES,
  type ClaimAuditRow,
  type ClaimEvidenceRow,
  type ClaimPaidInput,
  type ClaimRow,
  type ClaimStatus,
  type NewClaimInput,
  type RecordDecisionInput,
  type CredentialRow,
  type GroupRow,
  type ObservationRow,
  type PaymentRow,
  type PolicyRow,
  type QuoteRow,
  type Repository,
  type ReservePolicyInput,
  type SeriesRow,
  type UserRow,
} from './types.js';

/// The database-free implementation, for `pnpm test`.
///
/// It is not a stub. It enforces the two rules the schema enforces, the
/// one-active-policy partial index and the capacity check, because those are
/// the rules the bind path is built around and a test that cannot exercise them
/// is a test of the wrong thing. Everything else is a map.

export class MemoryRepository implements Repository {
  private readonly groupRows = new Map<string, GroupRow>();
  private readonly seriesRows = new Map<string, SeriesRow>();
  private readonly userRows = new Map<string, UserRow>();
  private readonly credentialRows = new Map<string, CredentialRow>();
  private readonly quoteRows = new Map<string, QuoteRow>();
  private readonly policyRows = new Map<string, PolicyRow>();
  private readonly paymentRows = new Map<string, PaymentRow>();
  private readonly observationRows = new Map<string, ObservationRow>();
  private readonly claimRows = new Map<string, ClaimAuditRow>();

  constructor(groups: GroupRow[] = []) {
    for (const group of groups) this.groupRows.set(group.groupKey, group);
  }

  async groups(): Promise<GroupRow[]> {
    return [...this.groupRows.values()].sort((a, b) => a.pickerOrder - b.pickerOrder);
  }

  async group(groupKey: string): Promise<GroupRow | null> {
    return this.groupRows.get(groupKey) ?? null;
  }

  async upsertSeries(row: SeriesRow): Promise<void> {
    this.seriesRows.set(row.seriesId, row);
  }

  async series(seriesId: string): Promise<SeriesRow | null> {
    return this.seriesRows.get(seriesId) ?? null;
  }

  async upsertUser(row: UserRow): Promise<void> {
    this.userRows.set(row.nullifier, { ...this.userRows.get(row.nullifier), ...row });
  }

  async insertCredential(row: CredentialRow): Promise<void> {
    if (this.credentialRows.has(row.jti)) {
      throw new AppError(409, 'credential_exists', 'Credential exists', 'That jti is already used.');
    }
    this.credentialRows.set(row.jti, row);
  }

  async credential(jti: string): Promise<CredentialRow | null> {
    return this.credentialRows.get(jti) ?? null;
  }

  async insertQuote(row: QuoteRow): Promise<void> {
    this.quoteRows.set(row.quoteId, row);
  }

  async quote(quoteId: string): Promise<QuoteRow | null> {
    return this.quoteRows.get(quoteId) ?? null;
  }

  async policy(policyId: string): Promise<PolicyRow | null> {
    return this.policyRows.get(policyId) ?? null;
  }

  async activePolicy(nullifier: string, seriesId: string): Promise<PolicyRow | null> {
    return (
      [...this.policyRows.values()].find(
        (row) =>
          row.nullifier === nullifier &&
          row.seriesId === seriesId &&
          ACTIVE_POLICY_STATUSES.includes(row.status),
      ) ?? null
    );
  }

  async reservePolicy(input: ReservePolicyInput): Promise<void> {
    const { policy } = input;
    const active = [...this.policyRows.values()].some(
      (row) =>
        row.nullifier === policy.nullifier &&
        row.seriesId === policy.seriesId &&
        ACTIVE_POLICY_STATUSES.includes(row.status),
    );
    if (active) throw alreadyCovered(policy.seriesId);

    if (input.credentialJti !== null) {
      const credential = this.credentialRows.get(input.credentialJti);
      if (credential === undefined) throw credentialUnknown();
      if (credential.consumedAt !== null) throw credentialConsumed();
      this.credentialRows.set(input.credentialJti, {
        ...credential,
        consumedAt: new Date().toISOString(),
      });
    }

    const quote = this.quoteRows.get(input.quoteId);
    if (quote === undefined || quote.consumedAt !== null) throw quoteConsumed();

    if (BigInt(input.activeExposure) + BigInt(policy.coverLimit) > BigInt(input.principalRemaining)) {
      throw insufficientCapacity();
    }

    this.quoteRows.set(input.quoteId, {
      ...quote,
      consumedAt: new Date().toISOString(),
      policyId: policy.policyId,
    });
    this.policyRows.set(policy.policyId, policy);
    this.paymentRows.set(input.payment.paymentId, input.payment);
  }

  async updatePolicy(policyId: string, patch: Partial<PolicyRow>): Promise<void> {
    const existing = this.policyRows.get(policyId);
    if (existing === undefined) return;
    this.policyRows.set(policyId, { ...existing, ...patch });
  }

  async insertPayment(row: PaymentRow): Promise<void> {
    this.paymentRows.set(row.paymentId, row);
  }

  async paymentByRef(endpoint: string, ref: string): Promise<PaymentRow | null> {
    return (
      [...this.paymentRows.values()].find(
        (row) => row.endpoint === endpoint && row.ref === ref,
      ) ?? null
    );
  }

  async paymentByFacilitatorTx(facilitatorTx: string): Promise<PaymentRow | null> {
    return (
      [...this.paymentRows.values()].find((row) => row.facilitatorTx === facilitatorTx) ?? null
    );
  }

  async paymentsForPolicy(policyId: string, quoteId: string | null): Promise<PaymentRow[]> {
    const refs = new Set([policyId, ...(quoteId === null ? [] : [quoteId])]);
    return [...this.paymentRows.values()]
      .filter((row) => row.ref !== null && refs.has(row.ref))
      .sort((a, b) => a.paymentId.localeCompare(b.paymentId));
  }

  async claimAudit(policyId: string): Promise<ClaimAuditRow[]> {
    return [...this.claimRows.values()]
      .filter((row) => this.claimPolicies.get(row.claimId) === policyId)
      .sort((a, b) => a.claimId.localeCompare(b.claimId));
  }

  async claim(claimId: string): Promise<ClaimRow | null> {
    return this.fullClaims.get(claimId) ?? null;
  }

  async claimsByStatus(status: ClaimStatus, limit: number): Promise<ClaimRow[]> {
    return [...this.fullClaims.values()]
      .filter((row) => row.status === status)
      .sort((a, b) => (a.submittedAt ?? '').localeCompare(b.submittedAt ?? ''))
      .slice(0, limit);
  }

  async priorClaimCount(
    nullifier: string,
    seriesId: string,
    exceptClaimId: string,
  ): Promise<number> {
    return [...this.fullClaims.values()].filter(
      (row) =>
        row.nullifier === nullifier &&
        row.seriesId === seriesId &&
        row.claimId !== exceptClaimId &&
        row.status !== 'void',
    ).length;
  }

  /** The same two partial unique indexes the schema takes, taken here. */
  async insertClaim(input: NewClaimInput): Promise<ClaimRow> {
    const { claim } = input;
    for (const existing of this.fullClaims.values()) {
      if (existing.status === 'void' || existing.seriesId !== claim.seriesId) continue;
      if (existing.nullifier === claim.nullifier) throw alreadyClaimed();
      if (
        claim.claimNullifier !== null &&
        existing.claimNullifier === claim.claimNullifier
      ) {
        throw alreadyClaimed();
      }
    }
    this.putClaim(claim, input.evidence);
    const policy = this.policyRows.get(claim.policyId);
    if (policy !== undefined) {
      this.policyRows.set(policy.policyId, { ...policy, status: 'claimed' });
    }
    return claim;
  }

  async claimsAwaitingPacket(limit: number): Promise<ClaimRow[]> {
    return [...this.fullClaims.values()]
      .filter((row) => row.packetHash !== null && row.hcsSubmittedSeq === null)
      .sort((a, b) => (a.submittedAt ?? '').localeCompare(b.submittedAt ?? ''))
      .slice(0, limit);
  }

  async recordPacketSequence(claimId: string, sequenceNumber: number): Promise<ClaimRow | null> {
    const existing = this.fullClaims.get(claimId);
    if (existing === undefined || existing.packetHash === null) return null;
    if (existing.hcsSubmittedSeq !== null) return null;
    const updated = { ...existing, hcsSubmittedSeq: sequenceNumber };
    this.putClaim(updated, this.evidenceRows.get(claimId) ?? []);
    return updated;
  }

  async recordAuthorisation(
    claimId: string,
    authorisation: string,
    deadline: string,
  ): Promise<void> {
    const existing = this.fullClaims.get(claimId);
    if (existing === undefined) return;
    this.putClaim(
      { ...existing, authorisation, authorisationDeadline: deadline },
      this.evidenceRows.get(claimId) ?? [],
    );
  }

  async markClaimPaid(input: ClaimPaidInput): Promise<ClaimRow | null> {
    const existing = this.fullClaims.get(input.claimId);
    if (existing === undefined) return null;
    if (existing.paidTx !== null) return existing;
    const updated: ClaimRow = {
      ...existing,
      status: 'paid',
      amount: input.amount,
      paidTx: input.paidTx,
      paidAt: input.paidAt,
    };
    this.putClaim(updated, this.evidenceRows.get(input.claimId) ?? []);
    const policy = this.policyRows.get(existing.policyId);
    if (policy !== undefined) {
      this.policyRows.set(policy.policyId, { ...policy, status: 'paid' });
    }
    return updated;
  }

  async claimEvidence(claimId: string): Promise<ClaimEvidenceRow[]> {
    return (this.evidenceRows.get(claimId) ?? []).slice();
  }

  async evidenceSeenElsewhere(claimId: string, hashes: string[]): Promise<Set<string>> {
    const wanted = new Set(hashes);
    const seen = new Set<string>();
    for (const [id, rows] of this.evidenceRows) {
      if (id === claimId) continue;
      for (const row of rows) if (wanted.has(row.sha256)) seen.add(row.sha256);
    }
    return seen;
  }

  /** The same lock the SQL has: a claim that is not waiting is not decidable. */
  async recordDecision(input: RecordDecisionInput): Promise<ClaimRow> {
    const existing = this.fullClaims.get(input.claimId);
    if (
      existing === undefined ||
      (existing.status !== 'submitted' && existing.status !== 'under_review')
    ) {
      throw claimNotDecidable();
    }
    const updated: ClaimRow = {
      ...existing,
      status: input.status,
      decision: input.decision,
      reasons: input.reasons,
      confidence: input.confidence,
      decisionHash: input.decisionHash,
      decisionRecord: input.decisionRecord,
      hcsDecisionSeq: input.hcsDecisionSeq,
      amount: input.amount,
      decidedBy: input.decidedBy,
      reviewer: input.reviewer,
      decidedAt: input.decidedAt,
    };
    this.fullClaims.set(input.claimId, updated);
    const policy = this.policyRows.get(existing.policyId);
    const next = POLICY_STATUS_FOR[input.status];
    if (policy !== undefined && next !== undefined) {
      this.policyRows.set(policy.policyId, { ...policy, status: next });
    }
    return updated;
  }

  async recordDecisionSequence(claimId: string, sequenceNumber: number): Promise<ClaimRow | null> {
    const existing = this.fullClaims.get(claimId);
    if (existing === undefined || existing.decisionHash === null) return null;
    if (existing.hcsDecisionSeq !== null) return null;
    const updated = { ...existing, hcsDecisionSeq: sequenceNumber };
    this.fullClaims.set(claimId, updated);
    return updated;
  }

  async updatePayment(paymentId: string, patch: Partial<PaymentRow>): Promise<void> {
    const existing = this.paymentRows.get(paymentId);
    if (existing === undefined) return;
    this.paymentRows.set(paymentId, { ...existing, ...patch });
  }

  async observations(groupKey: string, limit: number): Promise<ObservationRow[]> {
    return [...this.observationRows.values()]
      .filter((row) => row.groupKey === groupKey && row.status === 'final')
      .sort((a, b) => b.period - a.period)
      .slice(0, limit);
  }

  async upsertObservations(rows: ObservationRow[]): Promise<number> {
    for (const row of rows) {
      this.observationRows.set(`${row.groupKey}|${row.period}|${row.status}`, row);
    }
    return rows.length;
  }

  async close(): Promise<void> {
    // Nothing to release.
  }

  /**
   * Test reach-in: a claim on a policy. T13 owns the write path; until it
   * exists the audit endpoint's claim entries are driven from here.
   */
  private readonly claimPolicies = new Map<string, string>();

  addClaim(policyId: string, row: ClaimAuditRow): void {
    this.claimRows.set(row.claimId, row);
    this.claimPolicies.set(row.claimId, policyId);
  }

  /** The full claims the review queue reads, and their evidence. */
  private readonly fullClaims = new Map<string, ClaimRow>();
  private readonly evidenceRows = new Map<string, ClaimEvidenceRow[]>();

  /** Test reach-in: the whole claim, as T13's submit path will write it. */
  putClaim(row: ClaimRow, evidence: ClaimEvidenceRow[] = []): void {
    this.fullClaims.set(row.claimId, row);
    this.evidenceRows.set(row.claimId, evidence);
    this.claimPolicies.set(row.claimId, row.policyId);
    this.claimRows.set(row.claimId, {
      claimId: row.claimId,
      status: row.status,
      packetHash: row.packetHash,
      decisionHash: row.decisionHash,
      decision: row.decision,
      amount: row.amount,
      hcsSubmittedSeq: row.hcsSubmittedSeq,
      hcsDecisionSeq: row.hcsDecisionSeq,
      paidTx: row.paidTx,
      submittedAt: row.submittedAt,
      decidedAt: row.decidedAt,
      paidAt: row.paidAt,
    });
  }

  /** Test reach-in: a bound policy, without going through the bind path. */
  putPolicy(row: PolicyRow): void {
    this.policyRows.set(row.policyId, row);
  }

  /** Test reach-in: the payment written beside a policy. */
  paymentsFor(ref: string): PaymentRow[] {
    return [...this.paymentRows.values()].filter((row) => row.ref === ref);
  }
}

/** The policy status a decided claim leaves behind. Mirrors the SQL. */
const POLICY_STATUS_FOR: Record<string, PolicyRow['status']> = {
  approved: 'approved',
  declined: 'declined',
  under_review: 'under_review',
};

export function claimNotDecidable(): AppError {
  return new AppError(
    409,
    'claim_not_decidable',
    'Claim already decided',
    'That claim is not waiting for a decision. Somebody decided it first.',
  );
}

/**
 * One claim per person per series, ever. DESIGN.md 3.2.
 *
 * Three layers enforce it and each is a different failure mode: this index,
 * rule R06 in the Adjuster, and `nullifierClaimed` inside `payClaim`. It is the
 * rule that stops one person collecting twice, so three is right.
 */
export function alreadyClaimed(): AppError {
  return new AppError(
    409,
    'already_claimed',
    'You have already claimed on this cover',
    'One claim per person per series, and this person has already made theirs.',
  );
}

export function alreadyCovered(seriesId: string): AppError {
  return new AppError(
    409,
    'already_covered',
    'Already covered',
    `An active policy already exists for this person in ${seriesId}.`,
  );
}

export function credentialUnknown(): AppError {
  return new AppError(
    401,
    'credential_unknown',
    'Credential unknown',
    'This API did not issue that credential.',
  );
}

export function credentialConsumed(): AppError {
  return new AppError(
    409,
    'credential_consumed',
    'Credential already used',
    'That eligibility credential has already bought a policy. Verify again.',
  );
}

export function quoteConsumed(): AppError {
  return new AppError(
    409,
    'quote_consumed',
    'Quote already used',
    'That quote has already been bound. Ask for a fresh one.',
  );
}

export function insufficientCapacity(): AppError {
  return new AppError(
    409,
    'insufficient_capacity',
    'No capacity',
    'The series has no capacity left for a policy of that size.',
  );
}
