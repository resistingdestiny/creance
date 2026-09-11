/**
 * What the investor page reads, and what a visitor waits for while it does.
 *
 * Two calls behind the figures: `GET /v1/series/:id` and
 * `GET /v1/series/:id/coupons`. Both answer from chain state. The API reads
 * the vault, the note and the CoverPool through the JSON-RPC relay with
 * ethers, one `eth_call` per view and one `getCoupon` per coupon id, and the
 * relay serves those off the mirror node, so each of the two takes somewhere
 * between a third of a second and two seconds and nothing local makes it
 * faster. Until T51 both were made on every view and awaited before the first
 * byte, so /invest was the one slow page in the product.
 *
 * The reads are held, exactly as T40 held the landing page's. One call stands
 * for a window, a hundred visitors arriving together cause one read rather
 * than a hundred, and the visitor who arrives first after a window expires is
 * served the last good value while the next one is bought behind them. The
 * hold is per series id, because there are sixteen series and a hold that
 * served one series' principal under another's name would be the worst thing
 * this page could do.
 *
 * The hold lives here and not in src/lib/investor-api.ts. That client is also
 * what the landing page and the subscribe route read through, and a hold
 * hidden inside `fetchSeries` would put the landing's own hold behind a second
 * one and hide the window from every caller. T40 put the hold in the data
 * module and this does the same.
 *
 * The window comes from what the figures are. A note's principal, reserve and
 * coupon history change when a coupon is paid or a claim settles, which on
 * this deployment is days apart, and the reads are free, so the window is
 * about the seconds a visitor spends waiting and not about money. It is the
 * landing coupon's window for the landing coupon's reason.
 *
 * Nothing is awaited before the page is drawn. Each figure is handed to the
 * screen as a promise, so the heading, the series chooser, the copy and the
 * subscribe action are on the first byte and each figure lands in its own
 * place as it arrives.
 *
 * Each read is allowed to fail on its own. A series that cannot be read costs
 * the page its terms, its principal and its links, and a coupon history that
 * cannot be read costs it the table, and neither costs the page. A figure
 * that fails is removed rather than replaced: this is a page about money, and
 * a placeholder number on it is worse than a gap.
 */

import { reportUnreachable } from './api';
import { heldRead, heldReadPerKey } from './held-read';
import { fetchCoupons, fetchSeries, type CouponsView, type SeriesView } from './investor-api';
import type { Streamed } from './landing-data';

/**
 * How long a series read stands before it is bought again, and how long past
 * that the one already bought is served while the next is bought behind the
 * visitor. Ten minutes, then ten: the same window T40 gave the coupon rate on
 * the landing page, which is read from the same endpoint.
 */
export const SERIES_TTL_MS = 10 * 60 * 1000;
export const SERIES_STALE_MS = 10 * 60 * 1000;

/** The coupon history changes when a coupon settles, which is the same clock. */
export const COUPONS_TTL_MS = 10 * 60 * 1000;
export const COUPONS_STALE_MS = 10 * 60 * 1000;

export type { Streamed };

export interface InvestorData {
  /** The series on screen, or null when it could not be read. */
  readonly series: Streamed<SeriesView | null>;
  /** Its coupon history, or null when it could not be read. */
  readonly coupons: Streamed<CouponsView | null>;
}

/**
 * The page's two figures, with both calls already in flight and neither
 * awaited.
 */
export function readInvestor(id: string): InvestorData {
  return {
    series: readSeries(id),
    coupons: readCouponHistory(id),
  };
}

const seriesReads = heldReadPerKey<SeriesView>((id) =>
  heldRead({
    what: `the investor series ${id}`,
    ttlMs: SERIES_TTL_MS,
    staleMs: SERIES_STALE_MS,
    read: () => fetchSeries(id),
  }),
);

const couponReads = heldReadPerKey<CouponsView>((id) =>
  heldRead({
    what: `the investor coupon history for ${id}`,
    ttlMs: COUPONS_TTL_MS,
    staleMs: COUPONS_STALE_MS,
    read: () => fetchCoupons(id),
  }),
);

/** Tests only. Module level holds outlive a test file otherwise. */
export function forgetInvestorReads(): void {
  seriesReads.forget();
  couponReads.forget();
}

/**
 * Tests only: how many series ids each hold is keeping. The id comes from a
 * query string, so the test that matters is that a run of ids the API does
 * not serve leaves these at what they were.
 */
export function heldSeries(): number {
  return seriesReads.size();
}

export function heldCoupons(): number {
  return couponReads.size();
}

async function readSeries(id: string): Promise<SeriesView | null> {
  try {
    return await seriesReads.read(id);
  } catch (cause) {
    reportUnreachable(`the investor series ${id}`, cause);
    return null;
  }
}

async function readCouponHistory(id: string): Promise<CouponsView | null> {
  try {
    return await couponReads.read(id);
  } catch (cause) {
    reportUnreachable(`the investor coupon history for ${id}`, cause);
    return null;
  }
}
