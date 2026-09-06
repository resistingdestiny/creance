import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import { loadAttributionSeries, readAttributionSeries } from '../src/attribution-data.js';
import { attributionRoutes } from '../src/routes/attribution.js';

/// GET /v1/attribution, the free feed of the series that sits beside the index.
///
/// The point of most of this file is one property: a month the source does not
/// track is absent, never a zero. The category began in May 2023, so a payload
/// carrying "2023-04": 0 would be a fabricated month presented as evidence, and
/// it is the single easiest mistake to make when a chart wants a rectangular
/// series. A zero inside the window is a different thing and is real.
///
/// It reads the committed data/attribution rather than a fixture, because the
/// committed file is what the endpoint serves and a fixture would let the two
/// drift.
///
/// That it stays free with the x402 gate configured is held in
/// x402-routes.test.ts, beside the rule it could break.

async function get() {
  const app = Fastify();
  await app.register(attributionRoutes);
  const response = await app.inject({ method: 'GET', url: '/v1/attribution' });
  await app.close();
  return response;
}

interface Month {
  period: string;
  cuts: number;
}

interface Body {
  first_period: string;
  latest_period: string;
  untracked_before: string;
  cumulative: number;
  latest: Month;
  peak: Month;
  months: Month[];
  limits: { limit: string; says: string }[];
  measured_against_the_index: Record<string, string>;
  settlement: { affects_settlement: boolean; statement: string };
  provenance: string;
}

describe('the committed series', () => {
  it('is forty months from May 2023 to August 2026 summing to 188,000', () => {
    const series = loadAttributionSeries();
    expect(series.months).toHaveLength(40);
    expect(series.first.period).toBe('2023-05');
    expect(series.latest).toEqual({ period: '2026-08', cuts: 3462 });
    expect(series.cumulative).toBe(188000);
    expect(series.peak).toEqual({ period: '2026-05', cuts: 38579 });
  });

  it('refuses a hole in the middle rather than filling it', () => {
    expect(() =>
      readAttributionSeries({ '2023-05': 1, '2023-07': 2 }, 'p'),
    ).toThrow('skips 2023-06');
  });

  it('refuses a count that is not a whole number of cuts', () => {
    expect(() => readAttributionSeries({ '2023-05': 1.5 }, 'p')).toThrow('not a whole count');
  });
});

describe('GET /v1/attribution', () => {
  it('answers 200 with the whole series', async () => {
    const response = await get();
    expect(response.statusCode).toBe(200);
    const body = response.json() as Body;
    expect(body.months).toHaveLength(40);
    expect(body.first_period).toBe('2023-05');
    expect(body.latest_period).toBe('2026-08');
    expect(body.cumulative).toBe(188000);
    expect(body.latest).toEqual({ period: '2026-08', cuts: 3462 });
  });

  it('leaves out the months the source does not track, rather than zeroing them', async () => {
    const body = (await get()).json() as Body;
    const byPeriod = new Map(body.months.map((month) => [month.period, month.cuts]));

    for (const untracked of ['2022-12', '2023-01', '2023-02', '2023-03', '2023-04', '2026-09']) {
      expect(byPeriod.has(untracked), `${untracked} is not tracked and must be absent`).toBe(false);
    }
    // Every key in the payload, not only the ones named above: nothing before
    // the first tracked month may appear at all.
    expect(body.months.every((month) => month.period >= '2023-05')).toBe(true);
    expect(body.months[0]?.period).toBe('2023-05');
    expect(body.untracked_before).toBe('2023-05');
  });

  it('keeps the recorded zeros inside the window, which are real', async () => {
    const body = (await get()).json() as Body;
    const byPeriod = new Map(body.months.map((month) => [month.period, month.cuts]));
    expect(byPeriod.get('2023-08')).toBe(0);
    expect(byPeriod.get('2025-01')).toBe(0);
    expect([...byPeriod.values()].filter((cuts) => cuts === 0)).toHaveLength(15);
  });

  it('says in the payload that it does not decide a payout', async () => {
    const body = (await get()).json() as Body;
    expect(body.settlement.affects_settlement).toBe(false);
    expect(body.settlement.statement).toContain('does not affect settlement');
    expect(body.settlement.statement).toContain('occupation index alone');
  });

  it('carries the limits and the measured relationship with the index', async () => {
    const body = (await get()).json() as Body;
    const names = body.limits.map((entry) => entry.limit);
    expect(names).toContain('self_reported');
    expect(names).toContain('announcements_not_separations');
    expect(names).toContain('not_occupation_coded');
    expect(names).toContain('warn_box_unticked');

    expect(body.measured_against_the_index.computer_math_levels).toBe('-0.44');
    expect(body.measured_against_the_index.computer_math_differenced).toBe('-0.21');
    expect(body.measured_against_the_index.construction).toBe('about zero');
    expect(body.measured_against_the_index.reading).toContain('shared trend');
  });

  it('carries PROVENANCE.txt verbatim', async () => {
    const body = (await get()).json() as Body;
    expect(body.provenance).toContain('Not settlement data');
    expect(body.provenance).toContain('Announcements, not separations');
  });
});
