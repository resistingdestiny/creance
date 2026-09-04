import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { BlsClient, type ClientOptions } from './bls-client.js';
import { mergeSeries, parseBlsResponse, type SourceObservation } from './bls-response.js';
import { datasetFrom, loadDataset, type Dataset, type SourceFile } from './dataset.js';
import { sha256Hex } from './hash.js';
import { archiveRoot, cacheRoot, hasArchive } from './paths.js';
import type { Period } from './period.js';
import { loadSeriesMap } from './series.js';

/**
 * Where the history comes from, in the order the specification sets: the
 * committed archive first, then the raw fetches cached under var/cache/bls, then
 * the API. The archive is preferred because its bytes are fixed and hashed, so a
 * backfill from it is reproducible by anyone who has the repository.
 */

export interface SourceOptions {
  archiveDir?: string;
  cacheDir?: string;
  from?: Period;
  to?: Period;
  client?: ClientOptions;
  /** Skip straight to the API. Used by the live path. */
  prefer?: 'archive' | 'cache' | 'api';
}

export async function resolveDataset(options: SourceOptions = {}): Promise<Dataset> {
  const prefer = options.prefer ?? 'archive';
  const archiveDir = options.archiveDir ?? archiveRoot();
  const cacheDir = options.cacheDir ?? cacheRoot();

  if (prefer === 'archive' && hasArchive()) {
    return loadDataset(archiveDir);
  }
  if (prefer !== 'api') {
    const cached = loadFromCache(cacheDir);
    if (cached) return cached;
  }
  return fetchDataset({ ...options, cacheDir });
}

/** Rebuild a dataset from whatever raw responses the cache already holds. */
export function loadFromCache(cacheDir: string = cacheRoot()): Dataset | null {
  if (!existsSync(cacheDir)) return null;
  const names = readdirSync(cacheDir)
    .filter((name) => name.endsWith('.json') && !name.endsWith('.meta.json'))
    .sort();
  if (names.length === 0) return null;
  const parts = [];
  const files: SourceFile[] = [];
  for (const name of names) {
    const text = readFileSync(join(cacheDir, name), 'utf8');
    parts.push(...parseBlsResponse(JSON.parse(text), name));
    files.push({
      label: `var/cache/bls/${name}`,
      url: 'https://api.bls.gov/publicAPI/v1/timeseries/data/',
      sha256: sha256Hex(text),
      bytes: Buffer.byteLength(text),
    });
  }
  const series = mergeSeries(parts);
  const map = loadSeriesMap();
  const missing = map.series.filter((entry) => !series.has(entry.bls_series_id));
  if (missing.length > 0) return null;
  return datasetFrom(
    series,
    {
      kind: 'cache',
      description: `var/cache/bls, ${names.length} cached responses`,
      files,
      catalogueSha256: null,
    },
    null,
    map,
  );
}

/** Fetch the sixteen series the index needs straight from the API. */
export async function fetchDataset(options: SourceOptions = {}): Promise<Dataset> {
  const map = loadSeriesMap();
  const from = options.from ?? '2000-01';
  const to = options.to ?? currentPeriod();
  const client = new BlsClient({ ...options.client, cacheDir: options.cacheDir ?? cacheRoot() });
  const ids = map.series.map((entry) => entry.bls_series_id);
  const { series, files } = await client.fetchSeries(ids, from, to);
  return datasetFrom(
    series,
    {
      kind: 'api',
      description: `BLS Public Data API ${client.version}, ${files.length} responses`,
      files: files.map((file) => ({
        label: file.fromCache ? `${file.cachePath} (cached)` : file.cachePath,
        url: file.url,
        sha256: file.sha256,
        bytes: file.bytes,
      })),
      catalogueSha256: null,
    },
    null,
    map,
  );
}

export function currentPeriod(now: Date = new Date()): Period {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** The rows a computation used, in the shape the source hash commits to. */
export function extractRows(
  dataset: Dataset,
  seriesIds: readonly string[],
  periods: readonly Period[],
): { seriesID: string; year: string; period: string; value: string; footnote_codes: string[] }[] {
  const wanted = new Set(periods);
  const rows: SourceObservation[] = [];
  for (const seriesId of seriesIds) {
    for (const row of dataset.allSeries.get(seriesId) ?? []) {
      if (wanted.has(row.period)) rows.push(row);
    }
  }
  return rows.map((row) => ({
    seriesID: row.seriesId,
    year: row.year,
    period: row.blsPeriod,
    value: row.raw,
    footnote_codes: row.footnoteCodes,
  }));
}
