/**
 * What the landing page reads before it renders.
 *
 * Three calls, all on the server, all live: the metered index reading, a quote
 * for the smallest cover on offer, and the demo clock. None of them is cached,
 * because a front door that shows yesterday's premium is worse than one that
 * shows no premium (src/lib/api.ts says the same for every other screen).
 *
 * Every call is allowed to fail on its own. The page is the front door and it
 * has to render whatever happens, so a failure removes the figure it carried
 * and adds the note that says so, and never removes the page.
 */

import { reportUnreachable } from './api';
import { fetchReplay } from './claim-api';
import { replayBadgeLabel } from './claim-model';
import { AMOUNT_MIN } from './cover-amount';
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
  type LandingIndexSection,
} from './landing-model';
import { recallReading, rememberReading } from './last-reading';
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

export interface LandingData {
  readonly group: string;
  /** "From 28.00 a month", or null when no price could be quoted. */
  readonly priceLine: string | null;
  /** "What does it cost." */
  readonly costLine: string;
  /** "When does it pay." */
  readonly payLine: string;
  /** "Investors fund the cover and earn 8 percent a year, paid monthly." */
  readonly investorLine: string;
  readonly index: LandingIndexSection;
  /** "Replay: Jul 2026" while the demo clock is walking. */
  readonly replayBadge: string | null;
}

export async function readLanding(group: string = LANDING_GROUP): Promise<LandingData> {
  const [reading, premium, coupon, replay] = await Promise.all([
    readIndex(group),
    readPrice(group),
    readCoupon(),
    fetchReplay(),
  ]);

  // The catalogue is free and carries the frozen trigger lines but no values.
  // It is asked only when the reading could not be had, which is the one case
  // where the copy would otherwise lose the level that opens claims.
  const catalogue = reading.index === null ? await readCatalogue() : null;

  return {
    group,
    priceLine: fromPriceLine(premium),
    costLine: costAnswer(premium),
    payLine: payAnswer(
      attachmentFor(group, reading.index, catalogue),
      seriesFor(group, reading.index, catalogue),
    ),
    investorLine: investorLine(coupon),
    index: landingIndexSection(group, reading.index, reading.live),
    replayBadge: replayBadgeLabel(replay),
  };
}

/**
 * The reading, live if the feed answers and the last published one if it does
 * not. A successful read is remembered so that the next failure has something
 * true to show.
 */
async function readIndex(group: string): Promise<{ index: IndexView | null; live: boolean }> {
  try {
    const index = await fetchIndex(group);
    rememberReading(index);
    return { index, live: true };
  } catch (cause) {
    reportUnreachable('the landing index section', cause);
    return { index: recallReading(group), live: false };
  }
}

/**
 * The from price: a quote for the smallest cover on offer.
 *
 * A quote takes no capacity, lasts fifteen minutes and needs no eligibility,
 * so pricing the landing costs the same call the Amount screen makes and the
 * figure is a binding price rather than a number in a copy deck.
 */
async function readPrice(group: string): Promise<string | null> {
  try {
    const quote = await requestQuote({
      group,
      limit: toMinorUnits(AMOUNT_MIN),
      wallet: DEMO_ACCOUNT.accountId,
    });
    return premiumAmount(quote.premium);
  } catch (cause) {
    reportUnreachable('the landing from price', cause);
    return null;
  }
}

/** The coupon the note pays, from the series the investor screens already read. */
async function readCoupon(): Promise<string | null> {
  try {
    return couponLine(await fetchSeries());
  } catch (cause) {
    reportUnreachable('the landing investor line', cause);
    return null;
  }
}

async function readCatalogue(): Promise<IndexCatalogueView | null> {
  try {
    return await fetchIndexCatalogue();
  } catch (cause) {
    reportUnreachable('the landing trigger line', cause);
    return null;
  }
}
