import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { BoardView } from '../src/app/invest/board-data.js';
import { MarketBoard } from '../src/app/invest/market-board.js';
import { rankByDistance, type ExplorerOccupation } from '../src/lib/explorer-model.js';
import type { SeriesListEntry, SeriesView } from '../src/lib/investor-api.js';
import {
  MARKET_SORTS,
  marketDirection,
  marketRow,
  marketSort,
  nextDirection,
  premiumRatePercent,
  sortMarketRows,
  type MarketRow,
} from '../src/lib/investor-model.js';
import { demoInvestorAccount } from '../src/lib/wallet.js';
import { COUPONS, INVESTOR_1, SERIES, money } from './investor-fixtures.js';

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

/**
 * An occupation sitting a stated number of points from its line.
 *
 * The state and the phrase are not written here: the fixture is put through
 * `rankByDistance`, which is the one place in the product that decides what a
 * distance is called, so a test that asserts "0.3 points away" is asserting
 * that the board took the explorer's word for it.
 */
function rankedAt(distance: number, key = 'computer_math') {
  const line = 1;
  const occupation: ExplorerOccupation = {
    key,
    label: key,
    form: 'level',
    line,
    months: [
      {
        period: '2026-07',
        value: line - distance,
        distance,
        open: distance <= 0,
        rate: null,
        allRate: null,
        excess: null,
        smoothed: null,
      },
    ],
    seriesId: 'ODI-COMP-2026-01',
    buyable: true,
    everOpened: true,
    margins: { period: '2026-07', level: null, shock: null },
  };
  return rankByDistance([occupation])[0]!;
}

/** The same series with a share of its principal committed as exposure. */
function committedSeries(exposure: string): SeriesView {
  return {
    ...SERIES,
    cover_pool: { ...SERIES.cover_pool!, active_exposure: money(exposure), registered: true },
  };
}

describe('the price of an occupation', () => {
  it('is the published pricing at the reading and the committed exposure', () => {
    // 100,000 remaining and nothing committed, so the market term is one and
    // the rate is the guide rate for a point from the line.
    expect(premiumRatePercent(SERIES, 1)).toBeCloseTo(0.696_985, 5);
  });

  it('rises with the share of the principal already committed', () => {
    // 86,000 of 100,000 remaining, which is the demo series on testnet.
    expect(premiumRatePercent(committedSeries('86000000000'), 1)).toBeCloseTo(1.296_4, 3);
  });

  it('floors the distance at the line rather than extrapolating past it', () => {
    // The hazard is fitted to buckets that begin at the line and says nothing
    // below zero. An occupation with claims open prices at the line's rate.
    expect(premiumRatePercent(SERIES, -0.5)).toBe(premiumRatePercent(SERIES, 0));
  });

  it('prices nothing without a reading, and nothing without a pool', () => {
    expect(premiumRatePercent(SERIES, null)).toBeNull();
    expect(premiumRatePercent({ ...SERIES, cover_pool: null }, 1)).toBeNull();
  });
});

describe('a row of the board', () => {
  it('composes the three reads into one row', () => {
    const row = marketRow({
      entry: entry(),
      series: SERIES,
      ranked: rankedAt(0.3),
      coupons: COUPONS,
      address: INVESTOR_1,
    });

    expect(row.name).toBe('Computer and mathematical');
    expect(row.gap).toBe('0.3 points away');
    expect(row.state).toBe('watch');
    expect(row.capacityPercent).toBe(0);
    expect(row.funded).toBe(100_000_000_000n);
    expect(row.paid).toBe(0n);
    expect(row.couponPercent).toBe(8);
    expect(row.hashscan).toBe('https://hashscan.io/testnet/contract/0.0.10367194');
    expect(row.position?.units).toBe('50');
    expect(row.position?.earned?.amount).toBe('997.26');
  });

  it('keeps a series the chain could not answer for, and drops its figures', () => {
    const row = marketRow({
      entry: entry(),
      series: null,
      ranked: rankedAt(0.3),
      coupons: null,
      address: INVESTOR_1,
    });

    expect(row.name).toBe('Computer and mathematical');
    expect(row.gap).toBe('0.3 points away');
    expect(row.funded).toBeNull();
    expect(row.paid).toBeNull();
    expect(row.capacityPercent).toBeNull();
    expect(row.premiumPercent).toBeNull();
    expect(row.position).toBeNull();
  });

  it('keeps a series with no published reading, and drops its risk and its price', () => {
    const row = marketRow({
      entry: entry(),
      series: SERIES,
      ranked: null,
      coupons: null,
      address: INVESTOR_1,
    });

    expect(row.funded).toBe(100_000_000_000n);
    expect(row.state).toBeNull();
    expect(row.gap).toBeNull();
    expect(row.premiumPercent).toBeNull();
  });

  it('declares no coupon where the note has declared none', () => {
    const row = marketRow({
      entry: entry(),
      series: { ...SERIES, coupons: { ...SERIES.coupons, rate_percent: null } },
      ranked: null,
      coupons: null,
      address: INVESTOR_1,
    });
    expect(row.couponPercent).toBeNull();
  });

  it('holds no position on a note this account has no balance in', () => {
    const row = marketRow({
      entry: entry(),
      series: SERIES,
      ranked: null,
      coupons: null,
      address: '0x0000000000000000000000000000000000000001',
    });
    expect(row.position).toBeNull();
  });
});

/** Three rows with one figure each, which is all the ordering turns on. */
function rows(): readonly MarketRow[] {
  const base = marketRow({
    entry: entry(),
    series: null,
    ranked: null,
    coupons: null,
    address: INVESTOR_1,
  });
  return [
    { ...base, seriesId: 'a', name: 'Alpha', distance: 0.9, premiumPercent: 1 },
    { ...base, seriesId: 'b', name: 'Beta', distance: 0.2, premiumPercent: 4 },
    { ...base, seriesId: 'c', name: 'Gamma', distance: null, premiumPercent: null },
  ];
}

const names = (ordered: readonly MarketRow[]): string[] =>
  ordered.map((row) => row.name ?? row.seriesId);

describe('putting the board in order', () => {
  it('opens nearest the line first, which is the ranking the explorer uses', () => {
    expect(names(sortMarketRows(rows(), 'risk', 'asc'))).toEqual(['Beta', 'Alpha', 'Gamma']);
  });

  it('sinks a row with nothing to sort by whichever way the column points', () => {
    expect(names(sortMarketRows(rows(), 'risk', 'desc')).at(-1)).toBe('Gamma');
    expect(names(sortMarketRows(rows(), 'premium', 'asc')).at(-1)).toBe('Gamma');
  });

  it('reads the highest figure first when a figure column is pressed', () => {
    expect(names(sortMarketRows(rows(), 'premium', 'desc'))).toEqual(['Beta', 'Alpha', 'Gamma']);
  });

  it('orders by name in English, ties and all', () => {
    expect(names(sortMarketRows(rows(), 'name', 'asc'))).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(names(sortMarketRows(rows(), 'name', 'desc'))).toEqual(['Gamma', 'Beta', 'Alpha']);
  });

  it('falls back to the default order rather than erroring on a query string', () => {
    expect(marketSort(undefined)).toBe('risk');
    expect(marketSort('; drop table')).toBe('risk');
    expect(marketDirection('risk', 'sideways')).toBe('asc');
    expect(marketDirection('premium', undefined)).toBe('desc');
  });

  it('turns the column the board is already in order by, and starts the others at their own', () => {
    expect(nextDirection('risk', 'risk', 'asc')).toBe('desc');
    expect(nextDirection('premium', 'risk', 'asc')).toBe('desc');
    expect(nextDirection('name', 'risk', 'asc')).toBe('asc');
  });
});

/** A board of three occupations, one of them held. */
function board(patch: Partial<BoardView> = {}): BoardView {
  return {
    rows: [
      marketRow({
        entry: entry(),
        series: SERIES,
        ranked: rankedAt(0.3),
        coupons: COUPONS,
        address: INVESTOR_1,
      }),
      marketRow({
        entry: entry({ series_id: 'ODI-LEGL-2026-01', group: 'legal' }),
        series: {
          ...SERIES,
          series_id: 'ODI-LEGL-2026-01',
          coupons: { ...SERIES.coupons, rate_percent: null },
          holders: [],
        },
        ranked: rankedAt(-0.2, 'legal'),
        coupons: null,
        address: INVESTOR_1,
      }),
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
      from: '2021-08',
      to: '2026-07',
      months: 60,
      topicId: '0.0.10366470',
      hashscan: 'https://hashscan.io/testnet/topic/0.0.10366470',
      seriesHash: null,
    },
    missing: [],
    ...patch,
  };
}

function boardMarkup(view: BoardView = board()): string {
  return renderToStaticMarkup(
    <MarketBoard
      board={view}
      direction="asc"
      investor={demoInvestorAccount('investor-1')}
      sort="risk"
    />,
  );
}

describe('the market board', () => {
  it('puts every series on screen at once, named for what it covers', () => {
    const text = visibleText(boardMarkup());
    expect(text).toContain('Computer and mathematical');
    expect(text).toContain('Legal');
    expect(text).toContain('Maturity demonstration');
    expect(text).toContain('ODI-COMP-2026-01');
  });

  it('says how near each occupation is in the words the explorer uses', () => {
    const text = visibleText(boardMarkup());
    expect(text).toContain('0.3 points away');
    expect(text).toContain('claims open');
  });

  it('prints the premium rate and the declared coupon, and nothing where neither exists', () => {
    const text = visibleText(boardMarkup());
    // 0.3 points from the line with nothing committed, and the declared coupon.
    expect(text).toContain('2.65 percent');
    expect(text).toContain('8 percent');
    // The maturity demonstration row was read from neither, so it carries the
    // name and the identifier and no figure at all.
    expect(text).toContain('Maturity demonstration ODI-MAT-1 The principal');
  });

  it('writes percent as a word and uses no dash, as every screen does', () => {
    expect(visibleText(boardMarkup())).not.toMatch(/[\u2013\u2014%]/);
  });

  it('invents no market it cannot read: no book, no bid, no ask, no volume', () => {
    const text = visibleText(boardMarkup()).toLowerCase();
    for (const word of ['order book', 'bid', 'ask', 'volume', 'last traded', 'spread']) {
      expect(text).not.toContain(word);
    }
  });

  it('links every row to its own series and its own vault on HashScan', () => {
    const markup = boardMarkup();
    expect(markup).toContain('href="/invest?series=ODI-COMP-2026-01"');
    expect(markup).toContain('href="https://hashscan.io/testnet/contract/0.0.10367194"');
  });

  it('sorts from the address, so the order can be sent to somebody', () => {
    const markup = boardMarkup();
    expect(markup).toContain('href="/invest?sort=premium&amp;dir=desc"');
    // The column the board is in order by turns round rather than repeating.
    expect(markup).toContain('href="/invest?sort=risk&amp;dir=desc"');
    expect(markup).toContain('aria-sort="ascending"');
  });

  it('shows what this account holds, and only where it holds something', () => {
    const text = visibleText(boardMarkup());
    expect(text).toContain('Your notes');
    expect(text).toContain('997.26');

    const none = visibleText(
      boardMarkup(board({ rows: board().rows.map((row) => ({ ...row, position: null })) })),
    );
    expect(none).not.toContain('Your notes');
  });

  it('says where the readings came from and where the same record is', () => {
    const markup = boardMarkup();
    expect(visibleText(markup)).toContain('July 2026');
    expect(markup).toContain('href="https://hashscan.io/testnet/topic/0.0.10366470"');
  });

  it('says so when the round could not be bought rather than leaving a blank column', () => {
    const text = visibleText(boardMarkup(board({ provenance: null })));
    expect(text).toContain('The index readings could not be read');
  });

  it('offers one order for every column and no more', () => {
    const markup = boardMarkup();
    for (const column of MARKET_SORTS) {
      expect(markup).toContain(`href="/invest?sort=${column}&amp;dir=`);
    }
  });
});
