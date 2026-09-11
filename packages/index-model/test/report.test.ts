import { describe, expect, it } from 'vitest';

import { loadDataset } from '../src/dataset.js';
import {
  GAP_CAPTION,
  lossWindows,
  movedSourceSummary,
  renderIndexReport,
  SOURCE_CORRECTIONS,
} from '../src/report.js';

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

describe('movedSourceSummary', () => {
  it('reads the correction footnotes out of the archive', () => {
    // A frozen map with no open rows isolates the archive facts from the backtest.
    const summary = movedSourceSummary(dataset, new Map());
    expect(summary.archivedSeries).toBe(30);
    expect(summary.correctedSeries).toBe(13);
    expect(summary.correctedFrom).toBe('2020-01');
    expect(summary.correctedTo).toBe('2020-06');
    expect(summary.open).toBe(0);
    expect(summary.openOnMoved).toBe(0);
  });

  it('carries the April 2025 errata the archive cannot show', () => {
    // The archive was pulled after the correction, so 2025-04 reads the
    // corrected value with an empty footnote; the constant is the only record.
    for (const entry of SOURCE_CORRECTIONS) {
      const row = dataset.allSeries.get(entry.seriesId)?.find((r) => r.period === entry.period);
      expect(row?.raw).toBe(entry.corrected);
      expect(row?.footnoteCodes).toEqual([]);
      expect(entry.correctedOn).toBe('2025-06-06');
    }
    expect(SOURCE_CORRECTIONS.map((c) => c.seriesId)).toContain('LNU04032224');
    expect(SOURCE_CORRECTIONS.map((c) => c.seriesId)).toContain('LNU04034027');
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
    expect(report).toContain('arts, design, entertainment, sports and\nmedia from January to April 2025');
  });

  it('dates the three source corrections and cites a BLS notice for each', () => {
    expect(report).toContain('On 2020-09-23 BLS corrected January to July 2020');
    expect(report).toContain('13 of the 30 archived\n  series carry the C footnote on 2020-01 to 2020-06');
    expect(report).toContain('On 2025-06-06 it corrected\n  April 2025');
    expect(report).toContain('construction and extraction moved from 6.0 to 5.9');
    expect(report).toContain('On 2026-03-06 it revised\n  every January 2026 value');
    expect(report).toContain(
      'https://www.bls.gov/bls/errata/revision-to-current-population-survey-estimates-for-January-through-July-2020.htm',
    );
    expect(report).toContain('https://www.bls.gov/bls/errata/cps-corrections-april-2025.htm');
    expect(report).toContain(
      'https://www.bls.gov/cps/methods/population-controls/experimental-series-accounting-for-january-2026-population-control-effects.htm',
    );
  });

  it('rests determinism on the first-final rule, not on source stability', () => {
    expect(report).toContain('the first value published to the index topic settles');
    expect(report).toContain('never a resettlement');
    // The sentence that described an unimplemented pre revision replay is gone.
    expect(report).not.toContain('pre revision');
    expect(report).not.toContain('is not\n  revised after first print');
  });

  it('counts the open months computed on later corrected source', () => {
    expect(report).toContain('19 of the 99 open group\n  months in the table above');
  });

  it('uses no em dashes or en dashes', () => {
    expect(report).not.toMatch(/[–—]/);
  });
});
