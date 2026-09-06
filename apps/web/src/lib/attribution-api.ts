/**
 * The attribution feed, as the web app sees it.
 *
 *   GET /v1/attribution   free, the announced AI job cuts month by month
 *
 * It is the one call in this app that is not metered and is not behind a
 * purchase. It is also the one call whose failure must not take a screen down:
 * the index tab is about the index, and the panel beside it falls back to the
 * committed snapshot rather than disappearing. See src/lib/attribution-model.ts.
 *
 * Only the numbers and the window are read from the response. The sentences the
 * panel prints are held in the model module, so a failed read never costs the
 * reader a caveat.
 */

import { getJson } from './api';

export interface AttributionMonthView {
  readonly period: string;
  readonly cuts: number;
}

export interface AttributionView {
  readonly first_period: string;
  readonly latest_period: string;
  readonly untracked_before: string;
  readonly cumulative: number;
  readonly latest: AttributionMonthView;
  readonly peak: AttributionMonthView;
  readonly months: readonly AttributionMonthView[];
}

export function fetchAttribution(): Promise<AttributionView> {
  return getJson<AttributionView>('/v1/attribution');
}
