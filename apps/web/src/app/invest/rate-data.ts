/**
 * The guide rate history for one occupation, for the series page.
 *
 * It buys nothing. The readings come from the same round the public index
 * explorer and the market board already hold (src/lib/explorer-data.ts), which
 * is held for ten minutes across every page that wants it, so a series page
 * opened after the board pays for no reading at all and a cold one pays for
 * the round everything else is about to want anyway. A second round bought per
 * series would have been sixteen rounds for one screen.
 *
 * The round failing costs this page its chart and nothing else, so it is
 * caught here rather than taken up to the route: a series page with no rate
 * history is still a series page.
 */

import { readExplorerIndex } from '../../lib/explorer-data';
import { explorerOccupation } from '../../lib/explorer-model';
import { rateHistory, type RatePoint } from '../../lib/investor-model';

export async function readRateHistory(group: string): Promise<readonly RatePoint[] | null> {
  try {
    const round = await readExplorerIndex();
    const reading = round.readings.find((entry) => entry.group === group);
    if (reading === undefined) return null;
    return rateHistory(explorerOccupation(reading).months);
  } catch {
    return null;
  }
}
