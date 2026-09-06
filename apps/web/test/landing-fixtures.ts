import { explorerOccupation } from '../src/lib/explorer-model.js';
import {
  LANDING_GROUP,
  costAnswer,
  fromPriceLine,
  investorLine,
  landingIndexSection,
  payAnswer,
  tickerReadings,
} from '../src/lib/landing-model.js';
import type { LandingData } from '../src/lib/landing-data.js';

import { EXPLORER_READINGS } from './explorer-fixtures.js';
import { INDEX } from './worker-fixtures.js';

/**
 * The landing page's three states, built from the same recorded reading the
 * worker screens are tested against.
 *
 * `LIVE` is the feed answering. `STALE` is the feed not answering with a
 * reading this process published earlier, which is the degraded state the
 * ticket asks for. `COLD` is the feed not answering on a process that has never
 * had a reading, where the section has to carry the note and no figure at all.
 *
 * They are composed through the same functions the server uses, so a change to
 * the wording changes the fixture rather than leaving the test asserting copy
 * the product no longer prints.
 */

const READING = { ...INDEX, group: LANDING_GROUP };

/**
 * The ticker, from the same fifteen recorded readings the explorer tests use,
 * through the same function the server calls. The landing does not have a
 * second source for these: it asks the explorer's round for them.
 */
const TICKER = tickerReadings(EXPLORER_READINGS.map(explorerOccupation), LANDING_GROUP);

function landing(index: typeof READING | null, live: boolean, premium: string | null): LandingData {
  return {
    group: LANDING_GROUP,
    priceLine: fromPriceLine(premium),
    costLine: costAnswer(premium),
    payLine: payAnswer(
      index === null ? null : index.trigger.attachment_shock,
      index === null ? null : index.series_id,
    ),
    investorLine: investorLine('8 percent a year, paid monthly'),
    index: landingIndexSection(LANDING_GROUP, index, live),
    ticker: TICKER,
    replayBadge: null,
  };
}

export const LIVE: LandingData = landing(READING, true, '4.25');

export const STALE: LandingData = landing(READING, false, null);

export const COLD: LandingData = landing(null, false, null);

/** The same live page while the demo clock is walking. */
export const REPLAYING: LandingData = { ...LIVE, replayBadge: 'Replay: Jul 2026' };
