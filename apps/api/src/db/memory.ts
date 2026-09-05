import { AppError } from '../errors.js';
import {
  ACTIVE_POLICY_STATUSES,
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

  /** Test reach-in: the payment written beside a policy. */
  paymentsFor(ref: string): PaymentRow[] {
    return [...this.paymentRows.values()].filter((row) => row.ref === ref);
  }
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
