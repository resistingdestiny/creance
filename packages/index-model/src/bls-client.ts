import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { mergeSeries, parseBlsResponse, type SourceObservation } from './bls-response.js';
import { canonicalize } from './jcs.js';
import { sha256Hex } from './hash.js';
import { cacheRoot } from './paths.js';
import { addMonths, periodRange, type Period } from './period.js';

/**
 * The BLS Public Data API client.
 *
 * Two facts drive the shape of this file. The endpoint needs its trailing
 * slash: without it the API answers with a 404 page carried inside a 200
 * response, so the HTTP status is useless on its own and the status field in the
 * body is what has to be read. And a silently empty adapter is indistinguishable
 * from a stable world, so every fetch asserts that the series it asked for came
 * back with a contiguous run of months.
 */

export type ApiVersion = 'v1' | 'v2';

export interface ApiLimits {
  seriesPerRequest: number;
  yearsPerRequest: number;
  requestsPerDay: number;
}

/**
 * The limits are documented on www.bls.gov, which refuses server clients, so
 * they are recorded here from the API's own registration page and treated as a
 * ceiling to stay under rather than a number to test against.
 */
export const API_LIMITS: Record<ApiVersion, ApiLimits> = {
  v1: { seriesPerRequest: 25, yearsPerRequest: 10, requestsPerDay: 25 },
  v2: { seriesPerRequest: 50, yearsPerRequest: 20, requestsPerDay: 500 },
};

/** The trailing slash is required. Without it the API returns a 404 page. */
export const ENDPOINTS: Record<ApiVersion, string> = {
  v1: 'https://api.bls.gov/publicAPI/v1/timeseries/data/',
  v2: 'https://api.bls.gov/publicAPI/v2/timeseries/data/',
};

export interface ClientOptions {
  /** Omit to read BLS_API_KEY from the environment. An absent key means v1. */
  apiKey?: string | undefined;
  cacheDir?: string;
  /** Injected in tests. Defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** Contact address for the User-Agent. BLS refuses anonymous clients. */
  contact?: string;
  maxAttempts?: number;
  /** Milliseconds before the first retry; doubles on each attempt. */
  backoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}

export interface FetchedFile {
  url: string;
  request: string;
  sha256: string;
  bytes: number;
  fetchedAt: string;
  cachePath: string;
  fromCache: boolean;
}

export interface FetchResult {
  series: Map<string, SourceObservation[]>;
  files: FetchedFile[];
}

interface RequestBody {
  seriesid: string[];
  startyear: string;
  endyear: string;
}

export class BlsClient {
  readonly version: ApiVersion;
  readonly limits: ApiLimits;
  private readonly apiKey: string | undefined;
  private readonly cacheDir: string;
  private readonly fetchImpl: typeof fetch;
  private readonly contact: string;
  private readonly maxAttempts: number;
  private readonly backoffMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => Date;
  private requests = 0;

  constructor(options: ClientOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.BLS_API_KEY ?? undefined;
    // Keyless requests go to v1, which is what the archive was collected with
    // and what a clone with no key can still run.
    this.version = this.apiKey && this.apiKey.length > 0 ? 'v2' : 'v1';
    this.limits = API_LIMITS[this.version];
    this.cacheDir = options.cacheDir ?? cacheRoot();
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.contact =
      options.contact ?? process.env.BLS_CONTACT ?? 'creance-index (+https://creance.co)';
    this.maxAttempts = options.maxAttempts ?? 4;
    this.backoffMs = options.backoffMs ?? 1000;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = options.now ?? (() => new Date());
  }

  get requestCount(): number {
    return this.requests;
  }

  /**
   * Fetch a set of series over a period range, chunked to the version's limits
   * and cached on disk by the hash of the request.
   */
  async fetchSeries(
    seriesIds: readonly string[],
    from: Period,
    to: Period,
  ): Promise<FetchResult> {
    const chunks = this.planChunks(seriesIds, from, to);
    const files: FetchedFile[] = [];
    const parts = [];
    for (const chunk of chunks) {
      const { body, file } = await this.request(chunk);
      files.push(file);
      parts.push(...parseBlsResponse(JSON.parse(body), file.url));
    }
    const series = mergeSeries(parts);
    assertComplete(series, seriesIds, from, to, this.now());
    return { series, files };
  }

  /** Split a request into chunks no larger than the version allows. */
  planChunks(seriesIds: readonly string[], from: Period, to: Period): RequestBody[] {
    if (seriesIds.length === 0) throw new Error('no series requested');
    const firstYear = Number(from.slice(0, 4));
    const lastYear = Number(to.slice(0, 4));
    if (lastYear < firstYear) throw new Error(`${from} is after ${to}`);
    const chunks: RequestBody[] = [];
    for (let i = 0; i < seriesIds.length; i += this.limits.seriesPerRequest) {
      const ids = seriesIds.slice(i, i + this.limits.seriesPerRequest);
      for (let year = firstYear; year <= lastYear; year += this.limits.yearsPerRequest) {
        const endYear = Math.min(year + this.limits.yearsPerRequest - 1, lastYear);
        chunks.push({
          seriesid: [...ids],
          startyear: String(year),
          endyear: String(endYear),
        });
      }
    }
    return chunks;
  }

  private cachePathFor(body: RequestBody): { key: string; path: string } {
    // The key covers the version and the request but never the registration
    // key, so a cache directory can be shared and can never leak a secret.
    const key = sha256Hex(
      canonicalize({ version: this.version, url: ENDPOINTS[this.version], body }),
    );
    return { key, path: join(this.cacheDir, `${key}.json`) };
  }

  private async request(body: RequestBody): Promise<{ body: string; file: FetchedFile }> {
    const url = ENDPOINTS[this.version];
    const { path } = this.cachePathFor(body);
    const request = canonicalize({ method: 'POST', url, body });
    if (existsSync(path)) {
      const text = readFileSync(path, 'utf8');
      const meta = readMeta(path);
      return {
        body: text,
        file: {
          url,
          request,
          sha256: sha256Hex(text),
          bytes: Buffer.byteLength(text),
          fetchedAt: meta?.fetchedAt ?? 'unknown',
          cachePath: path,
          fromCache: true,
        },
      };
    }

    const payload = this.apiKey ? { ...body, registrationkey: this.apiKey } : body;
    let lastError = '';
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      if (this.requests >= this.limits.requestsPerDay) {
        throw new Error(
          `the ${this.version} daily request limit of ${this.limits.requestsPerDay} is spent; ` +
            'the cache under var/cache/bls holds everything already fetched',
        );
      }
      this.requests += 1;
      const response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // download.bls.gov answers 403 to a client with no descriptive agent.
          'User-Agent': this.contact,
        },
        body: JSON.stringify(payload),
      });
      const text = await response.text();
      const failure = describeFailure(response.status, text);
      if (failure === null) {
        const fetchedAt = this.now().toISOString();
        mkdirSync(this.cacheDir, { recursive: true });
        writeFileSync(path, text);
        writeFileSync(
          `${path.slice(0, -'.json'.length)}.meta.json`,
          `${JSON.stringify(
            { url, request: JSON.parse(request), fetchedAt, sha256: sha256Hex(text), bytes: Buffer.byteLength(text) },
            null,
            2,
          )}\n`,
        );
        return {
          body: text,
          file: {
            url,
            request,
            sha256: sha256Hex(text),
            bytes: Buffer.byteLength(text),
            fetchedAt,
            cachePath: path,
            fromCache: false,
          },
        };
      }
      lastError = failure;
      if (attempt < this.maxAttempts) {
        await this.sleep(this.backoffMs * 2 ** (attempt - 1));
      }
    }
    throw new Error(`BLS ${this.version} request failed after ${this.maxAttempts} attempts: ${lastError}`);
  }
}

interface CacheMeta {
  fetchedAt?: string;
}

function readMeta(path: string): CacheMeta | null {
  const metaPath = `${path.slice(0, -'.json'.length)}.meta.json`;
  if (!existsSync(metaPath)) return null;
  return JSON.parse(readFileSync(metaPath, 'utf8')) as CacheMeta;
}

/**
 * Why a request failed, or null when it succeeded. The body's status field is
 * authoritative: a 200 can still carry REQUEST_FAILED, which is what a missing
 * trailing slash produces.
 */
export function describeFailure(httpStatus: number, body: string): string | null {
  if (httpStatus < 200 || httpStatus >= 300) {
    return `HTTP ${httpStatus}: ${body.slice(0, 200)}`;
  }
  let parsed: { status?: unknown; message?: unknown };
  try {
    parsed = JSON.parse(body) as { status?: unknown; message?: unknown };
  } catch {
    return `unparseable body: ${body.slice(0, 200)}`;
  }
  if (parsed.status !== 'REQUEST_SUCCEEDED') {
    const messages = Array.isArray(parsed.message) ? parsed.message.join('; ') : '';
    return `status ${String(parsed.status)}${messages ? `: ${messages}` : ''}`;
  }
  return null;
}

/**
 * Every requested series came back, with a contiguous run of months and nothing
 * silently truncated. A short fetch that nobody notices degrades the index to a
 * flat line, and the code downstream cannot tell the difference.
 */
export function assertComplete(
  series: ReadonlyMap<string, SourceObservation[]>,
  requested: readonly string[],
  from: Period,
  to: Period,
  now: Date = new Date(),
): void {
  // The source publishes about a month in arrears, and a caller may ask for a
  // range that runs into the future. The month a complete response must reach is
  // the earlier of the request's end and two months back from today.
  const currentPeriod = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const lagged = addMonths(currentPeriod, -2);
  const mustReach = to < lagged ? to : lagged;
  for (const seriesId of requested) {
    const rows = series.get(seriesId);
    if (!rows || rows.length === 0) {
      throw new Error(`${seriesId}: the source returned no rows for ${from} to ${to}`);
    }
    const first = rows[0]?.period as Period;
    const last = rows[rows.length - 1]?.period as Period;
    const span = periodRange(first, last);
    if (span.length !== rows.length) {
      throw new Error(
        `${seriesId}: ${rows.length} rows across ${span.length} months from ${first} to ${last}, ` +
          'so the response has holes',
      );
    }
    if (first > from) {
      throw new Error(`${seriesId}: asked from ${from}, the source returned from ${first}`);
    }
    if (last < mustReach) {
      throw new Error(
        `${seriesId}: asked to ${to}, the source stopped at ${last} and should reach ${mustReach}`,
      );
    }
  }
}
