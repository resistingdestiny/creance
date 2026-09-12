import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ReturnSplitBar, type ReturnSplitFigures } from '../src/components/return-split.js';
import { returnSplit } from '@creance/index-model/src/pricing.js';

/**
 * The bar that replaced the paragraph.
 *
 * Where a return comes from was six lines of prose on a phone carrying three
 * numbers, and it is a shape now. These are about the two things a shape can
 * get wrong that a sentence cannot: a segment drawn at a width its figure does
 * not justify, and a part that stops being legible because it is a colour
 * rather than a word.
 *
 * The figures are `returnSplit`'s, so what the bar draws is checkable against
 * the arithmetic the product prices with rather than against a number somebody
 * typed into a test.
 */

/** Everything a person reads, with the markup taken out. */
function visible(markup: string): string {
  return markup
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** Every segment width the bar drew, left to right, as the numbers in them. */
function widths(markup: string): number[] {
  return [...markup.matchAll(/width:([0-9.]+)%/g)].map((match) => Number(match[1]));
}

/** The demo series' own split: 86,000 of 100,000 written at 11.8 percent. */
const LIVE = returnSplit(0.118, 86_000, 100_000, 0.0065) as ReturnSplitFigures;

describe('the return split bar', () => {
  it('draws the parts at the widths their figures give', () => {
    const drawn = widths(renderToStaticMarkup(<ReturnSplitBar split={LIVE} />));
    const gross = LIVE.base + LIVE.premium;
    expect(drawn).toHaveLength(3);
    // Implied, then what premiums add, then what losses take off the end. The
    // boundary between the second and the third is the total.
    expect(drawn[0]).toBeCloseTo((LIVE.base / gross) * 100, 2);
    expect(drawn[0]! + drawn[1]!).toBeCloseTo((LIVE.total / gross) * 100, 2);
    expect(drawn[2]).toBeCloseTo(((gross - LIVE.total) / gross) * 100, 2);
  });

  it('says implied on the part this deployment does not earn, and never earned', () => {
    const text = visible(renderToStaticMarkup(<ReturnSplitBar split={LIVE} />));
    expect(text).toContain('implied, from tokenised treasuries');
    expect(text).not.toMatch(/\bearns?\b/i);
    expect(text).not.toMatch(/\byields\b/i);
  });

  it('sets the parts out as arithmetic that adds up on the page', () => {
    const text = visible(renderToStaticMarkup(<ReturnSplitBar split={LIVE} />));
    // 11.8 percent on 86,000 of 100,000 is 10.15 of premium over principal.
    expect(text).toContain('10.15 from premiums');
    expect(text).toContain('-0.56 expected losses');
    // 4.00 + 10.15 - 0.56, which is what `returnSplit` returned and not a sum
    // this component worked out for itself.
    expect(text).toContain("13.59 percent a year, at today's capacity");
    expect(LIVE.total * 100).toBeCloseTo(13.59, 2);
  });

  it('lines the figures up on the point, because a ragged column is not a ledger', () => {
    const text = visible(renderToStaticMarkup(<ReturnSplitBar split={LIVE} />));
    // The implied yield is four percent exactly and prints as 4 everywhere it
    // stands in a sentence. In a column that adds up it keeps its zeros.
    expect(text).toContain('4.00 implied');
  });

  it('says an unwritten pool is unwritten rather than drawing it as a poor return', () => {
    const empty = returnSplit(0.1355, 0, 100_000, 0.0065) as ReturnSplitFigures;
    const markup = renderToStaticMarkup(<ReturnSplitBar split={empty} />);
    const text = visible(markup);
    expect(text).toContain('0.00 from premiums, no cover bought yet');
    // The whole of the total is the implied part, and the total row says so
    // rather than reading as four percent a year somebody is being paid.
    expect(text).toContain('4.00 percent a year, all of it implied');
    // Nothing has been written, so nothing can be lost, and a losses row at
    // nought would be a row about an exposure that does not exist.
    expect(text).not.toContain('expected losses');
    // All implied and no earned, which is exactly what the bar has to show.
    expect(widths(markup)).toEqual([100, 0, 0]);
  });

  it('draws no bar at all rather than a misleading one where there is no gross', () => {
    const nothing: ReturnSplitFigures = { base: 0, premium: 0, loss: 0, total: 0 };
    const markup = renderToStaticMarkup(<ReturnSplitBar split={nothing} />);
    expect(widths(markup)).toEqual([]);
    // The ledger still carries every figure it was handed.
    expect(visible(markup)).toContain('0.00 implied, from tokenised treasuries');
  });

  it('holds the drawing inside the bar when losses swallow the whole gross', () => {
    const wiped: ReturnSplitFigures = { base: 0.04, premium: 0.01, loss: 0.09, total: -0.04 };
    const drawn = widths(renderToStaticMarkup(<ReturnSplitBar split={wiped} />));
    expect(drawn).toEqual([0, 0, 100]);
    expect(visible(renderToStaticMarkup(<ReturnSplitBar split={wiped} />))).toContain(
      '-9.00 expected losses',
    );
  });

  it('stands on either ground, and on neither does it carry a dash it should not', () => {
    for (const tone of ['light', 'night'] as const) {
      const markup = renderToStaticMarkup(<ReturnSplitBar split={LIVE} tone={tone} />);
      expect(visible(markup)).not.toMatch(/[–—%]/);
      expect(markup).toContain('repeating-linear-gradient');
    }
    expect(renderToStaticMarkup(<ReturnSplitBar split={LIVE} tone="night" />)).toContain(
      'text-white',
    );
    expect(renderToStaticMarkup(<ReturnSplitBar split={LIVE} tone="light" />)).toContain('bg-ink');
  });
});
