import { describe, expect, it } from 'vitest';

import { loadDataset } from '../src/dataset.js';
import { hazardTable } from '../src/hazard.js';
import {
  HAZARD_FIT,
  PRICING,
  expectedLossRate,
  fittedHazard,
  guideRate,
  headline,
  marketRate,
  monthlyPremium,
  returnSplit,
  riskCharge,
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

describe('the risk charge', () => {
  it('multiplies the hazard by the separation, share and load assumptions', () => {
    // 0.167 * 0.60 * 1.30 = 0.13026 of the hazard.
    const factor = PRICING.separationGivenOpen * PRICING.expectedShareOfLimit * PRICING.load;
    expect(factor).toBeCloseTo(0.13026, 9);
    expect(riskCharge(0.69)).toBeCloseTo(fittedHazard(0.69) * factor, 12);
    expect(expectedLossRate(0.69)).toBeCloseTo(riskCharge(0.69) / PRICING.load, 12);
  });

  it('carries the whole of the spread between occupations', () => {
    // The index differentiates here and nowhere else. Arts and design sits on
    // its line, farming is four and a half points from its own.
    expect(riskCharge(0.02) / riskCharge(4.56)).toBeGreaterThan(12);
  });
});

describe('the capital charge', () => {
  it('is the coupon less the implied base yield, with its margin, over the target', () => {
    // (0.08 - 0.04) * 1.20 / 0.85 = 5.65 percent a year. The premium funds the
    // spread over the base and not the whole coupon, because an insurer's
    // collateral is not idle while it waits to pay claims.
    expect(PRICING.capitalCharge).toBeCloseTo(0.056_471, 6);
    expect(PRICING.capitalCharge).toBeCloseTo(
      ((PRICING.couponRate - PRICING.impliedBaseYield) * (1 + PRICING.reserveMargin)) /
        PRICING.targetUtilisation,
      12,
    );
  });

  it('is a judgment about the base yield and not a rate anything looked up', () => {
    // 4 percent, implied from tokenised treasuries, an assumption of 12
    // September 2026. Nothing fetches it and this deployment earns none of it:
    // the collateral sits in a vault on Hedera testnet making nothing.
    expect(PRICING.impliedBaseYield).toBe(0.04);
  });

  it('is the same for every occupation', () => {
    // CoverPool.bind will not let exposure pass principal, so a unit of limit
    // locks a unit of capital whatever the job is. Only the loss term may vary.
    for (const distance of [0.02, 0.69, 1.22, 4.56]) {
      expect(guideRate(distance) - riskCharge(distance)).toBeCloseTo(PRICING.capitalCharge, 12);
    }
  });

  it('funds the coupon over the base, its margin and the losses, at the target', () => {
    // The identity the price is set by, per unit of principal:
    //   guide * U  =  (coupon - base) * (1 + margin)  +  load * expected loss * U
    // Below U it does not hold and no price makes it hold: a series nobody has
    // bought cover from earns nothing and still owes its coupon. And the base
    // half is assumed rather than received, which is the other thing it does
    // not say.
    const u = PRICING.targetUtilisation;
    for (const distance of [0.02, 0.69, 4.56]) {
      const income = guideRate(distance) * u;
      const owed =
        (PRICING.couponRate - PRICING.impliedBaseYield) * (1 + PRICING.reserveMargin) +
        expectedLossRate(distance) * PRICING.load * u;
      expect(income, `d=${distance}`).toBeCloseTo(owed, 12);
    }
  });
});

describe('the guide rate', () => {
  it('reproduces the published spread across the picker', () => {
    // Distance to the line, guide rate, monthly premium on a 5,000 limit.
    const rows: [number, number, number][] = [
      [0.02, 0.1355, 56.46], // arts, design and media, on its line
      [0.69, 0.0661, 27.53], // computer and mathematical
      [0.71, 0.0658, 27.4], // professional and related
      [0.89, 0.064, 26.66], // management and finance
      [1.22, 0.0629, 26.21], // office and administrative support
    ];
    for (const [distance, rate, premium] of rows) {
      expect(guideRate(distance), `d=${distance}`).toBeCloseTo(rate, 3);
      expect(monthlyPremium(guideRate(distance), 5000), `d=${distance}`).toBeCloseTo(premium, 1);
    }
    // The spread on the total price is about two times, not thirteen, because
    // every occupation carries the same capital charge. The thirteen is still
    // there, in the risk charge, and that is the column to read.
    expect(guideRate(0.02) / guideRate(4.56)).toBeCloseTo(2.16, 2);
  });

  it('flattens out above the floor rather than on it', () => {
    // The hazard settles at 0.047, which is a 0.61 percent risk charge, so the
    // floor never binds on this curve. The floor is derived and not chosen: it
    // is the capital charge alone, the price at which a policy pays for the
    // capital it locks and nothing for the risk.
    expect(guideRate(2)).toBeCloseTo(PRICING.capitalCharge + 0.0061, 4);
    expect(guideRate(100)).toBeCloseTo(PRICING.capitalCharge + HAZARD_FIT.floor * 0.13026, 6);
    expect(guideRate(100)).toBeGreaterThan(PRICING.floorRate);
    // And it is no longer below the yield the collateral is assumed to make
    // just by waiting, which the old 0.5 percent floor was. A policy sold at
    // the old floor did not pay for the collateral standing behind it.
    expect(PRICING.floorRate).toBeGreaterThan(PRICING.impliedBaseYield);
    expect(0.005).toBeLessThan(PRICING.impliedBaseYield);
  });

  it('charges enough that the coupon is a minority of premium income', () => {
    // The demo series: 100,000 of principal, 86,000 of limit written against
    // 97,000 still behind it, an 8 percent coupon. Priced on expected loss
    // alone this was 1,557 of income against 8,000 of coupon.
    const principal = 100_000;
    const exposure = 86_000;
    const utilisation = exposure / 97_000;
    const rate = marketRate(guideRate(0.69), utilisation);
    const income = rate * exposure;
    const coupon = PRICING.couponRate * principal;
    expect(income).toBeGreaterThan(coupon);

    // And the whole return clears the coupon it promised, which is the base
    // the collateral would make waiting plus the premiums less the losses.
    const split = returnSplit(rate, exposure, principal, expectedLossRate(0.69))!;
    expect(split.base).toBe(PRICING.impliedBaseYield);
    expect(split.premium).toBeCloseTo(0.1072, 4);
    expect(split.loss).toBeCloseTo(0.0063, 4);
    expect(split.total).toBeCloseTo(0.1408, 4);
    expect(split.total).toBeGreaterThan(PRICING.couponRate);
  });

  it('answers nothing for a return split with no principal behind it', () => {
    expect(returnSplit(0.1, 0, 0, 0.01)).toBeNull();
  });
});

describe('the market rate', () => {
  it('doubles the guide at full utilisation and caps at three times', () => {
    const guide = guideRate(0.02);
    expect(marketRate(guide, 0)).toBe(guide);
    expect(marketRate(guide, 1)).toBeCloseTo(guide * 2, 12);
    expect(marketRate(guide, 5)).toBeCloseTo(guide * 3, 12);
    // A job on its line in a thin pool against the same job in a deep pool.
    expect(monthlyPremium(marketRate(guide, 0.9), 5000)).toBeCloseTo(107.27, 1);
    expect(monthlyPremium(marketRate(guide, 0), 5000)).toBeCloseTo(56.46, 1);
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
