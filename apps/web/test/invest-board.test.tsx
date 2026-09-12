import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { BoardView } from '../src/app/invest/board-data.js';
import { MarketBoard } from '../src/app/invest/market-board.js';
import { OfferBook } from '../src/app/invest/trading.js';
import { rankByDistance, type ExplorerOccupation } from '../src/lib/explorer-model.js';
import type {
  OfferView,
  OrderBookView,
  SeriesListEntry,
  SeriesView,
} from '../src/lib/investor-api.js';
import {
  MARKET_SORTS,
  marketDirection,
  marketOutcome,
  marketQuotes,
  marketRow,
  marketSort,
  nextDirection,
  offersForSeries,
  premiumRatePercent,
  sortMarketRows,
  takeState,
  type MarketRow,
} from '../src/lib/investor-model.js';
import { demoInvestorAccount } from '../src/lib/wallet.js';
import { COUPONS, INVESTOR_1, INVESTOR_2, SERIES, money } from './investor-fixtures.js';

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
    holdings: [
      {
        seriesId: 'ODI-COMP-2026-01',
        name: 'Computer and mathematical',
        units: '50',
        subscription: { amount: 50_000_000_000n, decimals: 6 },
        earned: { total: 997_260_273n, amount: '997.26', coupons: 3 },
        kycGranted: true,
        offers: [],
      },
    ],
    settlementBalance: {
      amount: '196997260273',
      asset: '0.0.10366463',
      decimals: 6,
      display: '196997.260273',
    },
    market: {
      address: '0xe0c2b9e65AB57Bb8b86E0fd152C56Cf9499B6FCf',
      contract_id: '0.0.10495570',
      hashscan: 'https://hashscan.io/testnet/contract/0.0.10495570',
    },
    counts: { total: 4, open: 1, filled: 3, cancelled: 0 },
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

  it('invents no market it cannot read: no bid, no depth, no volume', () => {
    // The venue holds offers to sell and fills of them. There is no bid side
    // and no depth to read, so none is drawn. A last traded price is not on
    // this list: it is a filled offer, which is a record.
    const text = visibleText(boardMarkup()).toLowerCase();
    for (const word of ['order book', 'bid', 'depth', 'volume', 'spread', 'mid price']) {
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

    const none = visibleText(boardMarkup(board({ holdings: [] })));
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

/**
 * The order book as the venue answered it on 12 September 2026: four offers on
 * ODI-OFFC-2026-01, three of them filled at 1,000, 1,050 and 1,100 a unit and
 * one still open at 1,150. Trimmed to the fields these screens read.
 */
function offer(patch: Partial<OfferView> & { offer_id: string }): OfferView {
  const price = patch.price ?? money('1000000000');
  return {
    status: 'filled',
    series_id: 'ODI-OFFC-2026-01',
    series_key: '0x4f44492d4f4646432d323032362d303100000000000000000000000000000000',
    group: 'office_admin_support',
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
    price,
    price_per_unit: price,
    opened_at: '2026-09-12T07:33:42Z',
    closed_at: '2026-09-12T07:35:12Z',
    readiness: null,
    buyer_eligibility: null,
    hashscan: 'https://hashscan.io/testnet/contract/0.0.10495570',
    ...patch,
  };
}

/** Newest first, which is the order the route answers in. */
function orderBook(offers: readonly OfferView[]): OrderBookView {
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
    counts: {
      total: offers.length,
      open: offers.filter((row) => row.status === 'open').length,
      filled: offers.filter((row) => row.status === 'filled').length,
      cancelled: 0,
    },
  };
}

const BOOK = orderBook([
  offer({ offer_id: '4', status: 'open', price: money('1150000000'), closed_at: null }),
  offer({ offer_id: '3', price: money('1100000000') }),
  offer({
    offer_id: '2',
    units: '2000000',
    units_whole: '2',
    price: money('2100000000'),
    price_per_unit: money('1050000000'),
  }),
  offer({
    offer_id: '1',
    units: '5000000',
    units_whole: '5',
    price: money('5000000000'),
    price_per_unit: money('1000000000'),
  }),
]);

describe('what the market says about a series', () => {
  it('reads the newest fill as what a unit last changed hands for', () => {
    const quote = marketQuotes(BOOK).get('ODI-OFFC-2026-01');
    expect(quote?.lastTraded?.amount).toBe('1100000000');
    expect(quote?.fills).toBe(3);
  });

  it('reads the cheapest open offer as what a unit can be bought for', () => {
    const quote = marketQuotes(BOOK).get('ODI-OFFC-2026-01');
    expect(quote?.bestAsk?.amount).toBe('1150000000');
    expect(quote?.unitsForSale).toBe(1);
  });

  it('says nothing about a series nobody has traded', () => {
    expect(marketQuotes(BOOK).get('ODI-COMP-2026-01')).toBeUndefined();
    expect(marketQuotes(null).size).toBe(0);
  });

  it('puts what can be taken cheapest first and what happened newest first', () => {
    const { open, filled } = offersForSeries(BOOK, 'ODI-OFFC-2026-01');
    expect(open.map((row) => row.offer_id)).toEqual(['4']);
    expect(filled.map((row) => row.offer_id)).toEqual(['3', '2', '1']);
  });
});

describe('whether an offer can be taken', () => {
  const open = offer({ offer_id: '4', status: 'open', closed_at: null });

  it('lets an approved account that is not the seller take it', () => {
    const eligible = {
      ...open,
      buyer_eligibility: { address: INVESTOR_1, role: 'investor-1', kyc_granted: true, reason: null },
    };
    expect(takeState(eligible, INVESTOR_1)).toBe('take');
  });

  it('is the note refusing, not the app, when the register has not approved the buyer', () => {
    const refused = {
      ...open,
      buyer_eligibility: {
        address: INVESTOR_1,
        role: 'investor-1',
        kyc_granted: false,
        reason: 'no kyc',
      },
    };
    expect(takeState(refused, INVESTOR_1)).toBe('blocked');
  });

  it('offers the seller a way out rather than a refusal', () => {
    expect(takeState(open, INVESTOR_2)).toBe('own');
  });

  it('takes nothing that is not open', () => {
    expect(takeState(offer({ offer_id: '3' }), INVESTOR_1)).toBe('closed');
  });
});

describe('what a trade did', () => {
  it('takes only codes it knows how to word', () => {
    expect(marketOutcome('fill_refused')).toBe('fill_refused');
    expect(marketOutcome('<script>')).toBeNull();
    expect(marketOutcome(undefined)).toBeNull();
  });
});

describe('the market on the board', () => {
  function traded(): BoardView {
    const base = board();
    const quotes = marketQuotes(BOOK);
    return {
      ...base,
      rows: base.rows.map((row) =>
        row.seriesId === 'ODI-COMP-2026-01'
          ? { ...row, quote: quotes.get('ODI-OFFC-2026-01') ?? null }
          : row,
      ),
    };
  }

  it('prints what a note last changed hands for and what is on offer now', () => {
    const text = visibleText(boardMarkup(traded()));
    expect(text).toContain('1,100');
    expect(text).toContain('1 for sale at 1,150');
  });

  it('leaves the column empty on a series the venue has never seen', () => {
    const text = visibleText(boardMarkup());
    expect(text).toContain('Last traded');
    expect(text).not.toContain('for sale at');
  });

  it('prints no traded price for a series with an offer standing and no fill behind it', () => {
    // An ask is what somebody wants, a fill is what somebody paid, and the
    // column is the second of the two.
    const asked = orderBook([
      offer({ offer_id: '5', status: 'open', series_id: 'ODI-ARTS-2026-01', closed_at: null }),
    ]);
    const quote = marketQuotes(asked).get('ODI-ARTS-2026-01');
    expect(quote?.lastTraded).toBeNull();
    expect(quote?.bestAsk?.amount).toBe('1000000000');

    const base = board();
    const text = visibleText(
      boardMarkup({
        ...base,
        rows: base.rows.map((row, at) => (at === 0 ? { ...row, quote: quote ?? null } : row)),
      }),
    );
    expect(text).toContain('1 for sale at 1,000');
    expect(text).not.toContain('1,000 1 for sale');
  });

  it("says what a trade just did, in the product's own words and not the wire's", () => {
    const markup = renderToStaticMarkup(
      <MarketBoard
        board={board()}
        direction="asc"
        investor={demoInvestorAccount('investor-1')}
        outcome="fill_refused"
        sort="risk"
      />,
    );
    expect(visibleText(markup)).toContain('The note refused the transfer');
    expect(markup).toContain('data-testid="market-outcome"');
  });

  it('gives a holding a way on to the market and a way off it', () => {
    const withOffer = board({
      holdings: [
        {
          ...board().holdings[0]!,
          seriesId: 'ODI-OFFC-2026-01',
          name: 'Office and administrative support',
          units: '4',
          offers: [offer({ offer_id: '4', status: 'open', price: money('1150000000'), closed_at: null })],
        },
      ],
    });
    const text = visibleText(boardMarkup(withOffer));
    expect(text).toContain('On the market');
    expect(text).toContain('Withdraw');
    expect(text).toContain('Sell');
  });
});

describe('the note refusing a buyer', () => {
  /** Offer 5 as the venue answered it: the operator selling a note the demo
   *  investor is not on the register of. */
  const refused = offer({
    offer_id: '5',
    status: 'open',
    series_id: 'ODI-ARTS-2026-01',
    group: 'arts_design_ent_media',
    closed_at: null,
    readiness: { open: true, seller_holds: true, seller_approved: true },
    buyer_eligibility: {
      address: INVESTOR_1,
      role: 'investor-1',
      kyc_granted: false,
      reason: 'the note holds no granted KYC record for this account',
    },
  });

  function marketMarkup(view: OfferView): string {
    return renderToStaticMarkup(
      <OfferBook
        address={INVESTOR_1}
        book={orderBook([view])}
        held={null}
        seriesId="ODI-ARTS-2026-01"
      />,
    );
  }

  it("warns before the press, in the product's words and not the wire's", () => {
    const text = visibleText(marketMarkup(refused));
    expect(text).toContain('Not approved');
    expect(text).toContain('This note keeps its own register of who may hold it');
    // The API's own reason sentence is never printed.
    expect(text).not.toContain('granted KYC record');
  });

  it('keeps the button, so the note answers rather than this screen guessing', () => {
    const markup = marketMarkup(refused);
    expect(visibleText(markup)).toContain('Take');
    expect(markup).toContain('value="5"');
  });

  it('offers the seller a withdrawal rather than a refusal on its own offer', () => {
    const text = visibleText(marketMarkup({ ...refused, buyer_eligibility: null }));
    expect(text).not.toContain('Not approved');
    expect(text).toContain('Take');
  });
});
