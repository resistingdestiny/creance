import pg from 'pg';

import { AppError } from '../errors.js';
import {
  alreadyCovered,
  credentialConsumed,
  credentialUnknown,
  insufficientCapacity,
  quoteConsumed,
} from './memory.js';
import type {
  CredentialRow,
  GroupRow,
  ObservationRow,
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
                           cover_pool, collateral_vault, matures_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       ON CONFLICT (series_id) DO UPDATE
         SET status = EXCLUDED.status,
             principal = EXCLUDED.principal,
             cover_pool = EXCLUDED.cover_pool,
             collateral_vault = EXCLUDED.collateral_vault,
             matures_at = EXCLUDED.matures_at`,
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
                           issued_via, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
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

  async updatePayment(paymentId: string, patch: Partial<PaymentRow>): Promise<void> {
    const columns: Record<string, unknown> = {};
    if (patch.status !== undefined) columns['status'] = patch.status;
    if (patch.hcsTopic !== undefined) columns['hcs_topic'] = patch.hcsTopic;
    if (patch.hcsSeq !== undefined) columns['hcs_seq'] = patch.hcsSeq;
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
