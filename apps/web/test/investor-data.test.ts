import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What the investor page costs, and what it costs a hundred times.
 *
 * The two reads behind it go through the JSON-RPC relay to the mirror node
 * and take up to two seconds each, so the assertions here are about how many
 * calls a page view makes and who waits for them, not about what they return:
 * the figures themselves are investor.test.tsx's, from the recorded responses
 * the whole suite shares.
 */

const fetchSeries = vi.fn();
const fetchCoupons = vi.fn();

vi.mock('../src/lib/investor-api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/investor-api.js')>()),
  fetchSeries: (...args: unknown[]) => fetchSeries(...args),
  fetchCoupons: (...args: unknown[]) => fetchCoupons(...args),
}));

const { COUPONS, SERIES } = await import('./investor-fixtures.js');
const {
  COUPONS_STALE_MS,
  COUPONS_TTL_MS,
  SERIES_STALE_MS,
  SERIES_TTL_MS,
  forgetInvestorReads,
  readInvestor,
} = await import('../src/lib/investor-data.js');

const ID = SERIES.series_id;
const OTHER = 'ODI-OFFC-2026-01';

/** Both figures on one page view, awaited as the screen's own boundaries do. */
async function pageView(id: string = ID) {
  const data = readInvestor(id);
  const [series, coupons] = await Promise.all([data.series, data.coupons]);
  return { series, coupons };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  forgetInvestorReads();
  fetchSeries.mockReset().mockImplementation((id: string) =>
    Promise.resolve({ ...SERIES, series_id: id }),
  );
  fetchCoupons.mockReset().mockImplementation((id: string) =>
    Promise.resolve({ ...COUPONS, series_id: id }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('what a hundred page views cost', () => {
  it('is one series read and one coupon read, however many arrive together', async () => {
    await Promise.all(Array.from({ length: 100 }, () => pageView()));

    expect(fetchSeries).toHaveBeenCalledTimes(1);
    expect(fetchCoupons).toHaveBeenCalledTimes(1);
  });

  it('is one of each when they arrive one after another', async () => {
    for (let view = 0; view < 100; view += 1) await pageView();

    expect(fetchSeries).toHaveBeenCalledTimes(1);
    expect(fetchCoupons).toHaveBeenCalledTimes(1);
  });

  it('is one of each per series id, and never one series under another name', async () => {
    for (let view = 0; view < 50; view += 1) {
      await pageView(ID);
      await pageView(OTHER);
    }

    expect(fetchSeries).toHaveBeenCalledTimes(2);
    expect(fetchCoupons).toHaveBeenCalledTimes(2);
    expect(fetchSeries).toHaveBeenCalledWith(ID);
    expect(fetchSeries).toHaveBeenCalledWith(OTHER);

    const other = await pageView(OTHER);
    expect(other.series?.series_id).toBe(OTHER);
    expect(other.coupons?.series_id).toBe(OTHER);
  });

  it('still prints what the API returned, on every one of them', async () => {
    const first = await pageView();
    const hundredth = await pageView();

    expect(first.series).toStrictEqual({ ...SERIES, series_id: ID });
    expect(first.coupons).toStrictEqual({ ...COUPONS, series_id: ID });
    expect(hundredth.series).toStrictEqual(first.series);
    expect(hundredth.coupons).toStrictEqual(first.coupons);
  });
});

describe('a figure that has gone stale', () => {
  it('does not put the visitor who finds it behind a mirror node read', async () => {
    await pageView();
    fetchSeries.mockResolvedValue({
      ...SERIES,
      vault: { ...SERIES.vault, principal_paid: { ...SERIES.vault.principal_paid, amount: '1' } },
    });

    // The first visitor past the TTL is served the series the one before them
    // was served, and the new read is taken behind them.
    vi.setSystemTime(SERIES_TTL_MS);
    const first = await pageView();
    expect(first.series?.vault.principal_paid.amount).toBe('0');

    const next = await pageView();
    expect(next.series?.vault.principal_paid.amount).toBe('1');
    expect(fetchSeries).toHaveBeenCalledTimes(2);
  });

  it('is served while the refresh behind it is still out', async () => {
    await pageView();
    let answer: (value: unknown) => void = () => {};
    fetchCoupons.mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );

    vi.setSystemTime(COUPONS_TTL_MS + 1);
    const stale = await pageView();
    expect(stale.coupons).toStrictEqual({ ...COUPONS, series_id: ID });
    expect(fetchCoupons).toHaveBeenCalledTimes(2);

    answer({ ...COUPONS, series_id: ID, coupons: [] });
    // The refresh settles into the hold a few microtasks after the answer.
    await vi.advanceTimersByTimeAsync(0);
    const fresh = await pageView();
    expect(fresh.coupons?.coupons).toEqual([]);
  });

  it('is bought again once it is older than both windows', async () => {
    await pageView();

    vi.setSystemTime(Math.max(SERIES_TTL_MS + SERIES_STALE_MS, COUPONS_TTL_MS + COUPONS_STALE_MS));
    await pageView();

    expect(fetchSeries).toHaveBeenCalledTimes(2);
    expect(fetchCoupons).toHaveBeenCalledTimes(2);
  });
});

describe('a call that fails costs the page its figure and never the page', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('leaves the series out and keeps the coupon history', async () => {
    fetchSeries.mockRejectedValue(new Error('no answer'));

    const { series, coupons } = await pageView();

    expect(series).toBeNull();
    expect(coupons).toStrictEqual({ ...COUPONS, series_id: ID });
  });

  it('leaves the coupon history out and keeps the series', async () => {
    fetchCoupons.mockRejectedValue(new Error('no answer'));

    const { series, coupons } = await pageView();

    expect(series).toStrictEqual({ ...SERIES, series_id: ID });
    expect(coupons).toBeNull();
  });

  it('answers with nothing at all when the API is unreachable altogether', async () => {
    fetchSeries.mockRejectedValue(new Error('no answer'));
    fetchCoupons.mockRejectedValue(new Error('no answer'));

    const { series, coupons } = await pageView();

    expect(series).toBeNull();
    expect(coupons).toBeNull();
  });

  it('holds no failure, so the next visitor asks again', async () => {
    fetchSeries.mockRejectedValueOnce(new Error('no answer'));

    const failed = await pageView();
    const next = await pageView();

    expect(failed.series).toBeNull();
    expect(next.series).toStrictEqual({ ...SERIES, series_id: ID });
    expect(fetchSeries).toHaveBeenCalledTimes(2);
  });
});
