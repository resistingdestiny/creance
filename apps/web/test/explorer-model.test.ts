import { describe, expect, it } from 'vitest';

import { guideRate, marketRate, monthlyPremium } from '@creance/index-model/src/pricing';

import {
  PRICE_COVER,
  againstAverage,
  bandCaption,
  chartName,
  clampMonth,
  explorerOccupation,
  headlineFor,
  latestMonth,
  latestMonthIndex,
  meterFraction,
  methodSteps,
  positionSentence,
  priceFor,
  rankByDistance,
  stateOf,
  stateWord,
  type ExplorerOccupation,
} from '../src/lib/explorer-model.js';
import { formatMoney } from '../src/lib/format.js';
import type { IndexView } from '../src/lib/worker-api.js';

import { EXPLORER_READINGS } from './explorer-fixtures.js';

/// The explorer's arithmetic and wording, against the fifteen readings the API
/// served on testnet.
///
/// Nothing here invents a number. Where a figure can be checked against the
/// feed's own field it is, because the whole point of the page is that it
/// prints what was published and not what it worked out for itself.

const byGroup = new Map(EXPLORER_READINGS.map((reading) => [reading.group, reading]));

function reading(group: string): IndexView {
  const found = byGroup.get(group);
  if (found === undefined) throw new Error(`no recorded reading for ${group}`);
  return found;
}

function occupationFor(group: string): ExplorerOccupation {
  return explorerOccupation(reading(group));
}

const all = EXPLORER_READINGS.map(explorerOccupation);

describe('a reading turned into what the explorer draws', () => {
  it('takes the headline form from the API and never chooses one', () => {
    for (const index of EXPLORER_READINGS) {
      expect(explorerOccupation(index).form).toBe(index.headline?.form);
    }
    // Both forms are represented in the recording, so the branch is exercised.
    expect(new Set(all.map((occupation) => occupation.form))).toEqual(
      new Set(['level', 'shock']),
    );
  });

  it('measures against the frozen line of whichever form the API named', () => {
    const level = occupationFor('computer_math');
    expect(level.form).toBe('level');
    expect(level.line).toBe(Number(reading('computer_math').trigger.level_line));

    const shock = occupationFor('service');
    expect(shock.form).toBe('shock');
    expect(shock.line).toBe(Number(reading('service').trigger.attachment_shock));
  });

  it('carries the sixty months the explorer scrubs, oldest first', () => {
    for (const occupation of all) {
      expect(occupation.months).toHaveLength(60);
      expect(occupation.months[0]?.period).toBe('2021-05');
      expect(occupation.months.at(-1)?.period).toBe('2026-07');
    }
  });

  it('agrees with the API about the distance for the newest month', () => {
    for (const index of EXPLORER_READINGS) {
      const month = latestMonth(explorerOccupation(index));
      expect(month?.period).toBe(index.reading.period);
      expect(month?.distance).toBeCloseTo(Number(index.headline?.distance), 6);
    }
  });

  it('knows which occupations have capacity behind them', () => {
    expect(occupationFor('computer_math').buyable).toBe(true);
    expect(occupationFor('legal').buyable).toBe(true);
    // A reading for a group the picker does not carry has no series behind
    // it, which is the shape the not-buyable branch still exists for.
    expect(
      explorerOccupation({ ...reading('legal'), group: 'armed_forces' }).buyable,
    ).toBe(false);
  });
});

describe('the state word on a chip and in the grid', () => {
  it('is covered, close to opening or claims open', () => {
    expect(stateWord('covered')).toBe('Covered');
    expect(stateWord('watch')).toBe('Close to opening');
    expect(stateWord('open')).toBe('Claims open');
  });

  it('calls a month open when the feed says claims were open', () => {
    const occupation = occupationFor('computer_math');
    const april = occupation.months.find((month) => month.period === '2026-04');
    expect(april?.open).toBe(true);
    expect(stateOf(april ?? null)).toBe('open');
    expect(stateOf(latestMonth(occupation))).not.toBe('open');
  });

  it('watches an occupation within half a point of its line', () => {
    // Arts, design and media sits 0.02 points away in the newest month.
    const month = latestMonth(occupationFor('arts_design_ent_media'));
    expect(month?.distance).toBeLessThan(0.5);
    expect(stateOf(month)).toBe('watch');
  });
});

describe('the distance framing, with no signed value anywhere', () => {
  it('says claims are open before it says how near the line is', () => {
    const april = occupationFor('computer_math').months.find(
      (month) => month.period === '2026-04',
    );
    expect(headlineFor(april ?? null)).toBe('Claims are open');
  });

  it('reads under 0.05 points as sitting on the line', () => {
    const month = latestMonth(occupationFor('arts_design_ent_media'));
    expect(month?.distance).toBeLessThan(0.05);
    expect(headlineFor(month ?? null)).toBe('Right on the line');
  });

  it('otherwise counts the points to a payout', () => {
    expect(headlineFor(latestMonth(occupationFor('computer_math')))).toBe(
      '0.7 points from a payout',
    );
  });

  it('frames a position as points better or worse than average', () => {
    expect(againstAverage(-1.37)).toBe('1.4 points better than average');
    expect(againstAverage(0.92)).toBe('0.9 points worse than average');
  });

  it('says the level form as a position and the shock form as ground lost', () => {
    const level = occupationFor('computer_math');
    expect(positionSentence(level, latestMonth(level))).toBe(
      'Unemployment in this job sits 1.4 points better than average. Claims open when it reaches 0.7 points better than average.',
    );

    const shock = occupationFor('service');
    expect(positionSentence(shock, latestMonth(shock))).toContain('Against a year ago');
    expect(positionSentence(shock, latestMonth(shock))).toContain('Claims open when it has lost');
  });

  it('prints no minus sign on any sentence the page shows', () => {
    for (const occupation of all) {
      const month = latestMonth(occupation);
      const said = [
        headlineFor(month),
        positionSentence(occupation, month) ?? '',
        bandCaption(occupation),
        chartName(occupation, month),
        ...methodSteps(occupation, month).map((step) => `${step.title} ${step.body}`),
      ].join(' ');
      expect(said, occupation.key).not.toContain('-');
    }
  });
});

describe('the ranking under "Every occupation, closest to opening first"', () => {
  const ranked = rankByDistance(all);

  it('keeps every occupation and orders them by distance to their own line', () => {
    expect(ranked).toHaveLength(15);
    const distances = ranked.map((row) => row.month?.distance ?? Number.POSITIVE_INFINITY);
    expect([...distances].sort((a, b) => a - b)).toEqual(distances);
  });

  it('puts the occupation nearest its line first', () => {
    expect(ranked[0]?.occupation.key).toBe('arts_design_ent_media');
    expect(ranked[0]?.gap).toBe('on the line');
  });

  it('says the gap in the same words the verdict uses', () => {
    const computer = ranked.find((row) => row.occupation.key === 'computer_math');
    expect(computer?.gap).toBe('0.7 points away');
    expect(computer?.state).toBe('covered');
  });
});

describe('the month scrubber', () => {
  const occupation = occupationFor('computer_math');

  it('opens on the newest published month', () => {
    expect(latestMonthIndex(occupation)).toBe(59);
    expect(occupation.months[latestMonthIndex(occupation)]?.period).toBe('2026-07');
  });

  it('holds a dragged handle inside the months it has', () => {
    expect(clampMonth(occupation, -4)).toBe(0);
    expect(clampMonth(occupation, 0)).toBe(0);
    expect(clampMonth(occupation, 59)).toBe(59);
    expect(clampMonth(occupation, 900)).toBe(59);
    expect(clampMonth(occupation, 12.4)).toBe(12);
    expect(clampMonth(occupation, Number.NaN)).toBe(59);
  });
});

describe('the meter, from a payout to far from a payout', () => {
  it('is empty at the line and never past either end', () => {
    const occupation = occupationFor('computer_math');
    const open = occupation.months.find((month) => month.period === '2026-04');
    expect(meterFraction(occupation, open ?? null)).toBe(0);
    for (const month of occupation.months) {
      const fraction = meterFraction(occupation, month);
      expect(fraction).toBeGreaterThanOrEqual(0);
      expect(fraction).toBeLessThanOrEqual(1);
    }
  });
});

describe('the price block', () => {
  it('is the index model guide rate, market rate and monthly premium', () => {
    const occupation = occupationFor('computer_math');
    const distance = latestMonth(occupation)?.distance ?? 0;
    const utilisation = 0.45;

    const guide = guideRate(distance);
    const price = priceFor(distance, utilisation);
    expect(price?.cover).toBe(PRICE_COVER);
    expect(price?.guide).toBe(formatMoney(Math.round(monthlyPremium(guide, PRICE_COVER) * 1e6)));
    expect(price?.monthly).toBe(
      formatMoney(Math.round(monthlyPremium(marketRate(guide, utilisation), PRICE_COVER) * 1e6)),
    );
    expect(price?.addOn).toBe(45);
  });

  it('caps what capital adds at the model cap multiple', () => {
    expect(priceFor(0.69, 5)?.addOn).toBe(200);
  });

  it('holds the hazard at the line rather than extrapolating past it', () => {
    const open = priceFor(-1.5, 0);
    expect(open?.monthly).toBe(priceFor(0, 0)?.monthly);
  });
});
