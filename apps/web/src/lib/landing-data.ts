/**
 * What the landing page reads, and what a visitor waits for while it does.
 *
 * Four calls, all on the server, all live: the metered index reading, a quote
 * for the smallest cover on offer, the coupon the note pays, and the round of
 * fifteen readings the explorer buys. Two of them are x402 gated, which means
 * each one settles on Hedera before the handler answers, and settlement is
 * seconds. Until T40 all four were made on every request and awaited before the
 * first byte, so the front door cost about one settlement per view and three to
 * four seconds of consensus per visitor.
 *
 * Neither of those is a price worth paying, and neither has to be paid.
 *
 * The reads are held. src/lib/explorer-data.ts made the argument first for its
 * round of fifteen and src/lib/held-read.ts is now that hold, shared by both:
 * one call stands for a window, a hundred visitors arriving together cause one
 * settlement rather than a hundred, and the visitor who arrives first after a
 * window expires is served the last good value while the next one is bought
 * behind them. The paid calls still happen, still settle on chain and are still
 * demonstrable, which is what DESIGN.md 3.7 asks of them; what stops happening
 * is a person waiting behind one.
 *
 * Each window comes from what its figure is. The index publishes once a month
 * (DESIGN.md 3.3), so a reading a few minutes old is the same reading. A quote
 * is a binding price with fifteen minutes of life, so its hold expires well
 * inside that and the page never prints a price the API would no longer honour.
 * The one read that is never held is the replay badge, because the demo clock
 * moves in ten second steps and a stale badge is a lie about what is on screen.
 *
 * And nothing is awaited before the page is drawn. Every figure below is handed
 * to the page as a promise, so the hero, the card, the copy and the steps are
 * on the first byte and each figure lands in its own place as it arrives. A
 * cold hold costs the visitor a resting state rather than a blank screen and
 * three seconds of nothing.
 *
 * Every call is allowed to fail on its own. The page is the front door and it
 * has to render whatever happens, so a failure removes the figure it carried
 * and adds the note that says so, and never removes the page.
 */

import { reportUnreachable } from './api';
import { fetchReplay } from './claim-api';
import { replayBadgeLabel } from './claim-model';
import { AMOUNT_MIN } from './cover-amount';
import { readExplorer, type ExplorerData } from './explorer-data';
import { heldRead, heldReadPerKey } from './held-read';
import { fetchSeries } from './investor-api';
import { couponLine } from './investor-model';
import {
  LANDING_GROUP,
  attachmentFor,
  costAnswer,
  fromPriceLine,
  investorLine,
  landingIndexSection,
  payAnswer,
  seriesFor,
  tickerReadings,
  type TickerReading,
} from './landing-model';
import { recallReading, rememberReading } from './last-reading';
import { occupationLabel } from './occupations';
import { DEMO_ACCOUNT } from './wallet';
import {
  fetchIndex,
  fetchIndexCatalogue,
  requestQuote,
  toMinorUnits,
  type IndexCatalogueView,
  type IndexView,
} from './worker-api';
import { premiumAmount } from './worker-model';

/**
 * How long a metered reading stands before it is bought again, and how long
 * past that the reading already bought is served while the next one is bought
 * behind the visitor. It is the explorer's own window, for the explorer's own
 * reason: the index publishes once a month.
 */
export const READING_TTL_MS = 10 * 60 * 1000;
export const READING_STALE_MS = 5 * 60 * 1000;

/**
 * The life the API gives a quote, which is `QUOTE_TTL_SECONDS` and defaults to
 * nine hundred (apps/api/src/config.ts). It is not configuration here: it is
 * the fact the two windows below have to fit inside, because a held price older
 * than the quote it came from is a price nobody would honour and the page would
 * be quoting from memory.
 *
 * The windows are checked against it in a test, and the quote's own `expires_at`
 * is checked again on the way to the page, so a deployment that shortens the
 * life below these windows loses the line rather than printing a dead price.
 */
export const QUOTE_LIFE_MS = 15 * 60 * 1000;

/** So a from price is never more than ten minutes into a fifteen minute life. */
export const QUOTE_TTL_MS = 5 * 60 * 1000;
export const QUOTE_STALE_MS = 5 * 60 * 1000;

/**
 * The coupon is a rate written into the series at issuance, so it changes when
 * a series is issued and not otherwise. The read is free, and the window is
 * about the second a visitor spends waiting for it rather than about money.
 */
export const COUPON_TTL_MS = 10 * 60 * 1000;
export const COUPON_STALE_MS = 10 * 60 * 1000;

/**
 * A figure the page can be handed either way: the value, or a promise of it.
 *
 * The server hands promises, so the page is drawn and sent before any of them
 * arrives. A test hands values, and the same components render them without a
 * resting state in between, which is what makes the page's markup assertable
 * without a stream.
 */
export type Streamed<T> = T | Promise<T>;

export interface LandingIndexView {
  /** Whether the reading behind the hero badge could be had at all. */
  readonly live: boolean;
  /** "When does it pay." */
  readonly payLine: string;
  /** Null while the feed answers, the honest note when it does not. */
  readonly note: string | null;
}

export interface LandingPriceView {
  /** "From 28.00 a month", or null when no price could be quoted. */
  readonly priceLine: string | null;
  /** "What does it cost." */
  readonly costLine: string;
}

export interface LandingExplorerView {
  /** The fifteen occupations the ticker runs, or empty when none could be read. */
  readonly ticker: readonly TickerReading[];
  /** The round the explorer panel draws, or null when it could not be read. */
  readonly round: ExplorerData | null;
  /** "Replay: Jul 2026" while the demo clock is walking. */
  readonly replayBadge: string | null;
}

export interface LandingData {
  readonly group: string;
  /** "Computer and mathematical", which is what the hero card is titled. */
  readonly occupation: string;
  readonly index: Streamed<LandingIndexView>;
  readonly price: Streamed<LandingPriceView>;
  readonly explorer: Streamed<LandingExplorerView>;
  /** "Investors fund the cover and earn 8 percent a year, paid monthly." */
  readonly investorLine: Streamed<string>;
}

/**
 * The page's data, with every call already in flight and none of them awaited.
 *
 * The four reads start together, exactly as the Promise.all this replaced
 * started them, and the page is rendered around the promises rather than after
 * them. The group and the occupation label need no call at all, so they are
 * values and are on the first byte with the rest of the shell.
 */
export function readLanding(group: string = LANDING_GROUP): LandingData {
  return {
    group,
    occupation: occupationLabel(group),
    index: readIndexSection(group),
    price: readPrice(group),
    explorer: readExplorerSection(group),
    investorLine: readCoupon().then(investorLine),
  };
}

/**
 * The metered reading, held for the window above.
 *
 * A successful read is remembered as it is bought, so that a failure the hold
 * can no longer cover has something true to show. `rememberReading` is inside
 * the hold and not around it: what is remembered is what the feed actually
 * served, never the held copy of it being served again.
 */
const readings = heldReadPerKey<IndexView>((group) =>
  heldRead({
    what: `the landing index reading for ${group}`,
    ttlMs: READING_TTL_MS,
    staleMs: READING_STALE_MS,
    read: async () => {
      const index = await fetchIndex(group);
      rememberReading(index);
      return index;
    },
  }),
);

/**
 * The from price: a quote for the smallest cover on offer, held for the window
 * above.
 *
 * A quote takes no capacity, lasts fifteen minutes and needs no eligibility, so
 * pricing the landing costs the same call the Amount screen makes and the
 * figure is a binding price rather than a number in a copy deck. The hold is
 * what makes it affordable to keep it that way: the price on the front door is
 * still a real quote taken against the live index, and it is bought a few times
 * an hour rather than once per visitor.
 */
interface HeldQuote {
  readonly premium: string;
  /** The quote's own expiry, as an epoch. Nothing is printed after it. */
  readonly expiresAt: number;
}

const prices = heldReadPerKey<HeldQuote>((group) =>
  heldRead({
    what: `the landing from price for ${group}`,
    ttlMs: QUOTE_TTL_MS,
    staleMs: QUOTE_STALE_MS,
    read: async () => {
      const quote = await requestQuote({
        group,
        limit: toMinorUnits(AMOUNT_MIN),
        wallet: DEMO_ACCOUNT.accountId,
      });
      return { premium: premiumAmount(quote.premium), expiresAt: Date.parse(quote.expires_at) };
    },
  }),
);

/** The coupon the note pays, from the series the investor screens already read. */
const coupons = heldRead({
  what: 'the landing investor line',
  ttlMs: COUPON_TTL_MS,
  staleMs: COUPON_STALE_MS,
  read: async () => couponLine(await fetchSeries()),
});

/** Tests only. Module level holds outlive a test file otherwise. */
export function forgetLandingReads(): void {
  readings.forget();
  prices.forget();
  coupons.forget();
}

/**
 * The reading, live if it could be had and the last published one if it could
 * not.
 *
 * The catalogue is free and carries the frozen trigger lines but no values. It
 * is asked only when the reading could not be had, which is the one case where
 * the copy would otherwise lose the level that opens claims.
 */
async function readIndexSection(group: string): Promise<LandingIndexView> {
  let index: IndexView | null;
  let live: boolean;
  try {
    index = await readings.read(group);
    live = true;
  } catch (cause) {
    reportUnreachable('the landing index section', cause);
    index = recallReading(group);
    live = false;
  }

  const catalogue = index === null ? await readCatalogue() : null;
  return {
    payLine: payAnswer(
      attachmentFor(group, index, catalogue),
      seriesFor(group, index, catalogue),
    ),
    ...landingIndexSection(index, live),
  };
}

async function readPrice(group: string): Promise<LandingPriceView> {
  let premium: string | null;
  try {
    const quote = await prices.read(group);
    // The windows above are set so that this cannot happen, and it is checked
    // anyway: the quote itself is the only thing that knows when it dies, and a
    // line the API would no longer honour is worse than no line.
    const dead = Number.isFinite(quote.expiresAt) && quote.expiresAt <= Date.now();
    premium = dead ? null : quote.premium;
  } catch (cause) {
    reportUnreachable('the landing from price', cause);
    premium = null;
  }
  return { priceLine: fromPriceLine(premium), costLine: costAnswer(premium) };
}

async function readCoupon(): Promise<string | null> {
  try {
    return await coupons.read();
  } catch (cause) {
    reportUnreachable('the landing investor line', cause);
    return null;
  }
}

/**
 * The public explorer's round, which is the readings on the page and the ticker
 * under the hero both.
 *
 * The free catalogue carries the trigger lines but no values, so the only
 * public route with readings on it is the metered one, and fifteen of those is
 * exactly the round the explorer buys. This asks for that round rather than
 * buying a sixteenth of its own: src/lib/explorer-data.ts holds it for ten
 * minutes behind one in-flight promise, so the landing pays nothing extra
 * whenever it is warm. It is read here on the server, never from the browser,
 * and it is never a fixture.
 *
 * The replay badge comes back with the round because the round's own read takes
 * it live on every request, held round or not. Only a page that has no round at
 * all has to ask for it separately, and it still asks, because the badge is
 * about what is on screen rather than about the index.
 *
 * A round that cannot be had costs the page its explorer and its ticker and
 * nothing else.
 */
async function readExplorerSection(group: string): Promise<LandingExplorerView> {
  let explorer: ExplorerData | null;
  try {
    explorer = await readExplorer();
  } catch (cause) {
    reportUnreachable('the landing index explorer', cause);
    explorer = null;
  }
  return {
    ticker: explorer === null ? [] : tickerReadings(explorer.occupations, group),
    round: explorer,
    replayBadge: explorer?.replayBadge ?? replayBadgeLabel(await fetchReplay()),
  };
}

async function readCatalogue(): Promise<IndexCatalogueView | null> {
  try {
    return await fetchIndexCatalogue();
  } catch (cause) {
    reportUnreachable('the landing trigger line', cause);
    return null;
  }
}
