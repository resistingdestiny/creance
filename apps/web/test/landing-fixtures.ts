import { explorerOccupation } from '../src/lib/explorer-model.js';
import { occupationLabel } from '../src/lib/occupations.js';
import {
  LANDING_GROUP,
  costAnswer,
  fromPriceLine,
  investorLine,
  landingIndexSection,
  payAnswer,
  tickerReadings,
} from '../src/lib/landing-model.js';
import type { ExplorerData } from '../src/lib/explorer-data.js';
import type {
  LandingData,
  LandingExplorerView,
  LandingIndexView,
  LandingPriceView,
} from '../src/lib/landing-data.js';

import { EXPLORER_READINGS, explorerData } from './explorer-fixtures.js';
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
  readonly investorLine: string;
}

const READING = { ...INDEX, group: LANDING_GROUP };

/**
 * The explorer's round, which is the one the landing page renders and the one
 * its ticker is worded from. The landing does not have a second source for
 * either: it asks the explorer's round for both.
 */
const EXPLORER = explorerData();

const TICKER = tickerReadings(EXPLORER_READINGS.map(explorerOccupation), LANDING_GROUP);

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
    },
    price: { priceLine: fromPriceLine(premium), costLine: costAnswer(premium) },
    explorer: {
      ticker: explorer === null ? [] : TICKER,
      round: explorer,
      replayBadge: null,
    },
    investorLine: investorLine('8 percent a year, paid monthly'),
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
