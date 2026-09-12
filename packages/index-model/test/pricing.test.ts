import { describe, expect, it } from 'vitest';

import { loadDataset } from '../src/dataset.js';
import { hazardTable } from '../src/hazard.js';
import {
  HAZARD_FIT,
  PRICING,
  capitalCharge,
  coverIsOffered,
  expectedLossOnWrittenCover,
  expectedLossRate,
  fittedHazard,
  guideRate,
  headline,
  imminence,
  marketRate,
  monthlyPremium,
  requiredReturn,
  returnSplit,
  riskCharge,
  selectionCharge,
  separationOnWrittenCover,
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

describe('imminence', () => {
  it('is the fitted hazard rearranged and not a second fit', () => {
    // The part of h(d) that moves, over the part of it that can. One at the
    // line, nought where the hazard has settled on the floor the shock form
    // sets. Nothing new is measured to produce it.
    for (const distance of [0, 0.02, 0.25, 0.69, 2, 4.56]) {
      expect(imminence(distance), `d=${distance}`).toBeCloseTo(
        (fittedHazard(distance) - HAZARD_FIT.floor) / HAZARD_FIT.amplitude,
        12,
      );
    }
    expect(imminence(0)).toBe(1);
    expect(imminence(4.56)).toBeLessThan(0.0001);
  });

  it('is floored at the line, where the fit stops', () => {
    expect(imminence(-3)).toBe(1);
  });
});

describe('selling into an open occupation', () => {
  it('is refused at or past the line', () => {
    // The level form opens on equality and distance is the points still to
    // travel, so nought or less is an occupation whose claims are open. Cover
    // written into it would be cover against a loss already running. The
    // published hazard table has said so since it was written and until 12
    // September 2026 nothing enforced it.
    expect(coverIsOffered(0)).toBe(false);
    expect(coverIsOffered(-1.01)).toBe(false);
    expect(coverIsOffered(0.02)).toBe(true);
  });
});

describe('the selection charge', () => {
  it('is nothing far from the line and the larger charge at it', () => {
    // Selection needs something to select on. Four points out there is nothing
    // to see and the charge is worth less than a penny a month on 5,000.
    expect(monthlyPremium(selectionCharge(4.56), 5000)).toBeLessThan(0.01);
    // On the line it is three times the measured risk charge, because the
    // people who buy there are not the population the hazard counted.
    expect(selectionCharge(0.02)).toBeGreaterThan(riskCharge(0.02) * 3);
  });

  it('is the loaded gap between the written loss and the population loss', () => {
    for (const distance of [0.02, 0.25, 0.69, 4.56]) {
      expect(selectionCharge(distance), `d=${distance}`).toBeCloseTo(
        (expectedLossOnWrittenCover(distance) - expectedLossRate(distance)) * PRICING.load,
        12,
      );
    }
  });

  it('leaves the measured hazard and the population loss alone', () => {
    // The lever is the separation rate on the cover written, not the hazard.
    // Both of these are exactly what they were before the change.
    expect(fittedHazard(0)).toBeCloseTo(0.66, 6);
    expect(expectedLossRate(0.02)).toBeCloseTo(fittedHazard(0.02) * 0.167 * 0.6, 12);
    expect(separationOnWrittenCover(4.56)).toBeCloseTo(PRICING.separationGivenOpen, 4);
    expect(separationOnWrittenCover(0)).toBeCloseTo(PRICING.selectionCeiling, 12);
  });
});

describe('the capital charge', () => {
  it('is the required return less the base yield, with its margin, over the target', () => {
    for (const distance of [0.02, 0.69, 4.56]) {
      expect(capitalCharge(distance), `d=${distance}`).toBeCloseTo(
        ((requiredReturn(distance) - PRICING.impliedBaseYield) * (1 + PRICING.reserveMargin)) /
          PRICING.targetUtilisation,
        12,
      );
    }
    // Far from the line the required return is the coupon and the charge is the
    // floor: (0.08 - 0.04) * 1.20 / 0.85 = 5.65 percent a year.
    expect(capitalCharge(4.56)).toBeCloseTo(0.056_471, 5);
    expect(PRICING.baseCapitalCharge).toBeCloseTo(0.056_471, 6);
  });

  it('rises with imminence, because capital does not want the same return either way', () => {
    // 8 percent a year far from the line, 20 percent on it. An occupation that
    // may pay this year locks capital that cannot be anywhere else when it
    // does, and the pool is collateralised one for one.
    expect(requiredReturn(4.56)).toBeCloseTo(PRICING.couponRate, 5);
    expect(requiredReturn(0)).toBeCloseTo(0.2, 12);
    expect(capitalCharge(0.02)).toBeGreaterThan(capitalCharge(0.69) * 3);
    expect(capitalCharge(0.69)).toBeGreaterThan(capitalCharge(4.56));
  });

  it('is a judgment about the base yield and not a rate anything looked up', () => {
    // 4 percent, implied from tokenised treasuries, an assumption of 12
    // September 2026. Nothing fetches it and this deployment earns none of it:
    // the collateral sits in a vault on Hedera testnet making nothing.
    expect(PRICING.impliedBaseYield).toBe(0.04);
  });

  it('leaves the coupon of record at 8 percent', () => {
    // Three coupons are settled on chain at it and entitlements read off it.
    // The required return above is what the PRICE is solved for; the coupon is
    // the contractual floor of it and the rest is the residual.
    expect(PRICING.couponRate).toBe(0.08);
  });

  it('funds the return over the base, its margin and the written losses, at the target', () => {
    // The identity the price is set by, per unit of principal:
    //   guide * U  =  (required return - base) * (1 + margin)
    //                 +  load * expected loss on written cover * U
    // Below U it does not hold and no price makes it hold: a series nobody has
    // bought cover from earns nothing and still owes its coupon. The base half
    // is assumed rather than received, and the selection half is a judgment
    // rather than a measurement. None of the three is priced away.
    const u = PRICING.targetUtilisation;
    for (const distance of [0.02, 0.69, 4.56]) {
      const income = guideRate(distance) * u;
      const owed =
        (requiredReturn(distance) - PRICING.impliedBaseYield) * (1 + PRICING.reserveMargin) +
        expectedLossOnWrittenCover(distance) * PRICING.load * u;
      expect(income, `d=${distance}`).toBeCloseTo(owed, 12);
    }
  });
});

describe('the guide rate', () => {
  it('is its three charges added', () => {
    for (const distance of [0.02, 0.69, 1.22, 4.56]) {
      expect(guideRate(distance), `d=${distance}`).toBeCloseTo(
        capitalCharge(distance) + riskCharge(distance) + selectionCharge(distance),
        12,
      );
    }
  });

  it('reproduces the published spread across the picker', () => {
    // Distance to the line, guide rate, monthly premium on a 5,000 limit.
    const rows: [number, number, number][] = [
      [0.02, 0.5421, 225.89], // arts, design and media, on its line
      [0.69, 0.0749, 31.2], // computer and mathematical
      [0.71, 0.0738, 30.74], // professional and related
      [0.89, 0.0674, 28.09], // management and finance
      [1.22, 0.0636, 26.51], // office and administrative support
      [4.56, 0.0626, 26.08], // farming, fishing and forestry
    ];
    for (const [distance, rate, premium] of rows) {
      expect(guideRate(distance), `d=${distance}`).toBeCloseTo(rate, 3);
      expect(monthlyPremium(guideRate(distance), 5000), `d=${distance}`).toBeCloseTo(premium, 1);
    }
    // The spread on the total price is about nine times now, where it was two.
    // An occupation on its line is not a slightly dearer version of one four
    // points away, and until 12 September 2026 the price said it was.
    expect(guideRate(0.02) / guideRate(4.56)).toBeCloseTo(8.66, 1);
  });

  it('barely moves the occupations nowhere near their line', () => {
    // The change is meant to be felt inside about a point of the line and
    // nowhere else. Beyond two points it is worth under a penny a month on
    // 5,000, which is the old price to the cent.
    for (const distance of [2, 2.48, 3.12, 4.42, 4.56]) {
      const before = PRICING.baseCapitalCharge + riskCharge(distance);
      expect(monthlyPremium(guideRate(distance) - before, 5000), `d=${distance}`).toBeLessThan(
        0.01,
      );
    }
  });

  it('flattens out above the floor rather than on it', () => {
    // The hazard settles at 0.047, which is a 0.61 percent risk charge, so the
    // floor never binds on this curve. The floor is derived and not chosen: it
    // is the capital charge at its own smallest, the price at which a policy
    // pays for the capital it locks and nothing for the risk.
    expect(guideRate(2)).toBeCloseTo(PRICING.baseCapitalCharge + 0.0061, 3);
    expect(guideRate(100)).toBeCloseTo(PRICING.baseCapitalCharge + HAZARD_FIT.floor * 0.13026, 6);
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
    // the collateral would make waiting plus the premiums less the losses on
    // the cover actually written.
    const split = returnSplit(rate, exposure, principal, expectedLossOnWrittenCover(0.69))!;
    expect(split.base).toBe(PRICING.impliedBaseYield);
    expect(split.premium).toBeCloseTo(0.1215, 4);
    expect(split.loss).toBeCloseTo(0.0073, 4);
    expect(split.total).toBeCloseTo(0.1542, 4);
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
    // The empty pool is no longer the cheap one: it was, and that was the
    // fault. An empty pool on an occupation about to pay is empty because it is
    // new, not because capital is indifferent, and the guide price says so now.
    expect(monthlyPremium(marketRate(guide, 0.9), 5000)).toBeCloseTo(429.19, 1);
    expect(monthlyPremium(marketRate(guide, 0), 5000)).toBeCloseTo(225.89, 1);
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
