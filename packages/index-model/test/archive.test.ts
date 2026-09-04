import { describe, expect, it } from 'vitest';

import { latestPeriod, loadArchive, parseProvenance, verifyArchive } from '../src/archive.js';
import { archiveRoot } from '../src/paths.js';
import { mergeSeries, parseBlsResponse } from '../src/bls-response.js';
import { periodRange } from '../src/period.js';

const archive = loadArchive(archiveRoot());

describe('the committed archive', () => {
  it('matches every sha256 and byte count in PROVENANCE.txt', () => {
    // Seven files: six API responses and the gzipped catalogue, which also
    // records the hash of its decompressed form.
    expect(archive.verified).toHaveLength(7);
    for (const file of archive.verified) {
      expect(file.actualSha256).toBe(file.sha256);
    }
    expect(() => verifyArchive(archiveRoot())).not.toThrow();
  });

  it('carries thirty series of 319 months each, 2000-01 to 2026-07', () => {
    expect(archive.series.size).toBe(30);
    const window = periodRange('2000-01', '2026-07');
    expect(window).toHaveLength(319);
    for (const [seriesId, rows] of archive.series) {
      expect(rows, seriesId).toHaveLength(319);
      expect(rows.map((r) => r.period), seriesId).toEqual(window);
    }
    expect(latestPeriod(archive.series)).toBe('2026-07');
  });

  it('has exactly one absent month per series, October 2025, with footnote 9', () => {
    for (const [seriesId, rows] of archive.series) {
      const absent = rows.filter((r) => r.value === null);
      expect(absent, seriesId).toHaveLength(1);
      expect(absent[0]?.period, seriesId).toBe('2025-10');
      expect(absent[0]?.raw, seriesId).toBe('-');
      expect(absent[0]?.footnoteCodes, seriesId).toEqual(['9']);
    }
  });

  it('keeps the January 2026 population control footnote', () => {
    const rows = archive.series.get('LNU04034021');
    const january = rows?.find((r) => r.period === '2026-01');
    expect(january?.footnoteCodes).toEqual(['12']);
    // The footnote changes nothing arithmetically; the value is the value.
    expect(january?.value).toBe(3.6);
  });

  it('resolves the catalogue to the hash the mapping is frozen against', () => {
    expect(archive.catalogueSha256).toBe(
      'f1a2f8cda6c53209b9df7b9ddab0d1739af5ef49cf3ba43eb556dbdb1ddc23fd',
    );
    expect(archive.catalogue.length).toBeGreaterThan(1000);
  });
});

describe('parseProvenance', () => {
  it('reads a file line and a catalogue line', () => {
    const provenance = parseProvenance(
      [
        'https://example.invalid/ln.series (gzipped as raw/ln.series.gz)  sha256_gz=' +
          'a'.repeat(64) +
          '  sha256_plain=' +
          'b'.repeat(64) +
          '  bytes_plain=15288538',
        'api.bls.gov/x (POST)  file=batch0_2000_2009.json  sha256=' + 'c'.repeat(64) + '  bytes=10',
      ].join('\n'),
    );
    expect(provenance.files).toHaveLength(2);
    expect(provenance.files[0]?.path).toBe('raw/ln.series.gz');
    expect(provenance.files[0]?.bytesPlain).toBe(15288538);
    expect(provenance.files[1]).toMatchObject({
      path: 'api/batch0_2000_2009.json',
      bytes: 10,
    });
  });
});

describe('the strict parser', () => {
  const ok = {
    status: 'REQUEST_SUCCEEDED',
    message: [],
    Results: {
      series: [
        {
          seriesID: 'LNU04034021',
          data: [
            { year: '2026', period: 'M13', value: '3.4', footnotes: [{}] },
            { year: '2026', period: 'M02', value: '3.8', footnotes: [{}] },
            { year: '2026', period: 'M01', value: '3.6', footnotes: [{ code: '12', text: 'x' }] },
          ],
        },
      ],
    },
  };

  it('sorts ascending, drops M13 and keeps footnote codes', () => {
    const [series] = parseBlsResponse(ok, 'test');
    expect(series?.observations.map((o) => o.period)).toEqual(['2026-01', '2026-02']);
    expect(series?.observations[0]?.footnoteCodes).toEqual(['12']);
    expect(series?.observations[1]?.footnoteCodes).toEqual([]);
  });

  it('treats a hyphen as absent and never as zero', () => {
    const body = structuredClone(ok);
    body.Results.series[0]!.data[1]!.value = '-';
    const [series] = parseBlsResponse(body, 'test');
    const february = series?.observations.find((o) => o.period === '2026-02');
    expect(february?.value).toBeNull();
    expect(february?.raw).toBe('-');
  });

  it('fails loudly on a non-success status', () => {
    expect(() =>
      parseBlsResponse(
        { status: 'REQUEST_FAILED', message: ['404 Error - Page Not Found'], Results: {} },
        'test',
      ),
    ).toThrow(/REQUEST_FAILED.*404/);
  });

  it('fails loudly on a value that is not a number', () => {
    const body = structuredClone(ok);
    body.Results.series[0]!.data[1]!.value = '3.8%';
    expect(() => parseBlsResponse(body, 'test')).toThrow(/unparseable value/);
  });

  it('refuses two source files that disagree about a month', () => {
    const other = structuredClone(ok);
    other.Results.series[0]!.data[1]!.value = '9.9';
    expect(() =>
      mergeSeries([...parseBlsResponse(ok, 'a'), ...parseBlsResponse(other, 'b')]),
    ).toThrow(/disagree/);
  });
});
