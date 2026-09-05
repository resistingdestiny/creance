import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  API_LIMITS,
  BlsClient,
  ENDPOINTS,
  assertComplete,
  describeFailure,
} from '../src/bls-client.js';
import type { SourceObservation } from '../src/bls-response.js';

function tempCache(): string {
  return mkdtempSync(join(tmpdir(), 'creance-bls-'));
}

interface ResponseRow {
  year: string;
  period: string;
  value: string;
  footnotes: Record<string, string>[];
}

function response(seriesIds: string[], from: string, to: string) {
  const data: ResponseRow[] = [];
  for (let year = Number(to.slice(0, 4)); year >= Number(from.slice(0, 4)); year -= 1) {
    for (let month = 12; month >= 1; month -= 1) {
      const period = `${year}-${String(month).padStart(2, '0')}`;
      if (period < from || period > to) continue;
      data.push({
        year: String(year),
        period: `M${String(month).padStart(2, '0')}`,
        value: '4.0',
        footnotes: [{}],
      });
    }
  }
  return JSON.stringify({
    status: 'REQUEST_SUCCEEDED',
    responseTime: 12,
    message: [],
    Results: { series: seriesIds.map((seriesID) => ({ seriesID, data })) },
  });
}

function okFetch(from: string, to: string, log: { calls: RequestInit[] } = { calls: [] }) {
  const impl = (async (_url: string, init: RequestInit) => {
    log.calls.push(init);
    const body = JSON.parse(String(init.body)) as { seriesid: string[] };
    return new Response(response(body.seriesid, from, to), { status: 200 });
  }) as unknown as typeof fetch;
  return { impl, log };
}

describe('the endpoint and the version', () => {
  it('needs the trailing slash on the v1 endpoint', () => {
    // Without it the API answers a 404 page inside a 200 response.
    expect(ENDPOINTS.v1).toBe('https://api.bls.gov/publicAPI/v1/timeseries/data/');
    expect(ENDPOINTS.v1.endsWith('/')).toBe(true);
    expect(ENDPOINTS.v2.endsWith('/')).toBe(true);
  });

  it('uses v1 keyless and v2 when a registration key is present', () => {
    expect(new BlsClient({ apiKey: undefined, cacheDir: tempCache() }).version).toBe('v1');
    expect(new BlsClient({ apiKey: '', cacheDir: tempCache() }).version).toBe('v1');
    expect(new BlsClient({ apiKey: 'k', cacheDir: tempCache() }).version).toBe('v2');
    expect(API_LIMITS.v1).toEqual({ seriesPerRequest: 25, yearsPerRequest: 10, requestsPerDay: 25 });
    expect(API_LIMITS.v2).toEqual({ seriesPerRequest: 50, yearsPerRequest: 20, requestsPerDay: 500 });
  });
});

describe('chunking', () => {
  it('splits by series and by year to stay inside the v1 limits', () => {
    const client = new BlsClient({ apiKey: undefined, cacheDir: tempCache() });
    const ids = Array.from({ length: 30 }, (_, i) => `S${i}`);
    const chunks = client.planChunks(ids, '2000-01', '2026-07');
    // 30 series is two chunks of 25 and 5; 27 years is three chunks of ten.
    expect(chunks).toHaveLength(2 * 3);
    expect(chunks[0]?.seriesid).toHaveLength(25);
    expect(chunks[3]?.seriesid).toHaveLength(5);
    expect(chunks.map((c) => `${c.startyear}-${c.endyear}`).slice(0, 3)).toEqual([
      '2000-2009',
      '2010-2019',
      '2020-2026',
    ]);
  });

  it('needs fewer requests with a key', () => {
    const client = new BlsClient({ apiKey: 'k', cacheDir: tempCache() });
    const ids = Array.from({ length: 30 }, (_, i) => `S${i}`);
    // 30 series fits one v2 request and 27 years fits two.
    expect(client.planChunks(ids, '2000-01', '2026-07')).toHaveLength(2);
  });
});

describe('fetching', () => {
  it('sends a descriptive User-Agent and never puts the key in the cache key', async () => {
    const cacheDir = tempCache();
    const { impl, log } = okFetch('2026-01', '2026-07');
    const client = new BlsClient({
      apiKey: 'secret-key',
      cacheDir,
      fetchImpl: impl,
      contact: 'creance-index (+https://creance.co)',
    });
    await client.fetchSeries(['LNU04034021'], '2026-01', '2026-07');
    const headers = log.calls[0]?.headers as Record<string, string>;
    expect(headers['User-Agent']).toContain('creance');
    expect(headers['User-Agent']).toContain('https://');
    // The key is sent and is not written anywhere on disk.
    expect(String(log.calls[0]?.body)).toContain('secret-key');
    for (const name of readdirSync(cacheDir)) {
      expect(readFileSync(join(cacheDir, name), 'utf8')).not.toContain('secret-key');
    }
  });

  it('caches by request hash and does not fetch the same request twice', async () => {
    const cacheDir = tempCache();
    const { impl, log } = okFetch('2026-01', '2026-07');
    const options = { apiKey: undefined, cacheDir, fetchImpl: impl };
    const first = await new BlsClient(options).fetchSeries(['LNU04034021'], '2026-01', '2026-07');
    expect(log.calls).toHaveLength(1);
    expect(first.files[0]?.fromCache).toBe(false);

    const second = await new BlsClient(options).fetchSeries(['LNU04034021'], '2026-01', '2026-07');
    expect(log.calls).toHaveLength(1);
    expect(second.files[0]?.fromCache).toBe(true);
    expect(second.files[0]?.sha256).toBe(first.files[0]?.sha256);
    expect(second.series.get('LNU04034021')).toHaveLength(7);
  });

  it('records the request and the body hash for the provenance block', async () => {
    const cacheDir = tempCache();
    const { impl } = okFetch('2026-01', '2026-07');
    const client = new BlsClient({ apiKey: undefined, cacheDir, fetchImpl: impl });
    const { files } = await client.fetchSeries(['LNU04034021'], '2026-01', '2026-07');
    const file = files[0]!;
    expect(file.url).toBe(ENDPOINTS.v1);
    expect(file.request).toContain('"method":"POST"');
    expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(file.bytes).toBeGreaterThan(0);
    const meta = JSON.parse(
      readFileSync(file.cachePath.replace(/\.json$/, '.meta.json'), 'utf8'),
    ) as { sha256: string };
    expect(meta.sha256).toBe(file.sha256);
  });
});

describe('failure handling', () => {
  it('reads the status in the body, not only the HTTP code', () => {
    // The missing trailing slash returns a 200 carrying a 404 page.
    expect(
      describeFailure(200, JSON.stringify({ status: 'REQUEST_FAILED', message: ['404 Error - Page Not Found'] })),
    ).toContain('404 Error');
    expect(describeFailure(200, JSON.stringify({ status: 'REQUEST_SUCCEEDED' }))).toBeNull();
    expect(describeFailure(429, 'slow down')).toContain('HTTP 429');
    expect(describeFailure(200, '<html>')).toContain('unparseable body');
  });

  it('backs off and retries, then gives up with the reason', async () => {
    const waits: number[] = [];
    let calls = 0;
    const impl = (async () => {
      calls += 1;
      return new Response(
        JSON.stringify({ status: 'REQUEST_NOT_PROCESSED', message: ['daily threshold reached'] }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const client = new BlsClient({
      apiKey: undefined,
      cacheDir: tempCache(),
      fetchImpl: impl,
      maxAttempts: 3,
      backoffMs: 10,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    await expect(client.fetchSeries(['X'], '2026-01', '2026-07')).rejects.toThrow(
      /failed after 3 attempts.*daily threshold/s,
    );
    expect(calls).toBe(3);
    expect(waits).toEqual([10, 20]);
  });

  it('succeeds on a retry after a transient failure', async () => {
    let calls = 0;
    const impl = (async () => {
      calls += 1;
      if (calls === 1) return new Response('gateway timeout', { status: 504 });
      return new Response(response(['LNU04034021'], '2026-01', '2026-07'), { status: 200 });
    }) as unknown as typeof fetch;
    const client = new BlsClient({
      apiKey: undefined,
      cacheDir: tempCache(),
      fetchImpl: impl,
      backoffMs: 1,
      sleep: async () => {},
    });
    const { series } = await client.fetchSeries(['LNU04034021'], '2026-01', '2026-07');
    expect(calls).toBe(2);
    expect(series.get('LNU04034021')).toHaveLength(7);
  });

  it('stops before spending more than the daily request allowance', async () => {
    const impl = (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch;
    const client = new BlsClient({
      apiKey: undefined,
      cacheDir: tempCache(),
      fetchImpl: impl,
      maxAttempts: 100,
      backoffMs: 0,
      sleep: async () => {},
    });
    await expect(client.fetchSeries(['X'], '2026-01', '2026-07')).rejects.toThrow(
      /daily request limit of 25 is spent/,
    );
    expect(client.requestCount).toBe(25);
  });
});

describe('assertComplete', () => {
  const rows = (periods: string[]): SourceObservation[] =>
    periods.map((period) => ({
      seriesId: 'A',
      period,
      value: 4,
      raw: '4.0',
      year: period.slice(0, 4),
      blsPeriod: `M${period.slice(5)}`,
      footnoteCodes: [],
    }));

  it('accepts a contiguous run, including a month with no value', () => {
    expect(() =>
      assertComplete(new Map([['A', rows(['2026-01', '2026-02', '2026-03'])]]), ['A'], '2026-01', '2026-03'),
    ).not.toThrow();
  });

  it('fails on an empty series', () => {
    expect(() => assertComplete(new Map([['A', []]]), ['A'], '2026-01', '2026-03')).toThrow(
      /returned no rows/,
    );
    expect(() => assertComplete(new Map(), ['A'], '2026-01', '2026-03')).toThrow(/no rows/);
  });

  it('fails on a hole in the middle', () => {
    expect(() =>
      assertComplete(new Map([['A', rows(['2026-01', '2026-03'])]]), ['A'], '2026-01', '2026-03'),
    ).toThrow(/has holes/);
  });

  it('fails when the response starts late or stops early', () => {
    const now = new Date('2026-09-04T00:00:00Z');
    expect(() =>
      assertComplete(new Map([['A', rows(['2026-02', '2026-03'])]]), ['A'], '2026-01', '2026-03', now),
    ).toThrow(/asked from 2026-01/);
    expect(() =>
      assertComplete(new Map([['A', rows(['2020-01', '2020-02'])]]), ['A'], '2020-01', '2026-03', now),
    ).toThrow(/stopped at 2020-02/);
  });

  it('allows the publication lag at the end of the range', () => {
    // In September 2026 the newest month a complete response must carry is
    // 2026-07. Asking further ahead than the source has published is normal and
    // must not fail the run.
    const now = new Date('2026-09-04T00:00:00Z');
    expect(() =>
      assertComplete(
        new Map([['A', rows(['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07'])]]),
        ['A'],
        '2026-01',
        '2026-12',
        now,
      ),
    ).not.toThrow();
    // Two months short of that is a truncation and still fails.
    expect(() =>
      assertComplete(
        new Map([['A', rows(['2026-01', '2026-02', '2026-03', '2026-04', '2026-05'])]]),
        ['A'],
        '2026-01',
        '2026-12',
        now,
      ),
    ).toThrow(/should reach 2026-07/);
  });
});
