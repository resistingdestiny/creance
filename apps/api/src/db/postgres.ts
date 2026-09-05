import pg from 'pg';

import { AppError } from '../errors.js';
import {
  alreadyCovered,
  claimNotDecidable,
  credentialConsumed,
  credentialUnknown,
  insufficientCapacity,
  quoteConsumed,
} from './memory.js';
import { ACTIVE_POLICY_STATUSES } from './types.js';
import type {
  ClaimEvidenceRow,
  ClaimRow,
  ClaimStatus,
  CredentialRow,
  GroupRow,
  ObservationRow,
  ClaimAuditRow,
  RecordDecisionInput,
  PaymentRow,
  PolicyRow,
  QuoteRow,
  Repository,
  ReservePolicyInput,
  SeriesRow,
  UserRow,
} from './types.js';

const { Pool } = pg;

/// The real repository.
///
/// Hand written SQL against `pg`, no ORM, for the reason the migration file
/// gives: apps/oracle writes to this database too and a schema owned by one
/// application's model classes is a schema the other has to guess at.
///
/// numeric columns come back from `pg` as strings, which is what this codebase
/// wants everywhere: an amount that becomes a JavaScript number has already
/// lost the argument.

export function createPool(connectionString: string): pg.Pool {
  return new Pool({ connectionString, max: 8 });
}

export class PostgresRepository implements Repository {
  constructor(private readonly pool: pg.Pool) {}

  async groups(): Promise<GroupRow[]> {
    const { rows } = await this.pool.query(
      'SELECT group_key, label, bls_series, picker_order FROM groups ORDER BY picker_order',
    );
    return rows.map(toGroup);
  }

  async group(groupKey: string): Promise<GroupRow | null> {
    const { rows } = await this.pool.query(
      'SELECT group_key, label, bls_series, picker_order FROM groups WHERE group_key = $1',
      [groupKey],
    );
    return rows[0] === undefined ? null : toGroup(rows[0]);
  }

  async upsertSeries(row: SeriesRow): Promise<void> {
    await this.pool.query(
      `INSERT INTO series (series_id, series_key, group_key, status, principal, coupon_rate_bps,
                           attachment_shock, level_line, exhaustion_shock, payout_mode,
                           term_months, waiting_period_days, grace_period_days,
                           claim_window_obs_days, claim_window_sep_days, lookback_months,
                           cover_pool, collateral_vault, matures_at,
                           auto_approval_limit, auto_approval_confidence)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
       ON CONFLICT (series_id) DO UPDATE
         SET status = EXCLUDED.status,
             principal = EXCLUDED.principal,
             cover_pool = EXCLUDED.cover_pool,
             collateral_vault = EXCLUDED.collateral_vault,
             matures_at = EXCLUDED.matures_at`,
      // auto_approval_limit and auto_approval_confidence are not in the DO
      // UPDATE list on purpose. The frozen terms come from the chain and are
      // re-synced at every boot; the auto-approval gate is ours and an
      // operator's change to it must survive the next sync.
      [
        row.seriesId,
        row.seriesKey,
        row.groupKey,
        row.status,
        row.principal,
        row.couponRateBps,
        row.attachmentShock,
        row.levelLine,
        row.exhaustionShock,
        row.payoutMode,
        row.termMonths,
        row.waitingPeriodDays,
        row.gracePeriodDays,
        row.claimWindowObsDays,
        row.claimWindowSepDays,
        row.lookbackMonths,
        row.coverPool,
        row.collateralVault,
        row.maturesAt,
        row.autoApprovalLimit,
        row.autoApprovalConfidence,
      ],
    );
  }

  async series(seriesId: string): Promise<SeriesRow | null> {
    const { rows } = await this.pool.query('SELECT * FROM series WHERE series_id = $1', [seriesId]);
    return rows[0] === undefined ? null : toSeries(rows[0]);
  }

  async upsertUser(row: UserRow): Promise<void> {
    await this.pool.query(
      `INSERT INTO users (nullifier, group_key, wallet, wallet_evm)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (nullifier) DO UPDATE
         SET group_key = COALESCE(EXCLUDED.group_key, users.group_key),
             wallet = COALESCE(EXCLUDED.wallet, users.wallet),
             wallet_evm = COALESCE(EXCLUDED.wallet_evm, users.wallet_evm),
             last_seen = now()`,
      [row.nullifier, row.groupKey, row.wallet, row.walletEvm],
    );
  }

  async insertCredential(row: CredentialRow): Promise<void> {
    await this.pool.query(
      `INSERT INTO eligibility_credentials
         (jti, kind, nullifier, series_id, group_key, policy_id, wallet, wallet_evm,
          presence, issuer, issued_at, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        row.jti,
        row.kind,
        row.nullifier,
        row.seriesId,
        row.groupKey,
        row.policyId,
        row.wallet,
        row.walletEvm,
        row.presence,
        row.issuer,
        row.issuedAt,
        row.expiresAt,
      ],
    );
  }

  async credential(jti: string): Promise<CredentialRow | null> {
    const { rows } = await this.pool.query(
      'SELECT * FROM eligibility_credentials WHERE jti = $1',
      [jti],
    );
    return rows[0] === undefined ? null : toCredential(rows[0]);
  }

  async insertQuote(row: QuoteRow): Promise<void> {
    await this.pool.query(
      `INSERT INTO quotes (quote_id, series_id, group_key, wallet, wallet_evm, cover_limit,
                           premium, asset, asset_decimals, annual_rate_bps, pricing_basis,
                           issued_via, created_at, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        row.quoteId,
        row.seriesId,
        row.groupKey,
        row.wallet,
        row.walletEvm,
        row.coverLimit,
        row.premium,
        row.asset,
        row.assetDecimals,
        row.annualRateBps,
        JSON.stringify(row.pricingBasis),
        row.issuedVia,
        row.createdAt,
        row.expiresAt,
      ],
    );
  }

  async quote(quoteId: string): Promise<QuoteRow | null> {
    const { rows } = await this.pool.query('SELECT * FROM quotes WHERE quote_id = $1', [quoteId]);
    return rows[0] === undefined ? null : toQuote(rows[0]);
  }

  async policy(policyId: string): Promise<PolicyRow | null> {
    const { rows } = await this.pool.query('SELECT * FROM policies WHERE policy_id = $1', [
      policyId,
    ]);
    return rows[0] === undefined ? null : toPolicy(rows[0]);
  }

  /**
   * The same predicate as `policies_one_active_per_nullifier`, read outside a
   * transaction so a screen can tell someone they already hold cover before
   * they are asked to pay for a second one.
   */
  async activePolicy(nullifier: string, seriesId: string): Promise<PolicyRow | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM policies
        WHERE nullifier = $1 AND series_id = $2 AND status = ANY($3::text[])
        ORDER BY starts_at DESC
        LIMIT 1`,
      [nullifier, seriesId, [...ACTIVE_POLICY_STATUSES]],
    );
    return rows[0] === undefined ? null : toPolicy(rows[0]);
  }

  /**
   * The bind commit. One transaction, in the order the rules have to hold:
   * the active policy check under a row lock, then the credential, then the
   * quote, then the capacity, then the writes. The partial unique index is the
   * backstop if two requests race past the SELECT.
   */
  async reservePolicy(input: ReservePolicyInput): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { policy } = input;

      // The lock is taken on the user row rather than on the policies the
      // select found, because the race this has to stop is two binds where
      // neither has written a policy yet and so neither has a row to lock.
      await client.query('SELECT nullifier FROM users WHERE nullifier = $1 FOR UPDATE', [
        policy.nullifier,
      ]);

      const active = await client.query(
        `SELECT policy_id FROM policies
          WHERE nullifier = $1 AND series_id = $2
            AND status IN ('binding','bound','active','claims_open','claimed',
                           'under_review','approved','paid','declined')`,
        [policy.nullifier, policy.seriesId],
      );
      if (active.rowCount !== null && active.rowCount > 0) throw alreadyCovered(policy.seriesId);

      if (input.credentialJti !== null) {
        const consumed = await client.query(
          `UPDATE eligibility_credentials SET consumed_at = now()
            WHERE jti = $1 AND consumed_at IS NULL`,
          [input.credentialJti],
        );
        if (consumed.rowCount === 0) {
          const present = await client.query(
            'SELECT consumed_at FROM eligibility_credentials WHERE jti = $1',
            [input.credentialJti],
          );
          throw present.rowCount === 0 ? credentialUnknown() : credentialConsumed();
        }
      }

      const quote = await client.query(
        'UPDATE quotes SET consumed_at = now(), policy_id = $2 WHERE quote_id = $1 AND consumed_at IS NULL',
        [input.quoteId, policy.policyId],
      );
      if (quote.rowCount === 0) throw quoteConsumed();

      if (
        BigInt(input.activeExposure) + BigInt(policy.coverLimit) >
        BigInt(input.principalRemaining)
      ) {
        throw insufficientCapacity();
      }

      await client.query(
        `INSERT INTO policies (policy_id, series_id, group_key, nullifier, wallet, wallet_evm,
                               cover_limit, premium, asset, asset_decimals, status, quote_id,
                               credential_jti, starts_at, ends_at, claims_payable_from,
                               paid_through, next_due)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
        [
          policy.policyId,
          policy.seriesId,
          policy.groupKey,
          policy.nullifier,
          policy.wallet,
          policy.walletEvm,
          policy.coverLimit,
          policy.premium,
          policy.asset,
          policy.assetDecimals,
          policy.status,
          policy.quoteId,
          policy.credentialJti,
          policy.startsAt,
          policy.endsAt,
          policy.claimsPayableFrom,
          policy.paidThrough,
          policy.nextDue,
        ],
      );

      const payment = input.payment;
      await client.query(
        `INSERT INTO payments (payment_id, endpoint, payer, pay_to, amount, asset, asset_decimals,
                               facilitator, facilitator_tx, chain_tx_id, status, ref, settled_at,
                               request_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          payment.paymentId,
          payment.endpoint,
          payment.payer,
          payment.payTo,
          payment.amount,
          payment.asset,
          payment.assetDecimals,
          payment.facilitator,
          payment.facilitatorTx,
          payment.chainTxId,
          payment.status,
          payment.ref,
          payment.settledAt,
          payment.requestId,
        ],
      );

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      // The partial unique index catches the race the SELECT above cannot, and
      // it means the same thing to a caller.
      if (isUniqueViolation(error, 'policies_one_active_per_nullifier')) {
        throw alreadyCovered(input.policy.seriesId);
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async updatePolicy(policyId: string, patch: Partial<PolicyRow>): Promise<void> {
    const columns: Record<string, unknown> = {};
    if (patch.status !== undefined) columns['status'] = patch.status;
    if (patch.nftTokenId !== undefined) columns['nft_token_id'] = patch.nftTokenId;
    if (patch.nftSerial !== undefined) columns['nft_serial'] = patch.nftSerial;
    if (patch.hcsTopic !== undefined) columns['hcs_topic'] = patch.hcsTopic;
    if (patch.hcsReceiptSeq !== undefined) columns['hcs_receipt_seq'] = patch.hcsReceiptSeq;
    if (patch.bindTxId !== undefined) columns['bind_tx_id'] = patch.bindTxId;
    const names = Object.keys(columns);
    if (names.length === 0) return;
    const sets = names.map((name, index) => `${name} = $${index + 2}`).join(', ');
    await this.pool.query(
      `UPDATE policies SET ${sets}, updated_at = now() WHERE policy_id = $1`,
      [policyId, ...names.map((name) => columns[name])],
    );
  }

  async insertPayment(row: PaymentRow): Promise<void> {
    await this.pool.query(
      `INSERT INTO payments (payment_id, endpoint, payer, pay_to, amount, asset, asset_decimals,
                             facilitator, facilitator_tx, chain_tx_id, status, ref, settled_at,
                             hcs_topic, hcs_seq, request_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        row.paymentId,
        row.endpoint,
        row.payer,
        row.payTo,
        row.amount,
        row.asset,
        row.assetDecimals,
        row.facilitator,
        row.facilitatorTx,
        row.chainTxId,
        row.status,
        row.ref,
        row.settledAt,
        row.hcsTopic,
        row.hcsSeq,
        row.requestId,
      ],
    );
  }

  async paymentByRef(endpoint: string, ref: string): Promise<PaymentRow | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM payments WHERE endpoint = $1 AND ref = $2
        ORDER BY created_at DESC LIMIT 1`,
      [endpoint, ref],
    );
    return rows.length === 0 ? null : toPayment(rows[0]);
  }

  async paymentByFacilitatorTx(facilitatorTx: string): Promise<PaymentRow | null> {
    const { rows } = await this.pool.query(
      'SELECT * FROM payments WHERE facilitator_tx = $1 LIMIT 1',
      [facilitatorTx],
    );
    return rows.length === 0 ? null : toPayment(rows[0]);
  }

  /**
   * The policy's own payments and the ones its quote paid for, oldest first.
   *
   * `ref` carries the policy id on the bind premium and the quote id on the
   * index read and the quote before it, so both names are asked for at once.
   * `created_at` orders them because a settled row and an uncollected one both
   * have it, and a payment that never settled still belongs on the receipt.
   */
  async paymentsForPolicy(policyId: string, quoteId: string | null): Promise<PaymentRow[]> {
    const refs = quoteId === null ? [policyId] : [policyId, quoteId];
    const { rows } = await this.pool.query(
      'SELECT * FROM payments WHERE ref = ANY($1::text[]) ORDER BY created_at ASC',
      [refs],
    );
    return rows.map(toPayment);
  }

  /** The claims on a policy, projected to the columns the audit trail shows. */
  async claimAudit(policyId: string): Promise<ClaimAuditRow[]> {
    const { rows } = await this.pool.query(
      `SELECT claim_id, status, packet_hash, decision_hash, decision, amount,
              hcs_submitted_seq, hcs_decision_seq, paid_tx,
              submitted_at, decided_at, paid_at
         FROM claims WHERE policy_id = $1 ORDER BY created_at ASC`,
      [policyId],
    );
    return rows.map(toClaimAudit);
  }

  async claim(claimId: string): Promise<ClaimRow | null> {
    const { rows } = await this.pool.query('SELECT * FROM claims WHERE claim_id = $1', [claimId]);
    return rows[0] === undefined ? null : toClaim(rows[0]);
  }

  async claimsByStatus(status: ClaimStatus, limit: number): Promise<ClaimRow[]> {
    // Oldest first, which is the order a queue is worked and the order the
    // Adjuster reads: a claim that has been waiting longest is decided first.
    const { rows } = await this.pool.query(
      `SELECT * FROM claims WHERE status = $1
        ORDER BY submitted_at ASC NULLS LAST, created_at ASC LIMIT $2`,
      [status, limit],
    );
    return rows.map(toClaim);
  }

  async priorClaimCount(
    nullifier: string,
    seriesId: string,
    exceptClaimId: string,
  ): Promise<number> {
    const { rows } = await this.pool.query(
      `SELECT count(*)::int AS n FROM claims
        WHERE nullifier = $1 AND series_id = $2 AND claim_id <> $3 AND status <> 'void'`,
      [nullifier, seriesId, exceptClaimId],
    );
    return Number(rows[0]?.['n'] ?? 0);
  }

  async claimEvidence(claimId: string): Promise<ClaimEvidenceRow[]> {
    const { rows } = await this.pool.query(
      'SELECT * FROM claim_evidence WHERE claim_id = $1 ORDER BY uploaded_at ASC',
      [claimId],
    );
    return rows.map(toEvidence);
  }

  async evidenceSeenElsewhere(claimId: string, hashes: string[]): Promise<Set<string>> {
    if (hashes.length === 0) return new Set();
    const { rows } = await this.pool.query(
      'SELECT DISTINCT sha256 FROM claim_evidence WHERE claim_id <> $1 AND sha256 = ANY($2)',
      [claimId, hashes],
    );
    return new Set(rows.map((row) => text(row, 'sha256')));
  }

  /**
   * The decision, written once.
   *
   * The WHERE clause is the lock. There is no `claimed_by` column and no lease:
   * a claim that is no longer `submitted` or `under_review` has been decided by
   * somebody, and the update simply matches nothing, so the second writer is
   * told rather than overwriting the first. The policy moves with the claim in
   * the same transaction, because a claim that says approved beside a policy
   * that says claims_open is a state nobody can act on.
   */
  async recordDecision(input: RecordDecisionInput): Promise<ClaimRow> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `UPDATE claims
            SET status = $2, decision = $3, reasons = $4, confidence = $5,
                decision_hash = $6, decision_record = $7, hcs_decision_seq = $8,
                amount = $9, decided_by = $10, reviewer = $11, decided_at = $12
          WHERE claim_id = $1 AND status IN ('submitted','under_review')
        RETURNING *`,
        [
          input.claimId,
          input.status,
          input.decision,
          input.reasons,
          input.confidence,
          input.decisionHash,
          input.decisionRecord === null ? null : JSON.stringify(input.decisionRecord),
          input.hcsDecisionSeq,
          input.amount,
          input.decidedBy,
          input.reviewer,
          input.decidedAt,
        ],
      );
      const row = rows[0];
      if (row === undefined) {
        await client.query('ROLLBACK');
        throw claimNotDecidable();
      }
      await client.query('UPDATE policies SET status = $2, updated_at = now() WHERE policy_id = $1', [
        text(row, 'policy_id'),
        POLICY_STATUS_FOR[input.status] ?? 'under_review',
      ]);
      await client.query('COMMIT');
      return toClaim(row);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async updatePayment(paymentId: string, patch: Partial<PaymentRow>): Promise<void> {
    const columns: Record<string, unknown> = {};
    if (patch.status !== undefined) columns['status'] = patch.status;
    if (patch.hcsTopic !== undefined) columns['hcs_topic'] = patch.hcsTopic;
    if (patch.hcsSeq !== undefined) columns['hcs_seq'] = patch.hcsSeq;
    if (patch.payer !== undefined) columns['payer'] = patch.payer;
    if (patch.facilitator !== undefined) columns['facilitator'] = patch.facilitator;
    if (patch.facilitatorTx !== undefined) columns['facilitator_tx'] = patch.facilitatorTx;
    if (patch.settledAt !== undefined) columns['settled_at'] = patch.settledAt;
    const names = Object.keys(columns);
    if (names.length === 0) return;
    const sets = names.map((name, index) => `${name} = $${index + 2}`).join(', ');
    await this.pool.query(`UPDATE payments SET ${sets} WHERE payment_id = $1`, [
      paymentId,
      ...names.map((name) => columns[name]),
    ]);
  }

  async observations(groupKey: string, limit: number): Promise<ObservationRow[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM observations
        WHERE group_key = $1 AND status = 'final'
        ORDER BY period DESC LIMIT $2`,
      [groupKey, limit],
    );
    return rows.map(toObservation);
  }

  async upsertObservations(rows: ObservationRow[]): Promise<number> {
    let written = 0;
    for (const row of rows) {
      const result = await this.pool.query(
        `INSERT INTO observations (group_key, series_id, period, u_g, u_all, e, ebar, odi,
                                   open, open_reason, status, model_version, source, source_hash,
                                   computed_at, hcs_topic, hcs_seq, submit_tx, replay)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
         ON CONFLICT (group_key, period, status) DO NOTHING`,
        [
          row.groupKey,
          row.seriesId,
          row.period,
          row.uG,
          row.uAll,
          row.e,
          row.ebar,
          row.odi,
          row.open,
          row.openReason,
          row.status,
          row.modelVersion,
          row.source,
          row.sourceHash,
          row.computedAt,
          row.hcsTopic,
          row.hcsSeq,
          row.submitTx,
          row.replay,
        ],
      );
      written += result.rowCount ?? 0;
    }
    return written;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

/**
 * The first published value settles forever, so an observation is inserted and
 * never updated: `ON CONFLICT DO NOTHING` above is the rule, not an
 * optimisation. A revision arrives as a second row with status `revised`.
 */
function isUniqueViolation(error: unknown, constraint: string): boolean {
  const candidate = error as { code?: string; constraint?: string };
  return candidate?.code === '23505' && candidate.constraint === constraint;
}

type Row = Record<string, unknown>;

function text(row: Row, name: string): string {
  const value = row[name];
  if (typeof value !== 'string') throw new AppError(500, 'internal_error', 'Bad row', `${name}`);
  return value;
}

function maybeText(row: Row, name: string): string | null {
  const value = row[name];
  return value === null || value === undefined ? null : String(value);
}

function maybeNumber(row: Row, name: string): number | null {
  const value = row[name];
  return value === null || value === undefined ? null : Number(value);
}

function instant(row: Row, name: string): string {
  const value = row[name];
  return value instanceof Date ? value.toISOString() : String(value);
}

function maybeInstant(row: Row, name: string): string | null {
  const value = row[name];
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

/** A `date` column, kept as the calendar date it is rather than an instant. */
function calendarDate(row: Row, name: string): string {
  const value = row[name];
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function toGroup(row: Row): GroupRow {
  return {
    groupKey: text(row, 'group_key'),
    label: text(row, 'label'),
    blsSeries: text(row, 'bls_series'),
    pickerOrder: Number(row['picker_order']),
  };
}

function toSeries(row: Row): SeriesRow {
  return {
    seriesId: text(row, 'series_id'),
    seriesKey: text(row, 'series_key'),
    groupKey: text(row, 'group_key'),
    status: text(row, 'status') as SeriesRow['status'],
    principal: text(row, 'principal'),
    couponRateBps: Number(row['coupon_rate_bps']),
    attachmentShock: Number(row['attachment_shock']),
    levelLine: Number(row['level_line']),
    exhaustionShock: maybeNumber(row, 'exhaustion_shock'),
    payoutMode: text(row, 'payout_mode') as 'full' | 'indexed',
    termMonths: Number(row['term_months']),
    waitingPeriodDays: Number(row['waiting_period_days']),
    gracePeriodDays: Number(row['grace_period_days']),
    claimWindowObsDays: Number(row['claim_window_obs_days']),
    claimWindowSepDays: Number(row['claim_window_sep_days']),
    lookbackMonths: Number(row['lookback_months']),
    autoApprovalLimit: text(row, 'auto_approval_limit'),
    autoApprovalConfidence: Number(row['auto_approval_confidence']),
    coverPool: maybeText(row, 'cover_pool'),
    collateralVault: maybeText(row, 'collateral_vault'),
    maturesAt: maybeInstant(row, 'matures_at'),
  };
}

function toCredential(row: Row): CredentialRow {
  return {
    jti: text(row, 'jti'),
    kind: text(row, 'kind') as 'eligibility' | 'claim',
    nullifier: text(row, 'nullifier'),
    seriesId: maybeText(row, 'series_id'),
    groupKey: maybeText(row, 'group_key'),
    policyId: maybeText(row, 'policy_id'),
    wallet: maybeText(row, 'wallet'),
    walletEvm: maybeText(row, 'wallet_evm'),
    presence: row['presence'] === true,
    issuer: text(row, 'issuer'),
    issuedAt: instant(row, 'issued_at'),
    expiresAt: instant(row, 'expires_at'),
    consumedAt: maybeInstant(row, 'consumed_at'),
  };
}

function toQuote(row: Row): QuoteRow {
  return {
    quoteId: text(row, 'quote_id'),
    seriesId: text(row, 'series_id'),
    groupKey: text(row, 'group_key'),
    wallet: text(row, 'wallet'),
    walletEvm: maybeText(row, 'wallet_evm'),
    coverLimit: text(row, 'cover_limit'),
    premium: text(row, 'premium'),
    asset: text(row, 'asset'),
    assetDecimals: Number(row['asset_decimals']),
    annualRateBps: Number(row['annual_rate_bps']),
    pricingBasis: (row['pricing_basis'] ?? {}) as Record<string, unknown>,
    issuedVia: text(row, 'issued_via') as QuoteRow['issuedVia'],
    createdAt: instant(row, 'created_at'),
    expiresAt: instant(row, 'expires_at'),
    consumedAt: maybeInstant(row, 'consumed_at'),
    policyId: maybeText(row, 'policy_id'),
  };
}

function toPolicy(row: Row): PolicyRow {
  return {
    policyId: text(row, 'policy_id'),
    seriesId: text(row, 'series_id'),
    groupKey: text(row, 'group_key'),
    nullifier: text(row, 'nullifier'),
    wallet: text(row, 'wallet'),
    walletEvm: text(row, 'wallet_evm'),
    coverLimit: text(row, 'cover_limit'),
    premium: text(row, 'premium'),
    asset: text(row, 'asset'),
    assetDecimals: Number(row['asset_decimals']),
    status: text(row, 'status') as PolicyRow['status'],
    quoteId: maybeText(row, 'quote_id'),
    credentialJti: maybeText(row, 'credential_jti'),
    startsAt: instant(row, 'starts_at'),
    endsAt: instant(row, 'ends_at'),
    claimsPayableFrom: calendarDate(row, 'claims_payable_from'),
    paidThrough: Number(row['paid_through']),
    nextDue: row['next_due'] === null ? null : calendarDate(row, 'next_due'),
    nftTokenId: maybeText(row, 'nft_token_id'),
    nftSerial: maybeNumber(row, 'nft_serial'),
    hcsTopic: maybeText(row, 'hcs_topic'),
    hcsReceiptSeq: maybeNumber(row, 'hcs_receipt_seq'),
    bindTxId: maybeText(row, 'bind_tx_id'),
  };
}

function toPayment(row: Row): PaymentRow {
  return {
    paymentId: text(row, 'payment_id'),
    endpoint: text(row, 'endpoint'),
    payer: text(row, 'payer'),
    payTo: text(row, 'pay_to'),
    amount: text(row, 'amount'),
    asset: text(row, 'asset'),
    assetDecimals: Number(row['asset_decimals']),
    facilitator: maybeText(row, 'facilitator'),
    facilitatorTx: maybeText(row, 'facilitator_tx'),
    chainTxId: maybeText(row, 'chain_tx_id'),
    status: text(row, 'status') as PaymentRow['status'],
    ref: maybeText(row, 'ref'),
    settledAt: maybeInstant(row, 'settled_at'),
    hcsTopic: maybeText(row, 'hcs_topic'),
    hcsSeq: maybeNumber(row, 'hcs_seq'),
    requestId: text(row, 'request_id'),
  };
}

function toClaimAudit(row: Row): ClaimAuditRow {
  return {
    claimId: text(row, 'claim_id'),
    status: text(row, 'status'),
    packetHash: maybeText(row, 'packet_hash'),
    decisionHash: maybeText(row, 'decision_hash'),
    decision: maybeText(row, 'decision') as ClaimAuditRow['decision'],
    amount: maybeText(row, 'amount'),
    hcsSubmittedSeq: maybeNumber(row, 'hcs_submitted_seq'),
    hcsDecisionSeq: maybeNumber(row, 'hcs_decision_seq'),
    paidTx: maybeText(row, 'paid_tx'),
    submittedAt: maybeInstant(row, 'submitted_at'),
    decidedAt: maybeInstant(row, 'decided_at'),
    paidAt: maybeInstant(row, 'paid_at'),
  };
}

function toObservation(row: Row): ObservationRow {
  return {
    groupKey: text(row, 'group_key'),
    seriesId: maybeText(row, 'series_id'),
    period: Number(row['period']),
    uG: maybeNumber(row, 'u_g'),
    uAll: maybeNumber(row, 'u_all'),
    e: maybeNumber(row, 'e'),
    ebar: maybeNumber(row, 'ebar'),
    odi: maybeNumber(row, 'odi'),
    open: row['open'] === true,
    openReason: maybeText(row, 'open_reason') as ObservationRow['openReason'],
    status: text(row, 'status') as ObservationRow['status'],
    modelVersion: text(row, 'model_version'),
    source: maybeText(row, 'source'),
    sourceHash: maybeText(row, 'source_hash'),
    computedAt: instant(row, 'computed_at'),
    hcsTopic: maybeText(row, 'hcs_topic'),
    hcsSeq: maybeNumber(row, 'hcs_seq'),
    submitTx: maybeText(row, 'submit_tx'),
    replay: row['replay'] === true,
  };
}

/** The claim as the review queue reads it. The sealed fields stay sealed. */
function toClaim(row: Row): ClaimRow {
  return {
    claimId: text(row, 'claim_id'),
    policyId: text(row, 'policy_id'),
    seriesId: text(row, 'series_id'),
    nullifier: text(row, 'nullifier'),
    groupKey: text(row, 'group_key'),
    status: text(row, 'status') as ClaimStatus,
    employerNameEnc: bytes(row, 'employer_name_enc'),
    claimantNameEnc: bytes(row, 'claimant_name_enc'),
    jobTitle: maybeText(row, 'job_title'),
    separationDate: calendarDate(row, 'separation_date'),
    separationType: text(row, 'separation_type'),
    attestationMethod: maybeText(row, 'attestation_method') as ClaimRow['attestationMethod'],
    attestationVerified: row['attestation_verified'] === true,
    statementAccepted: row['statement_accepted'] === true,
    verifiedAt: maybeInstant(row, 'verified_at'),
    packetHash: maybeText(row, 'packet_hash'),
    packetManifest: (row['packet_manifest'] as Record<string, unknown> | null) ?? null,
    decision: maybeText(row, 'decision') as ClaimRow['decision'],
    reasons: Array.isArray(row['reasons']) ? (row['reasons'] as string[]) : [],
    confidence: maybeText(row, 'confidence'),
    reviewer: maybeText(row, 'reviewer'),
    decidedBy: maybeText(row, 'decided_by'),
    decisionHash: maybeText(row, 'decision_hash'),
    decisionRecord: (row['decision_record'] as Record<string, unknown> | null) ?? null,
    amount: maybeText(row, 'amount'),
    qualifyingMonth: row['qualifying_month'] === null ? null : Number(row['qualifying_month']),
    claimDeadline: maybeInstant(row, 'claim_deadline'),
    hcsSubmittedSeq: row['hcs_submitted_seq'] === null ? null : Number(row['hcs_submitted_seq']),
    hcsDecisionSeq: row['hcs_decision_seq'] === null ? null : Number(row['hcs_decision_seq']),
    submittedAt: maybeInstant(row, 'submitted_at'),
    decidedAt: maybeInstant(row, 'decided_at'),
  };
}

function toEvidence(row: Row): ClaimEvidenceRow {
  return {
    evidenceId: text(row, 'evidence_id'),
    claimId: text(row, 'claim_id'),
    kind: text(row, 'kind'),
    filename: text(row, 'filename'),
    contentType: text(row, 'content_type'),
    sizeBytes: Number(row['size_bytes']),
    sha256: text(row, 'sha256'),
    objectKey: text(row, 'object_key'),
    encIv: bytes(row, 'enc_iv') ?? Buffer.alloc(0),
    encTag: bytes(row, 'enc_tag') ?? Buffer.alloc(0),
    encDek: bytes(row, 'enc_dek') ?? Buffer.alloc(0),
    encKekId: text(row, 'enc_kek_id'),
    uploadedAt: instant(row, 'uploaded_at'),
  };
}

/** A `bytea` column, which `pg` already hands back as a Buffer. */
function bytes(row: Row, name: string): Buffer | null {
  const value = row[name];
  return Buffer.isBuffer(value) ? value : null;
}

/**
 * The policy status a decided claim leaves behind.
 *
 * A claim that says approved beside a policy that still says claims_open is a
 * state nobody downstream can act on, so the two move together. `paid` is not
 * here: the payout is T13's write, after the authorisation is signed.
 */
const POLICY_STATUS_FOR: Record<string, string> = {
  approved: 'approved',
  declined: 'declined',
  under_review: 'under_review',
};
