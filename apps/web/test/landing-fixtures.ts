import { explorerOccupation } from '../src/lib/explorer-model.js';
import { AMOUNT_MIN } from '../src/lib/cover-amount.js';
import { occupationLabel } from '../src/lib/occupations.js';
import {
  LANDING_GROUP,
  couponEvents,
  fromPriceBuys,
  fromPriceLine,
  historyFigure,
  investorLine,
  landingIndexSection,
  noteFigures,
  payAnswer,
  publishedEvent,
  readingEvents,
  tickerReadings,
} from '../src/lib/landing-model.js';
import type { ExplorerData } from '../src/lib/explorer-data.js';
import type {
  LandingData,
  LandingExplorerView,
  LandingIndexView,
  LandingNoteView,
  LandingPriceView,
} from '../src/lib/landing-data.js';

import { EXPLORER_READINGS, explorerData } from './explorer-fixtures.js';
import { COUPONS, SERIES } from './investor-fixtures.js';
import { INDEX } from './worker-fixtures.js';

/**
 * The landing page's three states, built from the same recorded reading the
 * worker screens are tested against.
 *
 * `LIVE` is the feed answering. `STALE` is the metered reading behind the hero's
 * badge not answering while the explorer's round is still warm, which is the
 * degraded state the ticket asks for. `COLD` is nothing answering at all on a
 * process that has never had a reading, where the page has to carry the note
 * and no figure at all.
 *
 * They are composed through the same functions the server uses, so a change to
 * the wording changes the fixture rather than leaving the test asserting copy
 * the product no longer prints.
 *
 * Every figure is settled here. The server hands the page a promise per figure
 * so that none of them is awaited before the first byte (T40), and the page
 * takes either, so a test that asserts what the page prints hands it the
 * figures themselves and renders in one pass.
 */

export interface SettledLanding extends LandingData {
  readonly index: LandingIndexView;
  readonly price: LandingPriceView;
  readonly explorer: LandingExplorerView;
  readonly note: LandingNoteView;
}

const READING = { ...INDEX, group: LANDING_GROUP };

/**
 * The explorer's round, which is the one the landing page renders and the one
 * its ticker is worded from. The landing does not have a second source for
 * either: it asks the explorer's round for both.
 */
const EXPLORER = explorerData();

const OCCUPATIONS = EXPLORER_READINGS.map(explorerOccupation);
const TICKER = tickerReadings(OCCUPATIONS, LANDING_GROUP);
const EVENTS = readingEvents(OCCUPATIONS, LANDING_GROUP);

/**
 * The note as the same recorded series the investor screens are tested
 * against, so the coupon chips and the band figures are built from receipts
 * that were actually read, and a chip whose wording changes changes here.
 */
const NOTE: LandingNoteView = {
  investorLine: investorLine('8 percent a year, paid monthly'),
  events: couponEvents(COUPONS),
  figures: noteFigures(SERIES, COUPONS),
};

/** The same page with nothing read from the note at all. */
const NO_NOTE: LandingNoteView = {
  investorLine: investorLine(null),
  events: [],
  figures: [],
};

function landing(
  index: typeof READING | null,
  live: boolean,
  premium: string | null,
  explorer: ExplorerData | null = EXPLORER,
): SettledLanding {
  return {
    group: LANDING_GROUP,
    occupation: occupationLabel(LANDING_GROUP),
    index: {
      ...landingIndexSection(index, live),
      payLine: payAnswer(
        index === null ? null : index.trigger.attachment_shock,
        index === null ? null : index.series_id,
      ),
      published: publishedEvent(index),
      history: historyFigure(index?.as_of ?? null),
    },
    price: {
      priceLine: fromPriceLine(premium),
      buysLine: premium === null ? null : fromPriceBuys(AMOUNT_MIN),
    },
    explorer: {
      ticker: explorer === null ? [] : TICKER,
      round: explorer,
      replayBadge: null,
      events: explorer === null ? [] : EVENTS,
    },
    note: explorer === null ? NO_NOTE : NOTE,
  };
}

export const LIVE: SettledLanding = landing(READING, true, '4.25');

export const STALE: SettledLanding = landing(READING, false, null);

/**
 * `COLD` has no explorer round either. A process that has never had a reading
 * has nothing cached to draw the explorer from, so the page is what is left
 * when every read failed.
 */
export const COLD: SettledLanding = landing(null, false, null, null);

/** The same live page while the demo clock is walking. */
export const REPLAYING: SettledLanding = {
  ...LIVE,
  explorer: { ...LIVE.explorer, replayBadge: 'Replay: Jul 2026' },
};
