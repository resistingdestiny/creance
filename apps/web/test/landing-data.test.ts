import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What the front door costs, and what it costs a hundred times.
 *
 * The reading and the quote behind the landing page are x402 gated, so each one
 * settles on Hedera before the API answers and each one is money and seconds.
 * The assertions here are therefore about how many calls a page view makes, not
 * about what they return: the figures themselves are landing.test.tsx's, from
 * the recorded readings the whole suite shares.
 *
 * The explorer's round is stubbed rather than counted here. It has a hold of
 * its own with a test of its own, explorer-data.test.ts, and the landing asks
 * that module for the round rather than buying a sixteenth reading.
 */

const fetchIndex = vi.fn();
const fetchIndexCatalogue = vi.fn();
const requestQuote = vi.fn();
const fetchSeries = vi.fn();
const fetchSeriesList = vi.fn();
const fetchCoupons = vi.fn();
const readExplorer = vi.fn();
const readExplorerIndex = vi.fn();
const fetchAllBands = vi.fn();
const fetchReplay = vi.fn();

vi.mock('../src/lib/worker-api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/worker-api.js')>()),
  fetchIndex: (...args: unknown[]) => fetchIndex(...args),
  fetchIndexCatalogue: () => fetchIndexCatalogue(),
  requestQuote: (...args: unknown[]) => requestQuote(...args),
  fetchAllBands: () => fetchAllBands(),
}));

vi.mock('../src/lib/investor-api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/investor-api.js')>()),
  fetchSeries: (...args: unknown[]) => fetchSeries(...args),
  fetchSeriesList: () => fetchSeriesList(),
  fetchCoupons: (...args: unknown[]) => fetchCoupons(...args),
}));

vi.mock('../src/lib/explorer-data.js', () => ({
  readExplorer: () => readExplorer(),
  readExplorerIndex: () => readExplorerIndex(),
}));

vi.mock('../src/lib/claim-api.js', () => ({
  fetchReplay: () => fetchReplay(),
}));

const { INDEX, QUOTE } = await import('./worker-fixtures.js');
const { COUPONS, SERIES } = await import('./investor-fixtures.js');
const { EXPLORER_READINGS, EXPLORER_UTILISATION } = await import('./explorer-fixtures.js');
const { LANDING_GROUP } = await import('../src/lib/landing-model.js');
const { forgetReadings } = await import('../src/lib/last-reading.js');
const { forgetFundedBands } = await import('../src/lib/cover-availability.js');
const { findOccupation } = await import('../src/lib/occupations.js');
const { guideRate, marketRate } = await import('@creance/index-model/src/pricing');

/**
 * The round, with the series each occupation has behind it today.
 *
 * The readings were recorded before T39 issued capacity for the other
 * fourteen, so all but one of them carries a null series id and a from price
 * ranked over them would have one candidate. The occupation table is the web
 * app's own record of which group has a series, so it fills them in and the
 * ranking is over the fifteen it is over in production.
 */
const ROUND_READINGS = EXPLORER_READINGS.map((reading) => ({
  ...reading,
  series_id: reading.series_id ?? findOccupation(reading.group)?.series ?? null,
}));

/**
 * The occupation the from price should be quoted for: the cheapest of the
 * fifteen at the cover the page asks about, worked out here from the same two
 * recordings the page reads, so the expectation is derived and not typed.
 */
const CHEAPEST = ROUND_READINGS.filter(
  (reading) => reading.series_id !== null && reading.reading.ebar !== null,
)
  .map((reading) => ({
    group: reading.group,
    rate: marketRate(
      guideRate(Number(reading.trigger.level_line) - Number(reading.reading.ebar)),
      EXPLORER_UTILISATION[reading.group] ?? 0,
    ),
  }))
  .sort((left, right) => left.rate - right.rate)[0]!.group;

/** GET /v1/cover/bands, carrying the exposure and the principal of all fifteen. */
function bandsAnswer() {
  return {
    occupations: Object.entries(EXPLORER_UTILISATION).map(([group, used]) => ({
      group,
      principal_remaining: { amount: '25000000000' },
      active_exposure: { amount: String(Math.round(used * 25_000_000_000)) },
      bands: [],
    })),
  };
}
const {
  QUOTE_LIFE_MS,
  QUOTE_STALE_MS,
  QUOTE_TTL_MS,
  READING_STALE_MS,
  READING_TTL_MS,
  forgetLandingReads,
  readLanding,
} = await import('../src/lib/landing-data.js');

const READING = { ...INDEX, group: LANDING_GROUP };

/** Every figure on one page view, awaited as the page's own boundaries do. */
async function pageView() {
  const data = readLanding();
  const [index, price, explorer, note] = await Promise.all([
    data.index,
    data.price,
    data.explorer,
    data.note,
  ]);
  return { index, price, explorer, note };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  forgetLandingReads();
  forgetReadings();
  fetchIndex.mockReset().mockResolvedValue(READING);
  fetchIndexCatalogue.mockReset().mockResolvedValue({ index: {}, groups: [] });
  requestQuote.mockReset().mockResolvedValue({
    ...QUOTE,
    expires_at: new Date(QUOTE_LIFE_MS).toISOString(),
  });
  fetchSeries.mockReset().mockResolvedValue(SERIES);
  fetchCoupons.mockReset().mockResolvedValue(COUPONS);
  // The coupon line names the head of GET /v1/series rather than a constant,
  // and all three calls sit inside the same hold, so a hundred views buy one
  // of each.
  fetchSeriesList.mockReset().mockResolvedValue({
    network: 'testnet',
    count: 1,
    series: [
      {
        series_id: SERIES.series_id,
        series_key: SERIES.series_key,
        group: SERIES.group,
        matures_at: SERIES.vault.matures_at,
        has_note: true,
        links: {
          self: `/v1/series/${SERIES.series_id}`,
          coupons: `/v1/series/${SERIES.series_id}/coupons`,
        },
      },
    ],
  });
  readExplorer.mockReset().mockResolvedValue({
    occupations: [],
    missing: [],
    utilisation: {},
    provenance: {},
    replayBadge: null,
    readAt: '2026-09-10T00:00:00.000Z',
  });
  // The round the from price ranks the fifteen from. It is the explorer's own,
  // already bought and already held, so ranking them costs nothing.
  readExplorerIndex.mockReset().mockResolvedValue({
    readings: ROUND_READINGS,
    missing: [],
    catalogue: null,
    readAt: '2026-09-10T00:00:00.000Z',
  });
  fetchAllBands.mockReset().mockResolvedValue(bandsAnswer());
  forgetFundedBands();
  fetchReplay.mockReset().mockResolvedValue(null);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('what a hundred page views cost', () => {
  it('is one reading and one quote, however many arrive together', async () => {
    await Promise.all(Array.from({ length: 100 }, () => pageView()));

    expect(fetchIndex).toHaveBeenCalledTimes(1);
    expect(requestQuote).toHaveBeenCalledTimes(1);
    expect(fetchSeries).toHaveBeenCalledTimes(1);
    expect(fetchSeriesList).toHaveBeenCalledTimes(1);
    expect(fetchCoupons).toHaveBeenCalledTimes(1);
    // What ranking all fifteen for the from price costs: one free call to
    // GET /v1/cover/bands, held, and no second paid quote.
    expect(fetchAllBands).toHaveBeenCalledTimes(1);
  });

  it('is one reading and one quote when they arrive one after another', async () => {
    for (let view = 0; view < 100; view += 1) await pageView();

    expect(fetchIndex).toHaveBeenCalledTimes(1);
    expect(requestQuote).toHaveBeenCalledTimes(1);
  });

  it('still prints the price the API quoted, on every one of them', async () => {
    const first = await pageView();
    const hundredth = await pageView();

    expect(first.price.priceLine).toBe('From 4.25 a month');
    expect(hundredth.price).toStrictEqual(first.price);
  });
});

describe('a figure that has gone stale', () => {
  it('does not put the visitor who finds it behind a settlement', async () => {
    await pageView();
    requestQuote.mockResolvedValue({
      ...QUOTE,
      premium: { ...QUOTE.premium, amount: '9990000' },
    });

    // The first visitor past the TTL is served the price the one before them
    // was served, and the new quote is taken behind them.
    vi.setSystemTime(QUOTE_TTL_MS);
    const first = await pageView();
    expect(first.price.priceLine).toBe('From 4.25 a month');

    const next = await pageView();
    expect(next.price.priceLine).toBe('From 9.99 a month');
    expect(requestQuote).toHaveBeenCalledTimes(2);
  });

  it('is bought again once it is older than both windows', async () => {
    await pageView();

    vi.setSystemTime(READING_TTL_MS + READING_STALE_MS);
    await pageView();

    expect(fetchIndex).toHaveBeenCalledTimes(2);
  });
});

describe('the from price is a quote and never a figure from memory', () => {
  it('is never held past the life the API gives it', () => {
    expect(QUOTE_TTL_MS + QUOTE_STALE_MS).toBeLessThan(QUOTE_LIFE_MS);
  });

  it('is dropped rather than printed once the quote the API gave has expired', async () => {
    requestQuote.mockResolvedValue({ ...QUOTE, expires_at: new Date(-1).toISOString() });

    const { price } = await pageView();

    expect(price.priceLine).toBeNull();
  });

  it('is the quote endpoint every time, never a number this app kept', async () => {
    await pageView();

    expect(requestQuote).toHaveBeenCalledWith({
      group: CHEAPEST,
      limit: '1000000000',
      wallet: expect.any(String),
    });
  });

  it('quotes the cheapest of the fifteen, which is what makes "From" true', async () => {
    // It used to quote LANDING_GROUP, which carries most of the exposure in
    // the product and is the second dearest of the fifteen. That was within
    // pennies of the floor while every occupation sat on it and became a
    // hundred percent overstatement once utilisation dominated the price.
    await pageView();

    expect(CHEAPEST).not.toBe(LANDING_GROUP);
    expect(requestQuote.mock.calls[0]?.[0]).toMatchObject({ group: CHEAPEST });
  });

  it('leaves the line out rather than naming a floor it could not rank', async () => {
    readExplorerIndex.mockRejectedValue(new Error('no round'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const { price } = await pageView();

    expect(price.priceLine).toBeNull();
    expect(requestQuote).not.toHaveBeenCalled();
  });
});

describe('a call that fails costs the page its figure and never the page', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('leaves the price line out rather than naming an amount nobody quoted', async () => {
    requestQuote.mockRejectedValue(new Error('no answer'));

    const { price } = await pageView();

    expect(price.priceLine).toBeNull();
  });

  it('shows the last reading this process published when the feed stops answering', async () => {
    await pageView();
    fetchIndex.mockRejectedValue(new Error('no answer'));

    vi.setSystemTime(READING_TTL_MS + READING_STALE_MS);
    const { index } = await pageView();

    expect(index.live).toBe(false);
    expect(index.note).toContain('This is the last reading we published, for July 2026.');
    expect(index.payLine).toContain('a sudden jump of 2 points above trend');
    expect(index.payLine).toContain('staying within 0.68 points of average');
  });

  it('says there is no reading at all when this process has never had one', async () => {
    fetchIndex.mockRejectedValue(new Error('no answer'));

    const { index } = await pageView();

    expect(index.live).toBe(false);
    expect(index.note).toBe('The live feed is not answering, so there is no reading to show.');
  });

  it('renders every figure it can when the API is unreachable altogether', async () => {
    fetchIndex.mockRejectedValue(new Error('no answer'));
    fetchIndexCatalogue.mockRejectedValue(new Error('no answer'));
    requestQuote.mockRejectedValue(new Error('no answer'));
    fetchSeries.mockRejectedValue(new Error('no answer'));
    readExplorer.mockRejectedValue(new Error('no answer'));
    fetchReplay.mockResolvedValue(null);

    const { index, price, explorer, note } = await pageView();

    expect(index.note).toBe('The live feed is not answering, so there is no reading to show.');
    expect(index.payLine).toContain('The live feed is not answering');
    expect(index.history).toBeNull();
    expect(price.priceLine).toBeNull();
    expect(explorer.round).toBeNull();
    expect(explorer.ticker).toEqual([]);
    expect(explorer.replayBadge).toBeNull();
    expect(note.investorLine).toBe('Investors fund the cover and earn the premiums monthly.');
    expect(note.figures).toEqual([]);
  });

  it('loses the figures with the coupons, and keeps the rate', async () => {
    // The rate is on the series and the receipts are on the coupons route.
    // One hold reads both, so a coupons route that fails takes the whole note
    // with it: the page never prints a rate it read beside figures it could not.
    fetchCoupons.mockRejectedValue(new Error('no answer'));

    const { note } = await pageView();

    expect(note.figures).toEqual([]);
    expect(note.investorLine).toBe('Investors fund the cover and earn the premiums monthly.');
  });
});

describe('the replay badge', () => {
  it('is asked for again when the round it usually travels with is gone', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    readExplorer.mockRejectedValue(new Error('no answer'));

    await pageView();
    await pageView();

    expect(fetchReplay).toHaveBeenCalledTimes(2);
  });
});

describe('the figures under the hero', () => {
  it('come from the same reads the page already makes, and from no new one', async () => {
    const { index, note } = await pageView();

    // The principal is every occupation's, summed from the capacity read the
    // picker already makes, not this one note's.
    expect(note.figures.map((figure) => figure.value)).toStrictEqual(['3', '1,994.52', '375,000']);
    expect(index.history).toStrictEqual({ value: '16', label: 'years of index history' });
    expect(fetchIndex).toHaveBeenCalledTimes(1);
    expect(fetchCoupons).toHaveBeenCalledTimes(1);
  });
});
