import { money, type Money } from '@creance/client';

import type { PolicyRow, QuoteRow } from './db/types.js';

/// The JSON the four endpoints return.
///
/// Built here rather than in the handlers, for one reason: what is not in a
/// view cannot leak out of a handler. `GET /v1/policy/:id` is free, so a
/// stranger who guesses an id must not learn the nullifier, the holder's EVM
/// address or anything about a claim beyond its status.
///
/// Conventions, following docs/DECISIONS.md "The investor endpoints stand
/// alone": snake_case fields, every amount as `{amount, asset, decimals,
/// display}` with `display` never parsed, and RFC 3339 UTC timestamps.

/** Index values are decimal strings, never JSON numbers. */
export function points(value: number | null, places = 2): string | null {
  return value === null ? null : value.toFixed(places);
}

export function rfc3339(value: Date | string): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return `${date.toISOString().slice(0, 19)}Z`;
}

export function calendarDate(value: Date | string): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return date.toISOString().slice(0, 10);
}

export interface QuoteView {
  quote_id: string;
  series_id: string;
  group: string;
  wallet: string;
  limit: Money;
  premium: Money;
  annual_rate_bps: number;
  pricing_basis: Record<string, unknown>;
  term_months: number;
  waiting_period_days: number;
  cover_starts: string;
  cover_ends: string;
  claims_payable_from: string;
  first_payment_due: string;
  pays_from: string;
  attachment_shock: string;
  level_line: string;
  payout_mode: string;
  capacity: { free_before: string; free_after: string; used_pct: number };
  expires_at: string;
  issued_via: string;
}

export interface QuoteViewInput {
  quote: QuoteRow;
  termMonths: number;
  waitingPeriodDays: number;
  coverStarts: Date;
  coverEnds: Date;
  claimsPayableFrom: Date;
  attachmentShock: number;
  levelLine: number;
  payoutMode: string;
  freeBefore: bigint;
  principalRemaining: bigint;
  activeExposure: bigint;
}

export function buildQuoteView(input: QuoteViewInput): QuoteView {
  const { quote } = input;
  const freeAfter = input.freeBefore - BigInt(quote.coverLimit);
  return {
    quote_id: quote.quoteId,
    series_id: quote.seriesId,
    group: quote.groupKey,
    wallet: quote.wallet,
    limit: money(quote.coverLimit, quote.asset, quote.assetDecimals),
    premium: money(quote.premium, quote.asset, quote.assetDecimals),
    annual_rate_bps: quote.annualRateBps,
    pricing_basis: quote.pricingBasis,
    term_months: input.termMonths,
    waiting_period_days: input.waitingPeriodDays,
    cover_starts: calendarDate(input.coverStarts),
    cover_ends: calendarDate(input.coverEnds),
    claims_payable_from: calendarDate(input.claimsPayableFrom),
    first_payment_due: calendarDate(input.coverStarts),
    pays_from: quote.wallet,
    attachment_shock: input.attachmentShock.toFixed(2),
    level_line: input.levelLine.toFixed(2),
    payout_mode: input.payoutMode,
    capacity: {
      free_before: input.freeBefore.toString(),
      free_after: (freeAfter < 0n ? 0n : freeAfter).toString(),
      used_pct: usedPercent(input.activeExposure, input.principalRemaining),
    },
    expires_at: rfc3339(quote.expiresAt),
    issued_via: quote.issuedVia,
  };
}

/** An integer, computed once here so that two screens cannot round differently. */
export function usedPercent(activeExposure: bigint, principalRemaining: bigint): number {
  if (principalRemaining <= 0n) return 0;
  return Number((activeExposure * 100n) / principalRemaining);
}

export interface PolicyView {
  policy_id: string;
  series_id: string;
  group: string;
  status: string;
  limit: Money;
  premium: Money;
  cover_starts: string;
  cover_ends: string;
  claims_payable_from: string;
  next_payment_due: string | null;
  paid_through: string;
  holder_account: string;
  nft: { token_id: string | null; serial: number | null };
  hcs_receipt: { topic_id: string | null; sequence_number: number | null };
  chain: { cover_pool: string; bind_transaction: string | null; hashscan: string | null };
  premium_schedule: { status: string; href: string };
}

/**
 * Never in this view: the nullifier, the holder's EVM address, or anything
 * about a claim beyond its status. The endpoint is free, so the response is
 * what a stranger who guessed the id is allowed to know.
 */
export function buildPolicyView(policy: PolicyRow, coverPoolAddress: string): PolicyView {
  return {
    policy_id: policy.policyId,
    series_id: policy.seriesId,
    group: policy.groupKey,
    status: policy.status,
    limit: money(policy.coverLimit, policy.asset, policy.assetDecimals),
    premium: money(policy.premium, policy.asset, policy.assetDecimals),
    cover_starts: calendarDate(policy.startsAt),
    cover_ends: calendarDate(policy.endsAt),
    claims_payable_from: policy.claimsPayableFrom,
    next_payment_due: policy.nextDue,
    paid_through: periodLabel(policy.paidThrough),
    holder_account: policy.wallet,
    nft: { token_id: policy.nftTokenId, serial: policy.nftSerial },
    hcs_receipt: { topic_id: policy.hcsTopic, sequence_number: policy.hcsReceiptSeq },
    chain: {
      cover_pool: coverPoolAddress,
      bind_transaction: policy.bindTxId,
      hashscan:
        policy.bindTxId === null
          ? null
          : `https://hashscan.io/testnet/transaction/${policy.bindTxId}`,
    },
    premium_schedule: {
      status: 'not_created',
      href: `/v1/policy/${policy.policyId}/premium-schedule`,
    },
  };
}

/** `202609` reads as `2026-09` on the wire, matching every other period. */
export function periodLabel(period: number): string {
  const month = period % 100;
  return `${(period - month) / 100}-${String(month).padStart(2, '0')}`;
}
