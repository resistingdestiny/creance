/**
 * The investor endpoints, as the web app sees them.
 *
 * The two reads live in `apps/api/src/investor`: `GET /v1/series/:id` and
 * `GET /v1/series/:id/coupons`. Both are read only and both answer from Hedera
 * testnet, so the screens below them show chain state and nothing else. Both
 * take up to two seconds, because the API reads the vault, the note and the
 * CoverPool through the JSON-RPC relay, which serves off the mirror node.
 * This module makes the calls and does not hold them; the investor page holds
 * them in src/lib/investor-data.ts and the landing page in
 * src/lib/landing-data.ts, each for a window chosen where it can be seen.
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

// The money envelope and the origin now live in ./api, which every screen's
// client is built on. They are re-exported here because these two names are
// what the investor and receipt screens already read.
export { apiBaseUrl };
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

/** What kind of thing a series entry is. See apps/api/src/investor/config.ts. */
export type SeriesKind = 'occupation' | 'maturity_demonstration';

/**
 * The next coupon the note owes, declared and not yet settled.
 *
 * The API reads it from the note's own coupon schedule, so the date on the
 * screen is the corporate action's and not one the web app worked out from the
 * maturity and the rate.
 */
export interface NextCouponView {
  readonly coupon_id: string;
  readonly rate_percent: string;
  readonly record_date: string;
  readonly execution_date: string;
  readonly accrual_start: string;
  readonly accrual_end: string;
}

export interface SeriesView {
  readonly series_id: string;
  readonly series_key: string;
  readonly group: string;
  readonly kind: SeriesKind;
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
    // Null where the note owes no further coupon, and also where its schedule
    // could not be read: an unknown next payment is not no next payment.
    readonly next: NextCouponView | null;
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

/** One row of GET /v1/series, which is what a screen offers a choice from. */
export interface SeriesListEntry {
  readonly series_id: string;
  readonly series_key: string;
  readonly group: string;
  readonly kind: SeriesKind;
  readonly matures_at: string;
  readonly has_note: boolean;
  readonly links: { readonly self: string; readonly coupons: string };
}

export interface SeriesListView {
  readonly network: string;
  readonly count: number;
  readonly series: readonly SeriesListEntry[];
}

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
    // Not the framework's cache. The principal, the reserve and the coupons
    // are chain state and they are held, but the hold is
    // src/lib/investor-data.ts's, with windows every caller can see. A fetch
    // cache here would be a second hold behind that one, with a window nobody
    // chose, and it would sit under the landing page's own hold as well.
    response = await fetch(url, { cache: 'no-store', headers: { accept: 'application/json' } });
  } catch (cause) {
    throw new InvestorApiError(url, null, cause instanceof Error ? cause.message : 'no response');
  }
  if (!response.ok) {
    throw new InvestorApiError(url, response.status, `the API answered ${response.status}`);
  }
  return (await response.json()) as T;
}

export function fetchSeries(id: string): Promise<SeriesView> {
  return read<SeriesView>(`/v1/series/${encodeURIComponent(id)}`);
}

export function fetchCoupons(id: string): Promise<CouponsView> {
  return read<CouponsView>(`/v1/series/${encodeURIComponent(id)}/coupons`);
}

/**
 * Every series the deployment serves, in the order they were issued.
 *
 * This is what replaced the constant the screens used to carry. The list is
 * the API's, so a series that is registered on chain and not in this bundle is
 * still offered, and a screen never names a series the API does not have.
 */
export function fetchSeriesList(): Promise<SeriesListView> {
  return read<SeriesListView>('/v1/series');
}

// ---------------------------------------------------------- the market

/**
 * The secondary market, as the web app sees it.
 *
 * The routes live in `apps/api/src/market`. Reading the book is free and so is
 * reading a position; making and taking an offer are writes, and the API signs
 * them with the demo account named in the body, which is the same posture the
 * purchase flow uses. Nothing here holds a key.
 *
 * Every amount is the money envelope, and note units are integers in the note's
 * own six decimals. `units_whole` is the same figure rounded down to whole
 * units, which is what a screen shows; `units` is what a call takes.
 */
export type OfferStatus = 'open' | 'filled' | 'cancelled' | 'unknown';

export interface MarketParty {
  readonly role: string | null;
  readonly account_id: string | null;
  readonly address: string;
  readonly hashscan: string;
}

export interface OfferView {
  readonly offer_id: string;
  readonly status: OfferStatus;
  readonly series_id: string | null;
  readonly series_key: string | null;
  readonly group: string | null;
  readonly note: {
    readonly address: string;
    readonly contract_id: string | null;
    readonly symbol: string | null;
    readonly decimals: number;
    readonly hashscan: string;
  };
  readonly seller: MarketParty;
  /** Null while the offer is open. */
  readonly buyer: MarketParty | null;
  readonly units: string;
  readonly units_whole: string;
  readonly price: Money;
  readonly price_per_unit: Money;
  readonly opened_at: string;
  readonly closed_at: string | null;
  /**
   * What stands between an open offer and a fill, read off the chain. Null on a
   * closed offer. None of it is a compliance verdict: that is the note's, and
   * it is `buyer_eligibility`.
   */
  readonly readiness: {
    readonly open: boolean;
    readonly seller_holds: boolean;
    readonly seller_approved: boolean;
  } | null;
  /**
   * Whether the account named in the request may hold this note at all. Present
   * only when the request named a buyer. A screen greys its take button on
   * this; the note is what actually refuses.
   */
  readonly buyer_eligibility: {
    readonly address: string;
    readonly role: string | null;
    readonly kyc_granted: boolean;
    readonly reason: string | null;
  } | null;
  readonly hashscan: string;
}

/** An offer with the transactions the call that changed it sent. */
export interface OfferResultView extends OfferView {
  readonly transactions: {
    readonly approve?: string | null;
    readonly offer?: string;
    readonly fill?: string;
    readonly cancel?: string;
  };
  readonly gas_used?: number;
}

export interface OrderBookView {
  readonly network: string;
  readonly market: {
    readonly address: string;
    readonly contract_id: string | null;
    readonly hashscan: string;
  } | null;
  readonly settlement_asset: {
    readonly token_id: string;
    readonly address: string;
    readonly decimals: number;
    readonly symbol: string;
  };
  readonly offers: readonly OfferView[];
  readonly counts: {
    readonly total: number;
    readonly open: number;
    readonly filled: number;
    readonly cancelled: number;
  };
}

export interface MarketPositionView {
  readonly series_id: string;
  readonly series_key: string;
  readonly group: string;
  readonly note: {
    readonly address: string;
    readonly contract_id: string | null;
    readonly symbol: string | null;
    readonly decimals: number;
    readonly hashscan: string;
  };
  readonly units: string;
  readonly units_frozen: string;
  readonly units_position: string;
  readonly units_whole: string;
  readonly kyc: { readonly status: number; readonly granted: boolean };
}

export interface PositionsView {
  readonly network: string;
  readonly holder: MarketParty;
  readonly settlement_balance: Money;
  readonly positions: readonly MarketPositionView[];
  readonly offers: readonly OfferView[];
}

/**
 * A write the API refused, with the problem document it answered.
 *
 * `code` is the thing to switch on. The one worth a screen of its own is
 * `fill_refused`, which means the note itself would not accept the buyer as a
 * holder, and `detail` says why in a sentence.
 */
export class MarketApiError extends Error {
  constructor(
    readonly url: string,
    readonly status: number | null,
    readonly code: string | null,
    message: string,
  ) {
    super(message);
    this.name = 'MarketApiError';
  }
}

async function write<T>(path: string, body: unknown): Promise<T> {
  const url = `${apiBaseUrl()}${path}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      cache: 'no-store',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (cause) {
    throw new MarketApiError(url, null, null, cause instanceof Error ? cause.message : 'no response');
  }
  const answer = (await response.json().catch(() => null)) as
    | { code?: string; detail?: string }
    | null;
  if (!response.ok) {
    throw new MarketApiError(
      url,
      response.status,
      answer?.code ?? null,
      answer?.detail ?? `the API answered ${response.status}`,
    );
  }
  return answer as T;
}

/**
 * The order book.
 *
 * Every offer ever made, newest first, filled ones included: a filled offer is
 * the only record of what a unit of a note last changed hands for. Pass
 * `status: 'open'` for what can be taken now. Pass `buyer` to have each offer
 * carry `buyer_eligibility` for that account, which is what a take button is
 * enabled on.
 */
export function fetchOrderBook(
  options: { status?: OfferStatus | 'all'; series?: string; holder?: string; buyer?: string } = {},
): Promise<OrderBookView> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(options)) {
    if (value !== undefined && value !== '') query.set(key, value);
  }
  const suffix = query.size === 0 ? '' : `?${query.toString()}`;
  return read<OrderBookView>(`/v1/market/offers${suffix}`);
}

/** One offer. `buyer` adds that account's eligibility for the note. */
export function fetchOffer(offerId: string, buyer?: string): Promise<OfferView> {
  const suffix = buyer === undefined ? '' : `?buyer=${encodeURIComponent(buyer)}`;
  return read<OfferView>(`/v1/market/offers/${encodeURIComponent(offerId)}${suffix}`);
}

/**
 * What an account holds and what it is a party to.
 *
 * `holder` is a demo role, an account id or an EVM address. Only series the
 * account holds a unit of are returned, because a note with a zero balance is
 * not a position.
 */
export function fetchPositions(holder: string): Promise<PositionsView> {
  return read<PositionsView>(`/v1/market/positions/${encodeURIComponent(holder)}`);
}

/**
 * Offer a lot of note units at a price.
 *
 * `units` and `price` are integers in minor units, six decimals both. The API
 * raises the seller's allowance on the note first where it has to, so the
 * result can carry two transactions.
 */
export function makeOffer(request: {
  seller: string;
  series: string;
  units: string;
  price: string;
}): Promise<OfferResultView> {
  return write<OfferResultView>('/v1/market/offers', request);
}

/**
 * Take an offer whole.
 *
 * Throws `MarketApiError` with code `fill_refused` when the note will not
 * accept the buyer as a holder, and nothing is signed in that case.
 */
export function fillOffer(offerId: string, buyer: string): Promise<OfferResultView> {
  return write<OfferResultView>(`/v1/market/offers/${encodeURIComponent(offerId)}/fill`, { buyer });
}

/** Withdraw an offer. Only the account that made it can. */
export function cancelOffer(offerId: string, seller: string): Promise<OfferResultView> {
  return write<OfferResultView>(`/v1/market/offers/${encodeURIComponent(offerId)}/cancel`, {
    seller,
  });
}
