import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { BoardView } from '../src/app/invest/board-data.js';
import { MarketBoard } from '../src/app/invest/market-board.js';
import { RateHistorySection } from '../src/app/invest/rate-history.js';
import { RateChart } from '../src/components/rate-chart.js';
import { rankByDistance, type ExplorerMonth } from '../src/lib/explorer-model.js';
import type {
  CouponsView,
  OfferView,
  OrderBookView,
  SeriesListEntry,
} from '../src/lib/investor-api.js';
import {
  latestRate,
  marketRow,
  rateDomain,
  rateHistory,
  rateRange,
  rateRangeCaption,
  seriesRealised,
  MIN_RATE_SPAN,
  RATE_BOUNDS,
  type RatePoint,
} from '../src/lib/investor-model.js';
import { demoInvestorAccount } from '../src/lib/wallet.js';

import { riskCharge } from '@creance/index-model/src/pricing';

import { COUPONS, INVESTOR_1, INVESTOR_2, SERIES, money } from './investor-fixtures.js';

/**
 * The rate history, which is the one thing on the investor screens that is
 * computed over a whole published series rather than read off one reading.
 *
 * The tests that matter here are the ones about honesty rather than about
 * arithmetic. Every rate has to come out of the product's own `riskCharge` over
 * the product's own published distance, a month the feed never published has
 * to be a hole in the line and never a number, and a series that has paid
 * nothing and traded nothing has to say so in words rather than print nought.
 */

/** A month as the feed serves it, with only the fields the rate history reads. */
function month(period: string, distance: number | null): ExplorerMonth {
  return {
    period,
    value: distance === null ? null : 1 - distance,
    distance,
    open: distance !== null && distance <= 0,
    rate: null,
    allRate: null,
    excess: null,
    smoothed: null,
  };
}

/** Everything a person reads, with the markup taken out. */
function visibleText(markup: string): string {
  return markup
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

describe('the risk charge month by month', () => {
  it('is the published pricing over the published distance and nothing else', () => {
    const points = rateHistory([month('2026-06', 0.3), month('2026-07', 1.2)]);
    expect(points).toEqual([
      { period: '2026-06', value: riskCharge(0.3) * 100 },
      { period: '2026-07', value: riskCharge(1.2) * 100 },
    ]);
  });

  it('floors the distance at the line rather than extrapolating past it', () => {
    const past = rateHistory([month('2026-07', -0.8)])[0];
    expect(past?.value).toBe(riskCharge(0) * 100);
  });

  /**
   * The live feed runs May 2021 to July 2026 with October, November and
   * December 2025 never collected, and it omits those months rather than
   * sending them empty. Drawn from the array as it arrives they would be one
   * straight segment across a quarter nobody published.
   */
  it('turns a quarter the feed never published into a hole in the line', () => {
    const points = rateHistory([
      month('2025-08', 1),
      month('2025-09', 1),
      month('2026-01', 1),
    ]);
    expect(points.map((point) => point.period)).toEqual([
      '2025-08',
      '2025-09',
      '2025-10',
      '2025-11',
      '2025-12',
      '2026-01',
    ]);
    expect(points.filter((point) => point.value === null).map((point) => point.period)).toEqual([
      '2025-10',
      '2025-11',
      '2025-12',
    ]);
  });

  it('carries a month the feed sent with no reading through as the same hole', () => {
    expect(rateHistory([month('2026-06', null), month('2026-07', 1)])[0]?.value).toBeNull();
  });

  it('crosses a year end without inventing a month', () => {
    const points = rateHistory([month('2025-11', 1), month('2026-02', 1)]);
    expect(points.map((point) => point.period)).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
    ]);
  });

  it('has nothing to say about an occupation with no months', () => {
    expect(rateHistory([])).toEqual([]);
    expect(latestRate([])).toBeNull();
  });

  it('reads the newest month that has a rate, not the newest month', () => {
    const points = rateHistory([month('2026-06', 1), month('2026-07', null)]);
    expect(latestRate(points)?.period).toBe('2026-06');
  });
});

describe('the scale the histories are drawn against', () => {
  const quiet = rateHistory([month('2026-06', 3), month('2026-07', 3)]);
  const moved = rateHistory([month('2026-06', 3), month('2026-07', 0)]);

  it('spans every series it is given, so a column of them is a comparison', () => {
    const across = rateRange([quiet, moved]);
    expect(across?.low).toBeCloseTo(riskCharge(3) * 100, 10);
    expect(across?.high).toBeCloseTo(riskCharge(0) * 100, 10);
  });

  /**
   * The bounds every rate chart is drawn against. They have to be the whole
   * range the pricing can produce, or a chart clips a real reading off the top.
   */
  it('bounds every rate the pricing can produce', () => {
    for (const distance of [0, 0.05, 0.3, 1, 2.5, 6, 40]) {
      const rate = riskCharge(distance) * 100;
      expect(rate).toBeGreaterThanOrEqual(RATE_BOUNDS.low - 1e-9);
      expect(rate).toBeLessThanOrEqual(RATE_BOUNDS.high + 1e-9);
    }
  });

  /**
   * Thirteen of the fifteen occupations sit where the fitted hazard is flat,
   * and five years of thousandths of a point scaled to themselves would draw a
   * mountain over an occupation whose rate never moved. Against the bounds it
   * draws flat, which is what happened.
   */
  it('leaves a rate that barely moved flat rather than magnifying it', () => {
    const barely = rateHistory([month('2026-05', 4), month('2026-06', 6), month('2026-07', 5)]);
    const markup = renderToStaticMarkup(
      <RateChart
        height={20}
        high={RATE_BOUNDS.high}
        low={RATE_BOUNDS.low}
        points={barely}
        width={72}
      />,
    );
    const ys = [...markup.matchAll(/[ML][\d.]+ ([\d.]+)/g)].map((match) => Number(match[1]));
    expect(ys).toHaveLength(3);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(0.5);
  });

  it('is nothing where nothing was read', () => {
    expect(rateRange([])).toBeNull();
    expect(rateRange([[{ period: '2026-07', value: null }]])).toBeNull();
  });

  it('says a rate that never moved once rather than twice with a "to" in it', () => {
    expect(rateRangeCaption(rateRange([quiet]))).toBe('0.61 percent a year throughout');
  });

  it('words a range as the two ends of it, a year', () => {
    expect(rateRangeCaption(rateRange([moved]))).toBe('0.61 to 8.6 percent a year');
  });
});

describe('what the chart draws', () => {
  const points: readonly RatePoint[] = [
    { period: '2026-01', value: 1 },
    { period: '2026-02', value: 2 },
    { period: '2026-03', value: null },
    { period: '2026-04', value: 3 },
    { period: '2026-05', value: 4 },
  ];

  it('breaks the line at a month with no reading rather than bridging it', () => {
    const markup = renderToStaticMarkup(
      <RateChart height={20} high={4} low={1} points={points} width={72} />,
    );
    expect(markup.match(/data-testid="rate-chart-line"/g)).toHaveLength(2);
  });

  it('draws a lone reading as a dot, which a zero length path would not paint', () => {
    const markup = renderToStaticMarkup(
      <RateChart
        height={20}
        high={4}
        low={1}
        points={[
          { period: '2026-01', value: 2 },
          { period: '2026-02', value: null },
        ]}
        width={72}
      />,
    );
    expect(markup).toContain('data-testid="rate-chart-point"');
  });

  /**
   * The whole reason the domain is a prop. Two series handed the same bounds
   * have to draw at the heights those bounds put them at, or a column of them
   * says two occupations moved alike when one of them never moved.
   */
  it('puts two series on one ruler when it is handed one', () => {
    const flat = [
      { period: '2026-01', value: 1 },
      { period: '2026-02', value: 1 },
    ];
    const low = renderToStaticMarkup(
      <RateChart height={20} high={9} low={1} points={flat} width={72} />,
    );
    const own = renderToStaticMarkup(
      <RateChart height={20} high={1} low={1} points={flat} width={72} />,
    );
    expect(low).not.toBe(own);
  });

  it('is hidden from a reader who is not looking at it unless it is named', () => {
    const bare = renderToStaticMarkup(
      <RateChart height={20} high={4} low={1} points={points} width={72} />,
    );
    expect(bare).toContain('aria-hidden="true"');
    const named = renderToStaticMarkup(
      <RateChart height={20} high={4} label="Risk charge" low={1} points={points} width={72} />,
    );
    expect(named).toContain('aria-label="Risk charge"');
    expect(named).not.toContain('aria-hidden');
  });

  it('draws nothing at all where there is nothing to draw', () => {
    expect(
      renderToStaticMarkup(<RateChart height={20} high={1} low={1} points={[]} width={72} />),
    ).toBe('');
  });
});

/** A filled offer on the series, as the market route answers with one. */
function filled(price: string, closedAt: string): OfferView {
  return {
    offer_id: '3',
    status: 'filled',
    series_id: 'ODI-COMP-2026-01',
    series_key: '0x4f44492d434f4d502d323032362d303100000000000000000000000000000000',
    group: 'computer_math',
    note: {
      address: '0x508ef4e5639e99f76F74ec56B488Ebaec78ABb75',
      contract_id: '0.0.10455865',
      symbol: 'CDBN02',
      decimals: 6,
      hashscan: 'https://hashscan.io/testnet/contract/0.0.10455865',
    },
    seller: {
      role: 'investor-2',
      account_id: '0.0.10366462',
      address: INVESTOR_2,
      hashscan: 'https://hashscan.io/testnet/account/0.0.10366462',
    },
    buyer: null,
    units: '1000000',
    units_whole: '1',
    price: money(price),
    price_per_unit: money(price),
    opened_at: '2026-09-12T07:33:42Z',
    closed_at: closedAt,
    readiness: null,
    buyer_eligibility: null,
    hashscan: 'https://hashscan.io/testnet/contract/0.0.10495570',
  };
}

function book(offers: readonly OfferView[]): OrderBookView {
  return {
    network: 'testnet',
    market: {
      address: '0xe0c2b9e65AB57Bb8b86E0fd152C56Cf9499B6FCf',
      contract_id: '0.0.10495570',
      hashscan: 'https://hashscan.io/testnet/contract/0.0.10495570',
    },
    settlement_asset: {
      token_id: '0.0.10366463',
      address: '0x00000000000000000000000000000000009e2dff',
      decimals: 6,
      symbol: 'TUSD',
    },
    offers,
    counts: { total: offers.length, open: 0, filled: offers.length, cancelled: 0 },
  };
}

const NOTHING: CouponsView = { ...COUPONS, coupons: [] };

describe('what has actually been paid and actually been traded', () => {
  it('totals every settled coupon across every holder, and dates the newest', () => {
    const realised = seriesRealised(COUPONS, null, 'ODI-COMP-2026-01');
    // Three coupons to two holders: 328.767123 twice, 339.726027 twice and
    // 328.767123 twice, which is what settled on testnet. At the asset's own
    // precision, because the coupon table on the same page is a column of
    // those six figures and it has to reach this total.
    expect(realised.paid).toEqual({
      amount: '1,994.520546',
      coupons: 3,
      day: '10 September 2026',
    });
  });

  it('takes the newest fill as what a note last changed hands for', () => {
    const realised = seriesRealised(
      null,
      book([filled('1100000000', '2026-09-12T07:35:12Z'), filled('1000000000', '2026-09-12T07:24:04Z')]),
      'ODI-COMP-2026-01',
    );
    expect(realised.traded).toEqual({ amount: '1,100.00', day: '12 September 2026' });
  });

  it('words an absence rather than printing it as nought', () => {
    const realised = seriesRealised(NOTHING, book([]), 'ODI-COMP-2026-01');
    expect(realised.paid).toBeNull();
    expect(realised.traded).toBeNull();
    expect(realised.nothingYet).toBe('No coupon has settled and no note has changed hands yet.');
  });

  it('names only the half that is missing', () => {
    expect(seriesRealised(COUPONS, book([]), 'ODI-COMP-2026-01').nothingYet).toBe(
      'No note has changed hands yet.',
    );
    expect(
      seriesRealised(NOTHING, book([filled('1000000000', '2026-09-12T07:24:04Z')]), 'ODI-COMP-2026-01')
        .nothingYet,
    ).toBe('No coupon has settled yet.');
  });

  /**
   * "No coupon has settled" is a fact about the note. A read that failed knows
   * nothing about the note, and the page says so elsewhere.
   */
  it('says nothing at all about a read that failed', () => {
    const realised = seriesRealised(null, null, 'ODI-COMP-2026-01');
    expect(realised.nothingYet).toBeNull();
  });
});

describe('the rate history on a series page', () => {
  const months = [month('2026-05', 3), month('2026-06', 1), month('2026-07', 0.3)];

  function render(patch: { coupons?: CouponsView | null; book?: OrderBookView | null } = {}) {
    return renderToStaticMarkup(
      <RateHistorySection
        coupons={patch.coupons === undefined ? COUPONS : patch.coupons}
        market={{ book: patch.book === undefined ? book([]) : patch.book, positions: null }}
        rates={rateHistory(months)}
        seriesId="ODI-COMP-2026-01"
      />,
    );
  }

  it('says what the line is and refuses the words that would make it a lie', () => {
    const text = visibleText(render());
    expect(text).toContain('Rate history');
    expect(text).toContain('It is the risk half of the price, not a traded price.');
    expect(text.toLowerCase()).not.toContain('price history');
  });

  it('ends on the newest month, in the pricing the board prices from', () => {
    expect(visibleText(render())).toContain(`Risk charge, July 2026`);
    expect(visibleText(render())).toContain(
      `${String(Number((riskCharge(0.3) * 100).toFixed(2)))} percent a year`,
    );
  });

  it('carries the real coupons beside the line rather than on it', () => {
    const text = visibleText(render());
    expect(text).toContain('Paid to noteholders');
    expect(text).toContain('1,994.52');
    expect(text).toContain('3 coupons, last on 10 September 2026');
  });

  it('marks a fill at what it actually went for', () => {
    const text = visibleText(render({ book: book([filled('1100000000', '2026-09-12T07:35:12Z')]) }));
    expect(text).toContain('A note last changed hands at');
    expect(text).toContain('1,100.00');
  });

  it('reads as nothing yet on a series that has never paid or traded', () => {
    const text = visibleText(render({ coupons: NOTHING }));
    expect(text).toContain('No coupon has settled and no note has changed hands yet.');
    expect(text).not.toContain('0.00');
  });

  it('draws the line itself', () => {
    expect(render()).toContain('rate-chart-line');
  });

  it('draws no chart where the index round could not be read', () => {
    const markup = renderToStaticMarkup(
      <RateHistorySection
        coupons={NOTHING}
        market={{ book: book([]), positions: null }}
        rates={null}
        seriesId="ODI-COMP-2026-01"
      />,
    );
    expect(markup).not.toContain('rate-chart-line');
    // The heading stays, because the route decided this series has an index
    // behind it before anything was read.
    expect(visibleText(markup)).toContain('Rate history');
  });
});

/** The list row behind a series, which is all the board needs to name it. */
function entry(patch: Partial<SeriesListEntry> = {}): SeriesListEntry {
  return {
    series_id: 'ODI-COMP-2026-01',
    series_key: SERIES.series_key,
    group: 'computer_math',
    kind: 'occupation',
    matures_at: '2027-09-04T18:22:42.000Z',
    has_note: true,
    links: { self: '/v1/series/ODI-COMP-2026-01', coupons: '/v1/series/ODI-COMP-2026-01/coupons' },
    ...patch,
  };
}

/** An occupation with five months behind it, ranked as the board ranks it. */
function ranked(key: string, months: readonly ExplorerMonth[]) {
  return rankByDistance([
    {
      key,
      label: key,
      form: 'level' as const,
      line: 1,
      months,
      seriesId: 'ODI-COMP-2026-01',
      buyable: true,
      everOpened: true,
      margins: { period: '2026-07', level: null, shock: null },
    },
  ])[0]!;
}

function boardOf(): BoardView {
  return {
    rows: [
      marketRow({
        entry: entry(),
        series: SERIES,
        ranked: ranked('computer_math', [month('2026-06', 3), month('2026-07', 0.3)]),
        coupons: COUPONS,
        address: INVESTOR_1,
      }),
      marketRow({
        entry: entry({ series_id: 'ODI-LEGL-2026-01', group: 'legal' }),
        series: SERIES,
        ranked: ranked('legal', [month('2026-06', 3), month('2026-07', 3)]),
        coupons: null,
        address: INVESTOR_1,
      }),
      // The maturity demonstration covers no occupation, so it has no index
      // behind it and no history to draw.
      marketRow({
        entry: entry({ series_id: 'ODI-MAT-1', group: '', kind: 'maturity_demonstration' }),
        series: null,
        ranked: null,
        coupons: null,
        address: INVESTOR_1,
      }),
    ],
    provenance: {
      source: 'US Bureau of Labor Statistics, Current Population Survey',
      asOf: '2026-07',
      from: '2026-06',
      to: '2026-07',
      months: 2,
      topicId: '0.0.10366470',
      hashscan: 'https://hashscan.io/testnet/topic/0.0.10366470',
      seriesHash: null,
      published: 15,
      groups: 15,
      deepest: null,
    },
    missing: [],
    holdings: [],
    settlementBalance: null,
    market: null,
    counts: null,
    forSale: [],
    vault: null,
    coverPool: null,
  };
}

describe('the rate history on the board', () => {
  const markup = renderToStaticMarkup(
    <MarketBoard
      board={boardOf()}
      direction="asc"
      investor={demoInvestorAccount()}
      sort="risk"
    />,
  );

  /**
   * Two occupations carry a reading and the maturity demonstration carries
   * none, so the table draws two lines and the third cell is empty. The same
   * two rows are drawn again above it: the nearer of them at hero size in the
   * band, and the other on the one card behind it. Four lines, and not one of
   * them for a series with nothing published.
   */
  it('gives every occupation with a reading a line, and the rest none', () => {
    expect(markup.match(/data-testid="rate-chart-line"/g)).toHaveLength(4);
  });

  it('heads the column with what it is and never with a traded price', () => {
    const text = visibleText(markup);
    expect(text).toContain('Rate history');
    expect(text.toLowerCase()).not.toContain('price history');
  });

  it('says in the provenance that every row is on one scale', () => {
    expect(visibleText(markup)).toContain(
      'The rate history beside it is the risk charge alone, month by month, every row on one scale.',
    );
  });

  /**
   * A shape cannot be read aloud, so the only access a screen reader has to
   * the cell is its name, and the name has to carry this row's own ends and
   * not the scale every row is drawn against.
   */
  it('names each line with its own high and low', () => {
    expect(markup).toContain('Risk charge, 0.61 percent a year throughout');
    expect(markup).toContain('Risk charge, 0.61 to 2.65 percent a year');
  });

  it('keeps a cell for every heading in the row', () => {
    // `<thead` starts with `<th`, so the boundary matters.
    const headings = markup.match(/<th[ >]/g)?.length ?? 0;
    const firstRow = markup.slice(markup.indexOf('<tbody'), markup.indexOf('</tr>', markup.indexOf('<tbody')));
    expect(firstRow.match(/<td/g)?.length ?? 0).toBe(headings);
  });
});

describe('the domain one chart is drawn over', () => {
  it('is the range the occupation reached, where that range is worth a chart', () => {
    const wide = { low: 0.61, high: 8.6 };
    expect(rateDomain(wide)).toBe(wide);
  });

  it('widens a range too narrow to draw, about its own middle', () => {
    const narrow = rateDomain({ low: 0.612, high: 0.614 });
    expect(narrow!.high - narrow!.low).toBeCloseTo(MIN_RATE_SPAN, 10);
    expect((narrow!.high + narrow!.low) / 2).toBeCloseTo(0.613, 10);
  });

  it('has nothing to draw over where nothing was read', () => {
    expect(rateDomain(null)).toBeNull();
  });
});
