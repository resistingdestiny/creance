import { describe, expect, it } from 'vitest';

import { loadDataset } from '../src/dataset.js';
import { GAP_CAPTION, lossWindows, renderIndexReport } from '../src/report.js';

const dataset = loadDataset();

describe('lossWindows', () => {
  it('reaches two months back from the first open month of a run', () => {
    // A separation in month m qualifies when m, m+1 or m+2 is open.
    expect(lossWindows(['2026-04', '2026-05'])).toEqual([{ from: '2026-02', to: '2026-05' }]);
    expect(lossWindows(['2018-08'])).toEqual([{ from: '2018-06', to: '2018-08' }]);
  });

  it('keeps separate runs separate and merges overlapping ones', () => {
    expect(lossWindows(['2018-08', '2019-08'])).toEqual([
      { from: '2018-06', to: '2018-08' },
      { from: '2019-06', to: '2019-08' },
    ]);
    // Two openings three months apart still make one continuous window.
    expect(lossWindows(['2021-05', '2021-07'])).toEqual([{ from: '2021-03', to: '2021-07' }]);
  });

  it('is empty for an occupation that never opened', () => {
    expect(lossWindows([])).toEqual([]);
  });
});

describe('the generated index page', () => {
  const report = renderIndexReport({ dataset });

  it('is byte identical on a second run over the same source', () => {
    // docs/INDEX.md is regenerated, never edited, so a rerun must not churn.
    expect(renderIndexReport({ dataset })).toBe(report);
  });

  it('carries the chosen series ids and the catalogue hash', () => {
    expect(report).toContain('LNU04034021');
    expect(report).toContain('LNU04000000');
    expect(report).toContain('f1a2f8cda6c53209b9df7b9ddab0d1739af5ef49cf3ba43eb556dbdb1ddc23fd');
  });

  it('carries the verification recipe an outsider can repeat', () => {
    expect(report).toContain('sha256sum');
    expect(report).toContain('https://download.bls.gov/pub/time.series/ln/ln.series');
    // The trailing slash is part of the recipe.
    expect(report).toContain('https://api.bls.gov/publicAPI/v1/timeseries/data/');
  });

  it('carries the backtest, the generic 2.0 table and the loss windows', () => {
    expect(report).toContain('Total open group months: 99.');
    expect(report).toContain('At a generic attachment of 2.0');
    expect(report).toContain('2026-02 to 2026-05');
  });

  it('carries the calibration with three sigma to four decimals', () => {
    expect(report).toContain('1.9398');
    expect(report).toContain('| 2.0 | -0.68 |');
  });

  it('carries the month-matched comparison and the hazard table', () => {
    expect(report).toContain('The month-matched level line, for comparison');
    expect(report).toContain('at or past the line');
    expect(report).toContain('h(d) = 0.047 + 0.613 * exp(-d / 0.22)');
  });

  it('carries the gap caption verbatim', () => {
    expect(report).toContain(GAP_CAPTION);
    expect(GAP_CAPTION).toBe(
      'No reading for October 2025. The source survey was not collected that month, ' +
        'so there is no value to publish and none was invented. November and December ' +
        '2025 have no three-month average for the same reason.',
    );
  });

  it('carries the honesty notes and the corrected spare window', () => {
    expect(report).toContain('The index does not attribute cause');
    expect(report).toContain('lagging measure by construction');
    expect(report).toContain('January population control update');
    expect(report).toContain('arts, design, entertainment, sports and\nmedia from January to April 2025');
  });

  it('uses no em dashes or en dashes', () => {
    expect(report).not.toMatch(/[–—]/);
  });
});
