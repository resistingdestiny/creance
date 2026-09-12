import { describe, expect, it } from 'vitest';

import { formatDay } from '../src/lib/format.js';
import {
  bandLabelFor,
  bandSentence,
  chartDescription,
  chartPoints,
  chartThreshold,
  coverAmount,
  exhaustionFor,
  headlineReading,
  indexMargins,
  lineIsNegative,
  marginSentences,
  nextPaymentLine,
  paysOutSentence,
  pointsInProse,
  premiumAmount,
  trendOf,
  verifyCopy,
  waitingLine,
  whatWouldHaveHappened,
} from '../src/lib/worker-model.js';
import { toMinorUnits } from '../src/lib/worker-api.js';
import { INDEX, POLICY, QUOTE, openIndex } from './worker-fixtures.js';

describe('the slider to minor units', () => {
  it('maps every step of the range', () => {
    expect(toMinorUnits(1000)).toBe('1000000000');
    expect(toMinorUnits(5000)).toBe('5000000000');
    expect(toMinorUnits(10_000)).toBe('10000000000');
  });

  it('refuses a fractional amount rather than rounding one', () => {
    expect(() => toMinorUnits(1500.5)).toThrow(RangeError);
  });
});

describe('money on the worker screens', () => {
  it('writes a cover amount with a thousands separator and no decimals', () => {
    expect(coverAmount(QUOTE.limit)).toBe('5,000');
    expect(coverAmount(POLICY.limit)).toBe('1,000');
  });

  it('writes a premium at two decimals', () => {
    expect(premiumAmount(QUOTE.premium)).toBe('4.25');
    expect(premiumAmount(POLICY.premium)).toBe('0.85');
  });

  it('never renders a currency symbol', () => {
    expect(coverAmount(QUOTE.limit)).not.toMatch(/[$£€]/);
    expect(premiumAmount(QUOTE.premium)).not.toMatch(/[$£€]/);
  });
});

describe("the Amount screen's sentence", () => {
  it('names both triggers, with the attachment and the exhaustion interpolated', () => {
    expect(paysOutSentence(QUOTE)).toBe(
      'Claims open in two ways: a sudden jump of 2 points above trend, or staying within 0.68 points of average. A jump of 4 pays in full.',
    );
  });

  it('drops the full payout sentence for a series with no published exhaustion', () => {
    expect(paysOutSentence({ ...QUOTE, series_id: 'ODI-NOTHING-2026-01' })).toBe(
      'Claims open in two ways: a sudden jump of 2 points above trend, or staying within 0.68 points of average.',
    );
  });

  it('says a positive level line as points worse than average', () => {
    expect(paysOutSentence({ ...QUOTE, level_line: '1.32' })).toContain(
      'staying 1.32 points worse than average',
    );
  });

  it('reads the exhaustion of the demo series from the series of record', () => {
    expect(exhaustionFor('ODI-COMP-2026-01')).toBe(4);
    expect(exhaustionFor('ODI-OFFICE-2026-01')).toBeNull();
  });

  it('writes a whole series parameter without its decimals', () => {
    expect(pointsInProse('2.00')).toBe('2');
    expect(pointsInProse(4)).toBe('4');
    expect(pointsInProse('3.50')).toBe('3.5');
  });
});

describe('the headline reading', () => {
  it('takes the form the API chose and never picks one itself', () => {
    expect(headlineReading(INDEX)?.form).toBe('level');
    expect(chartThreshold(INDEX)).toBe(-0.68);
  });

  it('shows the distance to a payout, unsigned, at two decimals', () => {
    const reading = headlineReading(INDEX);
    expect(reading?.distance).toBe('0.69');
    expect(reading?.value).toBe('0.69, falling');
    expect(reading?.caption).toBe('Points from opening claims.');
    expect(reading?.detail).toBe('Points from opening claims, falling.');
  });

  it('never shows a signed value, even when the index is past the line', () => {
    const reading = headlineReading(openIndex());
    expect(reading?.open).toBe(true);
    expect(reading?.distance).toBe('0.00');
    expect(reading?.value).not.toContain('-');
    expect(reading?.caption).toBe('Claims are open for Computer and mathematical.');
  });

  it('reads a distance under 0.05 as sitting on the line', () => {
    const near = {
      ...INDEX,
      headline: { form: 'level' as const, distance: '0.03', on_the_line: true, open: false },
    };
    expect(headlineReading(near)?.caption).toBe('On the line that opens claims.');
  });

  it('answers null when the API has no headline to give', () => {
    expect(headlineReading({ ...INDEX, headline: null })).toBeNull();
  });
});

describe('the trend word', () => {
  it('reads the index as falling when it moved away from the line', () => {
    // July 2026 ebar is -1.37 against -0.80 three months earlier, so the
    // distance to the line grew and the index moved away from a payout.
    expect(trendOf(INDEX)).toBe('falling');
  });

  it('reads the index as rising when it moved towards the line', () => {
    // The same recorded months, cut at April 2026, the month claims opened.
    const end = INDEX.history.findIndex((point) => point.period === '2026-04');
    expect(trendOf({ ...INDEX, history: INDEX.history.slice(0, end + 1) })).toBe('rising');
  });

  it('reads a move under a tenth of a point as steady', () => {
    const flat = {
      ...INDEX,
      history: INDEX.history.map((point) => ({ ...point, ebar: '-1.00' })),
    };
    expect(trendOf(flat)).toBe('steady');
  });

  it('is steady when there is not enough history to compare', () => {
    expect(trendOf({ ...INDEX, history: INDEX.history.slice(-2) })).toBe('steady');
  });
});

describe('the chart', () => {
  it('plots the form the headline names, oldest first', () => {
    const points = chartPoints(INDEX);
    expect(points).toHaveLength(24);
    expect(points[0]).toEqual({ period: '2024-05', value: -0.93 });
    expect(points.at(-1)).toEqual({ period: '2026-07', value: -1.37 });
  });

  it('leaves a month with no reading as a gap, not a bridged line', () => {
    const gapped = {
      ...INDEX,
      history: INDEX.history.map((point) =>
        point.period === '2025-09' ? { ...point, ebar: null } : point,
      ),
    };
    expect(chartPoints(gapped).find((point) => point.period === '2025-09')?.value).toBeNull();
  });

  it('words a negative level line as a distance from average, and names the trigger', () => {
    expect(bandLabelFor(INDEX)).toBe('Staying within 0.68 of average');
    expect(bandSentence('level', -0.68)).toBe('Claims open on staying within 0.68 of average');
    expect(lineIsNegative(INDEX)).toBe(true);
  });

  it('names the other trigger on a chart drawing the shock form', () => {
    const shock = {
      ...INDEX,
      headline: { form: 'shock' as const, distance: '2.07', on_the_line: false, open: false },
    };
    expect(bandLabelFor(shock)).toBe('A sudden jump above 2.00');
  });

  it('describes itself in the same unsigned framing as the screen', () => {
    expect(chartDescription(INDEX)).toBe(
      'Computer and mathematical. 0.69 points from opening claims, falling.',
    );
  });
});

describe('what would have happened', () => {
  it('marks every published month open or closed', () => {
    const months = whatWouldHaveHappened(INDEX);
    expect(months).toHaveLength(24);
    expect(months.filter((month) => month.open).map((month) => month.period)).toEqual([
      '2026-04',
      '2026-05',
    ]);
  });
});

describe('how close the call was', () => {
  // T56. The margins are the feed's own level_margin and shock_margin, never
  // re-derived: the reading less its line, negative while closed and zero or
  // positive once open, the opposite sign to headline.distance.
  it('says the open month cleared its level line by 0.08, at two decimals', () => {
    // docs/INDEX.md: computer_math 2026-04 has ebar -0.60 against a level
    // line of -0.68. The page must read 0.08, not 0.8 and not the wrong side.
    const lines = indexMargins({
      ...openIndex(),
      reading: { ...openIndex().reading, period: '2026-04' },
      trigger: { ...openIndex().trigger, shock_margin: '-1.70' },
    });
    expect(lines).toEqual([
      'In April 2026 the index was 0.08 points past the line for staying worse, and 1.70 points short of the line for a sudden jump.',
    ]);
  });

  it('says how far short a closed month sat, on both forms', () => {
    expect(indexMargins(INDEX)).toEqual([
      'In July 2026 the index was 0.69 points short of the line for staying worse, and 2.07 points short of the line for a sudden jump.',
    ]);
  });

  it('says nothing about the shock form where it cannot be evaluated', () => {
    const lines = marginSentences('2026-04', '0.08', null);
    expect(lines).toEqual([
      'In April 2026 the index was 0.08 points past the line for staying worse.',
    ]);
    expect(lines.join(' ')).not.toContain('sudden jump');
    expect(lines.join(' ')).not.toContain('0.00');
  });

  it('says nothing at all where no margin was published', () => {
    expect(marginSentences('2025-10', null, null)).toEqual([]);
  });

  it('reads a margin of exactly zero as on the line', () => {
    expect(marginSentences('2026-05', '0.00', '-1.50')[0]).toBe(
      'In May 2026 the index was on the line for staying worse, and 1.50 points short of the line for a sudden jump.',
    );
  });

  it('never prints a sign or rounds to one decimal', () => {
    for (const lines of [indexMargins(INDEX), indexMargins(openIndex())]) {
      const said = lines.join(' ');
      expect(said).not.toMatch(/[-+]\d/);
      expect(said).not.toContain('0.8 ');
      expect(said).not.toContain('0.7 ');
    }
  });

  it('is the margin and nothing after it', () => {
    // It carried a second sentence about later corrections settling, which is
    // a caveat under a caveat and the kind of tail nobody reads on a phone.
    expect(indexMargins(INDEX)).toHaveLength(1);
    expect(indexMargins(INDEX).join(' ')).not.toContain('correction');
  });
});

describe('the Home rows', () => {
  it('writes the next payment as the premium and the day', () => {
    expect(nextPaymentLine(POLICY, formatDay)).toBe('0.85 on 5 October');
  });

  it('falls back to the premium alone when nothing is due', () => {
    expect(nextPaymentLine({ ...POLICY, next_payment_due: null }, formatDay)).toBe('0.85');
  });
});

describe("the Verify screen's copy", () => {
  it('says the deck line in every state that is not a failure', () => {
    for (const state of ['idle', 'waiting', 'verified', 'covered'] as const) {
      expect(verifyCopy(state).line).toBe(
        'One person, one cover. This stops bots and duplicate accounts.',
      );
    }
  });

  it('offers the check, then the way on', () => {
    expect(verifyCopy('idle')).toEqual({
      heading: "Confirm you're a real person.",
      line: 'One person, one cover. This stops bots and duplicate accounts.',
      button: 'Verify with World ID',
    });
    expect(verifyCopy('verified').button).toBe('Continue');
  });

  it('gives the failure both deck sentences and a retry', () => {
    expect(verifyCopy('failed')).toEqual({
      heading: "We couldn't verify you.",
      line: 'Try again, or use a different device.',
      button: 'Try again',
    });
  });

  /**
   * Inside World App the person is already on the only device in the flow, so
   * the half of the line that offers another one goes. docs/DECISIONS.md, T27.
   */
  it('drops the second device inside World App', () => {
    expect(verifyCopy('failed', 'world-app').line).toBe('Try again.');
    expect(verifyCopy('failed', 'browser').line).toBe('Try again, or use a different device.');
  });

  /**
   * The refusal that needed different words: a check of a kind this deployment
   * does not accept. The default line sends a person to try again on a device
   * that returns the same kind every time, so this one names the check to run
   * and its button opens the widget instead of repeating. T42.
   */
  it('names the check to run when the one that came back is of another kind', () => {
    expect(verifyCopy('wrong-check')).toEqual({
      heading: "That check isn't the one we asked for.",
      line: 'Open the World app and run the face check.',
      button: 'Verify with World ID',
    });
  });

  it('has no World app to open inside World App', () => {
    expect(verifyCopy('wrong-check', 'world-app').line).toBe('Run the face check to continue.');
    expect(verifyCopy('wrong-check', 'world-app').heading).toBe(
      "That check isn't the one we asked for.",
    );
  });

  it('leaves the other failure exactly as the deck has it', () => {
    expect(verifyCopy('failed').heading).toBe("We couldn't verify you.");
    expect(verifyCopy('failed').line).toBe('Try again, or use a different device.');
    expect(verifyCopy('failed').button).toBe('Try again');
  });

  it('waits for the World app in a browser and confirms with World ID inside it', () => {
    expect(waitingLine('browser')).toBe('Waiting for the World app');
    expect(waitingLine('world-app')).toBe('Confirming with World ID');
  });

  /**
   * One person, one cover, said as the rule it is. No retry: a second check by
   * the same person would be refused the same way, so the button goes to the
   * cover they already hold.
   */
  it('says the rule to someone who already holds cover, and does not offer a retry', () => {
    const copy = verifyCopy('covered');
    expect(copy.heading).toBe('Covered');
    expect(copy.line).toBe('One person, one cover. This stops bots and duplicate accounts.');
    expect(copy.button).toBe('Cover');
    expect(copy.button).not.toBe('Try again');
  });
});
