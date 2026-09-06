import type { FastifyPluginAsync } from 'fastify';

import { loadAttributionSeries, type AttributionSeries } from '../attribution-data.js';

/// The attribution series, free and public.
///
///     GET /v1/attribution
///
/// What it is for: the index cannot tell why someone lost their job, and
/// DESIGN.md 3.3 says to say so out loud rather than hide it. This endpoint is
/// the evidence that sits beside the index, so a caller can read what the
/// employers themselves said about artificial intelligence and see how weakly
/// it lines up with the index that actually pays.
///
/// It is not gated. `GET /v1/index/:group` is metered and this is not, and the
/// path is outside the metered prefix so nothing has to be carved out of the
/// route map glob to keep it that way. Charging for the caveats on a paid
/// product would be the wrong way round. A test in x402-routes.test.ts holds it
/// open with the gate configured.
///
/// Two things are load bearing in the payload. Months before the first tracked
/// month are absent rather than zero, because the category did not exist, and a
/// zero inside the window is a real recorded zero. And `affects_settlement` is
/// false and says so in a sentence, because an agent reading this feed beside
/// the index feed has to be able to tell which of the two decides a payout.
///
/// It is deliberately not in the OpenAPI document. That list is the Bazantic
/// gateway import of the priced routes, and the free catalogue and the health
/// endpoint are not in it either. llms.txt names it instead.
///
/// https://fastify.dev/docs/latest/Reference/Routes/

const SETTLEMENT_STATEMENT =
  'This series does not affect settlement. Claims open on the occupation index alone, and nothing in this feed can open or close a claim.';

/// PROVENANCE.txt says these belong next to any chart drawn from the series, so
/// they travel with it here rather than being left to the caller to find.
const LIMITS = [
  {
    limit: 'self_reported',
    says: 'Employers report the reason themselves, and economists contest it.',
  },
  {
    limit: 'announcements_not_separations',
    says: 'These are announced cuts, not separations. Announced is not the same as happened.',
  },
  {
    limit: 'not_occupation_coded',
    says: 'It is national and by industry. It is not coded by occupation, so it cannot be bound to a BLS occupation group without an assumption that would need its own defence.',
  },
  {
    limit: 'warn_box_unticked',
    says: 'New York added an artificial intelligence box to its WARN filings in March 2025. Zero of the 162 or more filings since have ticked it.',
  },
  {
    limit: 'employers_have_denied_it',
    says: 'Verizon, Block and TCS each denied publicly that their headline cuts were driven by artificial intelligence.',
  },
  {
    limit: 'some_months_derived',
    says: 'Several monthly figures are derived from published year to date totals rather than from a published monthly figure, and the series carries no flag saying which.',
  },
] as const;

/// Correlations as decimal strings, for the same reason index values are: a
/// float round trip through JSON is the one way a published figure stops
/// matching the one that was measured.
const MEASURED = {
  against: 'the smoothed excess margin of the occupation index, ebar',
  computer_math_levels: '-0.44',
  computer_math_differenced: '-0.21',
  construction: 'about zero',
  farming_fishing_forestry: 'about zero',
  leads: 'Nothing at three or six month leads.',
  reading:
    'Most of the level relationship is a shared trend. It is context, not a predictor, and it is not a trigger.',
} as const;

export function attributionView(series: AttributionSeries): Record<string, unknown> {
  return {
    series: {
      id: 'challenger-ai-cuts-monthly',
      name: 'Employer attributed artificial intelligence job cuts',
      unit: 'announced job cuts',
      cadence: 'monthly',
      source: 'Challenger, Gray and Christmas',
      coverage: 'United States, national, all industries',
    },
    settlement: {
      affects_settlement: false,
      statement: SETTLEMENT_STATEMENT,
    },
    // The window, and what lies outside it. A caller that asks for a month
    // before `first_period` is asking about months the source does not track,
    // and it will not find a key for one in `months`.
    first_period: series.first.period,
    latest_period: series.latest.period,
    untracked_before: series.first.period,
    untracked_note:
      'The category did not exist before the first tracked month, so earlier months are absent rather than zero. A zero inside the window is a recorded zero.',
    cumulative: series.cumulative,
    latest: series.latest,
    peak: series.peak,
    months: series.months,
    limits: LIMITS,
    measured_against_the_index: MEASURED,
    provenance: series.provenance,
  };
}

export const attributionRoutes: FastifyPluginAsync = async (app) => {
  app.get('/v1/attribution', async (_request, reply) =>
    // A committed file that no process writes to. Unlike a reading or a price
    // there is nothing here that can be stale within an hour.
    reply
      .header('cache-control', 'public, max-age=3600')
      .send(attributionView(loadAttributionSeries())),
  );
};
