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
const readExplorer = vi.fn();
const fetchReplay = vi.fn();

vi.mock('../src/lib/worker-api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/worker-api.js')>()),
  fetchIndex: (...args: unknown[]) => fetchIndex(...args),
  fetchIndexCatalogue: () => fetchIndexCatalogue(),
  requestQuote: (...args: unknown[]) => requestQuote(...args),
}));

vi.mock('../src/lib/investor-api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/investor-api.js')>()),
  fetchSeries: (...args: unknown[]) => fetchSeries(...args),
  fetchSeriesList: () => fetchSeriesList(),
}));

vi.mock('../src/lib/explorer-data.js', () => ({
  readExplorer: () => readExplorer(),
}));

vi.mock('../src/lib/claim-api.js', () => ({
  fetchReplay: () => fetchReplay(),
}));

const { INDEX, QUOTE } = await import('./worker-fixtures.js');
const { SERIES } = await import('./investor-fixtures.js');
const { LANDING_GROUP } = await import('../src/lib/landing-model.js');
const { forgetReadings } = await import('../src/lib/last-reading.js');
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
  const [index, price, explorer, investorLine] = await Promise.all([
    data.index,
    data.price,
    data.explorer,
    data.investorLine,
  ]);
  return { index, price, explorer, investorLine };
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
  // The coupon line names the head of GET /v1/series rather than a constant,
  // and both calls sit inside the same hold, so a hundred views buy one of
  // each.
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
    provenance: {},
    replayBadge: null,
    readAt: '2026-09-10T00:00:00.000Z',
  });
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
      group: LANDING_GROUP,
      limit: '1000000000',
      wallet: expect.any(String),
    });
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
    expect(price.costLine).toBe("The price comes from your occupation's index, nothing else.");
  });

  it('shows the last reading this process published when the feed stops answering', async () => {
    await pageView();
    fetchIndex.mockRejectedValue(new Error('no answer'));

    vi.setSystemTime(READING_TTL_MS + READING_STALE_MS);
    const { index } = await pageView();

    expect(index.live).toBe(false);
    expect(index.note).toContain('This is the last reading we published, for July 2026.');
    expect(index.payLine).toContain('2 points above its trend');
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

    const { index, price, explorer, investorLine } = await pageView();

    expect(index.note).toBe('The live feed is not answering, so there is no reading to show.');
    expect(index.payLine).toContain('The live feed is not answering');
    expect(price.priceLine).toBeNull();
    expect(explorer.round).toBeNull();
    expect(explorer.ticker).toEqual([]);
    expect(explorer.replayBadge).toBeNull();
    expect(investorLine).toBe('Investors fund the cover and earn the premiums monthly.');
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
