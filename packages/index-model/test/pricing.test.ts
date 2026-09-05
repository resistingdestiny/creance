import { describe, expect, it } from 'vitest';

import { loadDataset } from '../src/dataset.js';
import {
  HAZARD_FIT,
  PRICING,
  fittedHazard,
  guideRate,
  hazardTable,
  headline,
  marketRate,
  monthlyPremium,
} from '../src/pricing.js';
import type { Observation } from '../src/core.js';

const dataset = loadDataset();
const table = hazardTable(dataset);

describe('the empirical hazard table', () => {
  it('pools the twenty-nine occupation series over 2010 to 2025-06', () => {
    // 29 occupation series in the archive, 162 sampled months each: 2010-01 to
    // 2025-06 is 186 months less the 24 excluded for the dislocation. The
    // lookahead reaches to the archive end.
    expect(table.seriesCount).toBe(29);
    expect(table.from).toBe('2010-01');
    expect(table.to).toBe('2025-06');
    expect(table.sample).toBe(29 * 162);
    expect(table.sample).toBe(4698);
  });

  it('is steep inside half a point and flat beyond it', () => {
    const bucket = (label: string) => table.buckets.find((b) => b.label.startsWith(label))!;
    expect(bucket('at or past').sample).toBe(32);
    expect(bucket('at or past').rate).toBeCloseTo(0.656, 3);
    expect(bucket('0 to 0.25').sample).toBe(20);
    expect(bucket('0 to 0.25').rate).toBeCloseTo(0.3, 3);
    expect(bucket('0.25 to 0.5').sample).toBe(74);
    expect(bucket('0.25 to 0.5').rate).toBeCloseTo(0.122, 3);
    expect(bucket('0.5 to 1').sample).toBe(720);
    expect(bucket('1 to 2').sample).toBe(1644);
    expect(bucket('2 to 4').sample).toBe(1524);
    expect(bucket('more than 4').sample).toBe(684);
    // Beyond half a point the shock form sets a floor of about five percent a
    // year and the curve stops caring about distance.
    for (const label of ['0.5 to 1', '1 to 2', '2 to 4', 'more than 4']) {
      expect(bucket(label).rate, label).toBeGreaterThan(0.02);
      expect(bucket(label).rate, label).toBeLessThan(0.06);
    }
  });

  it('has every month in exactly one bucket', () => {
    expect(table.buckets.reduce((total, b) => total + b.sample, 0)).toBe(table.sample);
    expect(table.buckets).toHaveLength(7);
  });
});

describe('the fitted hazard', () => {
  it('meets the empirical table at the ends', () => {
    // h(0) = 0.047 + 0.613 = 0.660, against 65.6 percent at or past the line.
    expect(fittedHazard(0)).toBeCloseTo(0.66, 6);
    // Far from the line the curve settles on the floor the shock form sets.
    expect(fittedHazard(4)).toBeCloseTo(0.047, 4);
    expect(fittedHazard(0.22)).toBeCloseTo(0.047 + 0.613 / Math.E, 9);
  });

  it('falls monotonically', () => {
    let previous = Infinity;
    for (let d = 0; d <= 5; d += 0.1) {
      const value = fittedHazard(d);
      expect(value).toBeLessThan(previous);
      previous = value;
    }
  });
});

describe('the guide rate', () => {
  it('multiplies the hazard by the separation, share and load assumptions', () => {
    // 0.167 * 0.60 * 1.30 = 0.13026 of the hazard.
    const factor = PRICING.separationGivenOpen * PRICING.expectedShareOfLimit * PRICING.load;
    expect(factor).toBeCloseTo(0.13026, 9);
    expect(guideRate(0.69)).toBeCloseTo(fittedHazard(0.69) * factor, 12);
  });

  it('reproduces the published spread across the picker', () => {
    // Distance to the line, guide rate, monthly premium on a 5,000 limit.
    const rows: [number, number, number][] = [
      [0.02, 0.079, 32.9], // arts, design and media
      [0.69, 0.0096, 4.0], // computer and mathematical
      [0.71, 0.0093, 3.87], // professional and related
      [0.89, 0.0075, 3.13], // management and finance
      [1.22, 0.0064, 2.68], // office and administrative support
    ];
    for (const [distance, rate, premium] of rows) {
      expect(guideRate(distance), `d=${distance}`).toBeCloseTo(rate, 3);
      expect(monthlyPremium(guideRate(distance), 5000), `d=${distance}`).toBeCloseTo(premium, 1);
    }
    // A thirteen times spread across the picker, driven entirely by the index.
    expect(guideRate(0.02) / guideRate(4)).toBeGreaterThan(12);
  });

  it('flattens out above the floor rather than on it', () => {
    // The hazard settles at 0.047, which prices at 0.61 percent, so the 0.5
    // percent floor never binds on this curve. It is there as a judgment about
    // the least a policy can be worth writing, not as a measurement, and the
    // pricing page has to say so.
    expect(guideRate(2)).toBeCloseTo(0.0061, 4);
    expect(guideRate(100)).toBeCloseTo(HAZARD_FIT.floor * 0.13026, 6);
    expect(guideRate(100)).toBeGreaterThan(PRICING.floorRate);
    // The floor still holds if the curve is ever refitted lower.
    expect(Math.max(PRICING.floorRate, 0.0001)).toBe(PRICING.floorRate);
  });
});

describe('the market rate', () => {
  it('doubles the guide at full utilisation and caps at three times', () => {
    const guide = guideRate(0.02);
    expect(marketRate(guide, 0)).toBe(guide);
    expect(marketRate(guide, 1)).toBeCloseTo(guide * 2, 12);
    expect(marketRate(guide, 5)).toBeCloseTo(guide * 3, 12);
    // A job on its line in a thin pool against the same job in a deep pool.
    expect(monthlyPremium(marketRate(guide, 0.9), 5000)).toBeCloseTo(62.6, 1);
    expect(monthlyPremium(marketRate(guide, 0), 5000)).toBeCloseTo(32.9, 1);
  });

  it('refuses a negative utilisation', () => {
    expect(() => marketRate(0.01, -0.1)).toThrow();
  });
});

describe('the headline form', () => {
  const base: Observation = {
    groupKey: 'computer_math',
    seriesId: 'LNU04034021',
    period: '2026-03',
    uG: 3.9,
    uAll: 4.3,
    e: -0.4,
    ebar: -0.8,
    ebarBase: -1.27,
    odi: 0.47,
    attachmentShock: 2.0,
    levelLine: -0.68,
    forms: ['shock', 'level'],
    levelOpen: false,
    shockOpen: false,
    open: false,
    openReason: 'none',
    status: 'final',
  };

  it('picks the form that is nearer its line', () => {
    // Level: -0.68 - -0.80 = 0.12 points to travel.
    // Shock: 2.00 - 0.47 = 1.53 points to travel.
    const result = headline(base);
    expect(result?.form).toBe('level');
    expect(result?.distance).toBeCloseTo(0.12, 9);
    expect(result?.onTheLine).toBe(false);
  });

  it('reads a distance under 0.05 as sitting on the line', () => {
    const result = headline({ ...base, ebar: -0.72 });
    expect(result?.distance).toBeCloseTo(0.04, 9);
    expect(result?.onTheLine).toBe(true);
  });

  it('reports a negative distance when the form has already opened', () => {
    const result = headline({ ...base, ebar: -0.6, levelOpen: true, open: true, openReason: 'level' });
    expect(result?.distance).toBeCloseTo(-0.08, 9);
    expect(result?.open).toBe(true);
  });

  it('falls back to the level form when the shock form is not evaluable', () => {
    const result = headline({ ...base, odi: null, forms: ['level'] });
    expect(result?.form).toBe('level');
  });

  it('returns nothing when neither form is evaluable', () => {
    expect(headline({ ...base, ebar: null, odi: null, forms: [], status: 'no_source' })).toBeNull();
  });
});
