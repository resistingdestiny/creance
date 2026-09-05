import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadArchive } from '../src/archive.js';
import { archiveRoot } from '../src/paths.js';
import {
  AGGREGATE_KEY,
  GROUP_DEFINITIONS,
  bindableGroups,
  loadSeriesMap,
  resolveSeriesMap,
} from '../src/series.js';

const archive = loadArchive(archiveRoot());
const frozen = loadSeriesMap();

describe('the frozen series mapping', () => {
  it('is what the resolution procedure gives against the committed catalogue', () => {
    const resolved = resolveSeriesMap(
      archive.catalogue,
      archive.catalogueSha256,
      frozen.catalogue.resolved_on,
    );
    expect(resolved).toEqual(frozen);
  });

  it('records the catalogue hash it was resolved against', () => {
    expect(frozen.catalogue.sha256).toBe(archive.catalogueSha256);
    expect(frozen.catalogue.file).toBe('data/bls/raw/ln.series.gz');
  });

  it('holds the fifteen bindable series and the aggregate', () => {
    expect(frozen.series).toHaveLength(16);
    expect(bindableGroups(frozen)).toHaveLength(15);
    expect(frozen.series.filter((e) => e.group_key === AGGREGATE_KEY)).toHaveLength(1);
    expect(new Set(frozen.series.map((e) => e.bls_series_id)).size).toBe(16);
    expect(GROUP_DEFINITIONS.map((d) => d.groupKey)).toEqual(frozen.series.map((e) => e.group_key));
  });

  it('does not carry food preparation and serving, which is not bindable', () => {
    expect(frozen.series.map((e) => e.bls_series_id)).not.toContain('LNU04034031');
  });

  it('cross-checks against data/bls/series-ids.txt', () => {
    const listed = new Map<string, string>();
    const text = readFileSync(join(archiveRoot(), 'series-ids.txt'), 'utf8');
    for (const line of text.split('\n')) {
      if (line.startsWith('#') || line.trim().length === 0) continue;
      const match = /^(\S+)\s+(.*)$/.exec(line.trim());
      if (match) listed.set(match[1] as string, match[2] as string);
    }
    for (const entry of frozen.series) {
      expect(listed.has(entry.bls_series_id), `${entry.group_key} ${entry.bls_series_id}`).toBe(
        true,
      );
    }
  });

  it('names series the archive actually carries', () => {
    for (const entry of frozen.series) {
      const rows = archive.series.get(entry.bls_series_id);
      expect(rows, entry.group_key).toBeDefined();
      expect(rows?.length, entry.group_key).toBe(319);
    }
  });

  it('resolves only monthly, not seasonally adjusted unemployment rates', () => {
    for (const definition of GROUP_DEFINITIONS) {
      const entry = archive.catalogue.find(
        (c) =>
          c.title === definition.catalogueTitle &&
          c.periodicityCode === 'M' &&
          c.seasonal === 'U' &&
          c.lfstCode === '40',
      );
      expect(entry, definition.groupKey).toBeDefined();
      expect(entry?.beginYear, definition.groupKey).toBe(
        definition.groupKey === AGGREGATE_KEY ? '1947' : '2000',
      );
    }
  });
});
