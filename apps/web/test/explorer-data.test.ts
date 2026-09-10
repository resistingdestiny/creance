import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What the public explorer's round costs, and what it costs twice.
 *
 * The round is fifteen metered readings and each one settles on Hedera, so the
 * thing worth asserting is how many calls a page view makes rather than what
 * they return. The reads are stubbed here for exactly that reason: this is a
 * test about the hold in front of them, and the readings themselves are what
 * explorer-model.test.ts and the recorded fixtures cover.
 *
 * The replay badge is the one read that must never be held, because the demo
 * clock moves in ten second steps and a stale badge is a lie about what is on
 * screen. It is asserted here beside the round it travels with.
 */

const fetchIndex = vi.fn();
const fetchIndexCatalogue = vi.fn();
const fetchReplay = vi.fn();

vi.mock('../src/lib/worker-api.js', () => ({
  fetchIndex: (...args: unknown[]) => fetchIndex(...args),
  fetchIndexCatalogue: () => fetchIndexCatalogue(),
}));

vi.mock('../src/lib/claim-api.js', () => ({
  fetchReplay: () => fetchReplay(),
}));

const { EXPLORER_READINGS } = await import('./explorer-fixtures.js');
const { STALE_MS, TTL_MS, forgetExplorerRound, readExplorer, readExplorerIndex } = await import(
  '../src/lib/explorer-data.js'
);

const READINGS = new Map(EXPLORER_READINGS.map((reading) => [reading.group, reading]));

beforeEach(() => {
  forgetExplorerRound();
  fetchIndex.mockReset();
  fetchIndex.mockImplementation((group: string) => {
    const reading = READINGS.get(group);
    return reading === undefined
      ? Promise.reject(new Error(`no fixture for ${group}`))
      : Promise.resolve(reading);
  });
  fetchIndexCatalogue.mockReset();
  fetchIndexCatalogue.mockResolvedValue({ index: { topic_id: null, source: 'the source' }, groups: [] });
  fetchReplay.mockReset();
  fetchReplay.mockResolvedValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the round of fifteen', () => {
  it('is bought once however many readers arrive together', async () => {
    const rounds = await Promise.all(Array.from({ length: 20 }, () => readExplorerIndex(0)));

    expect(fetchIndex).toHaveBeenCalledTimes(15);
    for (const round of rounds) expect(round.readings).toHaveLength(15);
  });

  it('is not bought again inside the TTL', async () => {
    await readExplorerIndex(0);
    await readExplorerIndex(TTL_MS - 1);

    expect(fetchIndex).toHaveBeenCalledTimes(15);
  });

  it('is served from the hold while the next one is bought behind the reader', async () => {
    await readExplorerIndex(0);
    const stale = await readExplorerIndex(TTL_MS);

    expect(stale.readings).toHaveLength(15);
    await vi.waitFor(() => expect(fetchIndex).toHaveBeenCalledTimes(30));
  });

  it('is waited for once it is older than both windows', async () => {
    await readExplorerIndex(0);
    await readExplorerIndex(TTL_MS + STALE_MS);

    expect(fetchIndex).toHaveBeenCalledTimes(30);
  });

  it('costs the page its reading and never the page when a group cannot be read', async () => {
    fetchIndex.mockImplementation((group: string) =>
      group === 'legal'
        ? Promise.reject(new Error('no answer'))
        : Promise.resolve(READINGS.get(group)),
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const round = await readExplorerIndex(0);

    expect(round.readings).toHaveLength(14);
    expect(round.missing).toEqual(['legal']);
  });
});

describe('the replay badge', () => {
  it('is read again on every page view, held round or not', async () => {
    await readExplorer(0);
    await readExplorer(1);

    expect(fetchIndex).toHaveBeenCalledTimes(15);
    expect(fetchReplay).toHaveBeenCalledTimes(2);
  });
});
