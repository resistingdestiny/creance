import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { InvestorBand } from '../src/components/landing/investor-band.js';
import { rankByDistance } from '../src/lib/explorer-model.js';
import { pricedRange, type InvestorBandView } from '../src/lib/investor-band.js';
import { EXPLORER_UTILISATION, explorerData } from './explorer-fixtures.js';

/**
 * The investor band on the front door.
 *
 * Most of these are about what the band may not say. It stands on a marketing
 * page, it is about money, and the two failures that matter are stating a
 * return it has not got and stating the implied base yield as earned. The
 * product holds its collateral in a vault on Hedera testnet and deploys none of
 * it, so the second would be false everywhere it appeared.
 *
 * The figures are the recorded round the explorer tests draw from, priced
 * through the same functions the market board prices with, so the range on this
 * band is checkable against the same inputs rather than against a number
 * somebody typed.
 */

/** A view with every figure in it, from the same shapes the reads produce. */
function view(patch: Partial<InvestorBandView> = {}): InvestorBandView {
  return {
    priced: { low: 6.26, high: 12.46, count: 15 },
    split: { base: 0.04, premium: 0.0341, loss: 0.0019, total: 0.0722 },
    capacity: 88.5,
    note: {
      label: 'ODI-COMP-2026-01',
      hashscan: 'https://hashscan.io/testnet/contract/0.0.10368240',
    },
    ...patch,
  };
}

/** Everything a person reads, with the markup taken out. */
function visible(markup: string): string {
  return markup
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function render(props: Parameters<typeof InvestorBand>[0] = {}): string {
  return renderToStaticMarkup(<InvestorBand {...props} />);
}

describe('the investor band', () => {
  it('is not rendered at all when the page has nothing to pass', () => {
    expect(render()).toBe('');
    expect(render({ view: null })).toBe('');
  });

  it('carries the proposition and the way in with no read at all', () => {
    const text = visible(render({ view: view() }));
    expect(text).toContain('See exactly what you are funding');
    expect(text).toContain('Earn yield');
    expect(render({ view: view() })).toContain('href="/invest"');
  });

  it('prints the three figures it was handed', () => {
    const text = visible(render({ view: view() }));
    expect(text).toContain('15 occupations to choose between');
    expect(text).toContain('6.26 to 12.46 percent a year, what cover on them is priced at');
    expect(text).toContain('88.5 percent of the capital behind ODI-COMP-2026-01');
  });

  it('promises no coupon, because that belongs to the closing band', () => {
    const text = visible(render({ view: view() }));
    expect(text).not.toContain('paid monthly');
    // The only total it shows is the one the split adds up to, and it carries
    // the clause that makes it today's figure rather than a ceiling.
    expect(text).toContain("at today's capacity");
  });

  it('draws where the return comes from rather than narrating it', () => {
    const markup = render({ view: view() });
    const text = visible(markup);
    // The four figures of the split, as figures. Three parts and the sum they
    // make, which is what a bar of parts needs to be readable.
    expect(text).toContain('Where the return comes from');
    expect(text).toContain('4.00 implied, from tokenised treasuries');
    expect(text).toContain('3.41 from premiums');
    expect(text).toContain('-0.19 expected losses');
    expect(text).toContain("7.22 percent a year, at today's capacity");
    // And the bar itself, segment by segment, at the widths those figures give.
    expect(markup).toContain('data-testid="return-split"');
    expect(markup).toContain('repeating-linear-gradient');
  });

  it('never states the implied base yield as earned', () => {
    const text = visible(render({ view: view() }));
    // "Implied" is the whole of the claim made about that part, and it is on
    // the part itself rather than in a sentence somewhere under the figure.
    expect(text).toContain('implied, from tokenised treasuries');
    expect(text).not.toContain('earns');
    expect(text).not.toContain('yields');
    expect(text).not.toContain('earned from');
  });

  it('says an unwritten pool is unwritten rather than pricing it as a bad return', () => {
    const text = visible(
      render({ view: view({ split: { base: 0.04, premium: 0, loss: 0, total: 0.04 } }) }),
    );
    // Nought from premiums is not a poor return and the row says which. The
    // losses row is absent, because there is no exposure to lose on.
    expect(text).toContain('0.00 from premiums, no cover bought yet');
    expect(text).toContain('4.00 percent a year, all of it implied');
    expect(text).not.toContain('expected losses');
  });

  it('links the note itself, so the claim can be checked', () => {
    const markup = render({ view: view() });
    expect(markup).toContain('https://hashscan.io/testnet/contract/0.0.10368240');
    expect(visible(markup)).toContain('Check the note on Hedera');
  });

  it('drops a figure it could not read rather than standing it at nought', () => {
    const text = visible(render({ view: view({ capacity: null, priced: null }) }));
    expect(text).not.toContain('0 percent of the capital');
    expect(text).not.toContain('occupations to choose between');
    // The proposition and the way in survive every read failing.
    expect(text).toContain('See exactly what you are funding');
  });

  it('says nothing at all about a series whose note has no link', () => {
    const markup = render({ view: view({ note: { label: 'ODI-COMP-2026-01', hashscan: null } }) });
    expect(visible(markup)).not.toContain('Check the note on Hedera');
  });

  it('carries no em dash, no en dash and no percent glyph', () => {
    expect(visible(render({ view: view() }))).not.toMatch(/[–—%]/);
  });
});

describe('what cover across the occupations is priced at', () => {
  it('prices every occupation with a series and a reading, and no other', () => {
    const round = explorerData();
    const priced = pricedRange(rankByDistance(round.occupations), EXPLORER_UTILISATION);
    const withSeries = round.occupations.filter(
      (occupation) => occupation.seriesId !== null && occupation.months.at(-1)?.value !== null,
    );
    expect(priced?.count).toBe(withSeries.length);
    expect(priced!.low).toBeLessThanOrEqual(priced!.high);
    // The floor is the capital charge, which is what a policy cannot be sold
    // below, so no occupation can be priced under it.
    expect(priced!.low).toBeGreaterThan(4);
  });

  it('has nothing to say about a round with no readings in it', () => {
    expect(pricedRange([], EXPLORER_UTILISATION)).toBeNull();
  });
});
