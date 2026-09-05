/**
 * The investor endpoints, as the web app sees them.
 *
 * The two reads live in `apps/api/src/investor`: `GET /v1/series/:id` and
 * `GET /v1/series/:id/coupons`. Both are read only and both answer from Hedera
 * testnet, so the screens below them show chain state and nothing else.
 *
 * The fetch happens on the server, in the route's own render, not in the
 * browser. That is why there is no CORS plugin on the API and no rewrite in
 * next.config.ts: the origin never reaches the bundle, so it is a private
 * variable and not a NEXT_PUBLIC one. See docs/DECISIONS.md.
 *
 * Every amount that crosses the wire is the money envelope: an integer string
 * in the settlement asset's minor units with the asset and its scale beside it.
 * `display` is never parsed; a screen formats `amount` through
 * src/lib/format.ts, which is the one place in this app that turns a figure
 * into a string.
 */

import { apiBaseUrl, type Money } from './api';

export type { Money };

export interface HolderView {
  readonly role: string;
  readonly account_id: string;
  readonly address: string;
  readonly note_balance: string;
  readonly note_frozen: string;
  readonly note_position: string;
  readonly note_units: string;
  readonly subscription: Money;
  readonly kyc: { readonly status: number | null; readonly granted: boolean };
  readonly hashscan: string;
}

export interface CoverPoolView {
  readonly address: string;
  readonly contract_id: string | null;
  readonly registered: boolean;
  readonly active_exposure: Money;
  readonly exposure_covered: Money;
  readonly capacity_used_percent: number;
  readonly term_seconds: number | null;
  readonly term_months: number | null;
  readonly hashscan: string;
}

export interface SeriesView {
  readonly series_id: string;
  readonly series_key: string;
  readonly group: string;
  readonly network: string;
  readonly settlement_asset: {
    readonly token_id: string;
    readonly address: string;
    readonly decimals: number;
    readonly symbol: string;
  };
  readonly vault: {
    readonly address: string;
    readonly contract_id: string | null;
    readonly matures_at: string;
    readonly principal_funded: Money;
    readonly principal_paid: Money;
    readonly principal_reserved: Money;
    readonly principal_redeemed: Money;
    readonly principal_remaining: Money;
    readonly principal_free: Money;
    readonly premium_balance: Money;
    readonly hashscan: string;
  };
  readonly note: {
    readonly contract_id: string | null;
    readonly address: string;
    readonly name: string;
    readonly symbol: string;
    readonly decimals: number;
    readonly total_supply: string;
    readonly units: string;
    readonly matures_at: string;
    readonly paused: boolean;
    readonly hashscan: string;
  } | null;
  readonly holders: readonly HolderView[];
  readonly cover_pool: CoverPoolView | null;
  readonly coupons: {
    readonly count: number;
    readonly settled: number;
    readonly latest_coupon_id: string | null;
    readonly rate_percent: string | null;
  };
  readonly links: {
    readonly coupons: string;
    readonly payments_topic: string | null;
  };
}

export interface CouponHolderView {
  readonly role: string;
  readonly account_id: string;
  readonly address: string;
  readonly amount: Money;
  readonly settlement: {
    readonly schedule_id: string | null;
    readonly transaction_id: string | null;
    readonly result: string | null;
    readonly settled: boolean;
    readonly paid_at: string | null;
    readonly topic_sequence_number: string | null;
    readonly hashscan: {
      readonly schedule: string | null;
      readonly transaction: string | null;
    };
  };
}

export interface CouponView {
  readonly coupon_id: string;
  readonly coupon_ref: string;
  readonly rate_percent: string;
  readonly accrual_start: string;
  readonly accrual_end: string;
  readonly record_date: string;
  readonly execution_date: string;
  readonly total: Money;
  readonly holders: readonly CouponHolderView[];
}

export interface CouponsView {
  readonly series_id: string;
  readonly series_key: string;
  readonly payments_topic: string | null;
  readonly coupons: readonly CouponView[];
}

/** The demo series. Every investor screen shows this one unless asked otherwise. */
export const DEFAULT_SERIES_ID = 'ODI-COMP-2026-01';

/** The API is unreachable or answered with a problem document. */
export class InvestorApiError extends Error {
  constructor(
    readonly url: string,
    readonly status: number | null,
    message: string,
  ) {
    super(message);
    this.name = 'InvestorApiError';
  }
}

async function read<T>(path: string): Promise<T> {
  const url = `${apiBaseUrl()}${path}`;
  let response: Response;
  try {
    // No cache. The principal, the reserve and the coupons are live chain
    // state, and a page that shows yesterday's reserve is worse than a page
    // that says it cannot reach the API.
    response = await fetch(url, { cache: 'no-store', headers: { accept: 'application/json' } });
  } catch (cause) {
    throw new InvestorApiError(url, null, cause instanceof Error ? cause.message : 'no response');
  }
  if (!response.ok) {
    throw new InvestorApiError(url, response.status, `the API answered ${response.status}`);
  }
  return (await response.json()) as T;
}

export function fetchSeries(id: string = DEFAULT_SERIES_ID): Promise<SeriesView> {
  return read<SeriesView>(`/v1/series/${encodeURIComponent(id)}`);
}

export function fetchCoupons(id: string = DEFAULT_SERIES_ID): Promise<CouponsView> {
  return read<CouponsView>(`/v1/series/${encodeURIComponent(id)}/coupons`);
}
