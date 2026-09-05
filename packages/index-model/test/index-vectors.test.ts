import { describe, expect, it } from 'vitest';

import { publishedSeries, defaultWindows } from '../src/calibration.js';
import {
  calibrateDataset,
  evaluateDataset,
  frozenParameters,
  loadCalibration,
  loadDataset,
  rateSeriesFor,
} from '../src/dataset.js';
import { periodRange } from '../src/period.js';
import { fmt2 } from '../src/rounding.js';

/**
 * The archive is the fixture. Every expected value below is recomputable from
 * data/bls by anyone who has the repository, and the calibration rows are the
 * table docs/INDEX-FINDINGS.md section 4 published before kick-off.
 */
const dataset = loadDataset();
const frozen = loadCalibration();
const parameters = frozenParameters(frozen);
const backtest = evaluateDataset(dataset, parameters, '2010-01', dataset.latest);

describe('archive row counts', () => {
  it('gives 318 excess, 314 smoothed and 302 ODI values per bindable series', () => {
    // 319 months from 2000-01 to 2026-07 less October 2025, which was never
    // collected. ebar loses the two months at the start with an incomplete
    // window and the three the hole sits inside. odi loses the first twelve
    // months of ebar as well.
    for (const series of dataset.rateSeries) {
      const { ebar, odi } = publishedSeries(series, '2000-01', dataset.latest);
      const excessCount = periodRange('2000-01', dataset.latest).filter(
        (period) =>
          series.groupRates.get(period) !== undefined &&
          series.aggregateRates.get(period) !== undefined,
      ).length;
      expect(excessCount, series.groupKey).toBe(318);
      expect(ebar.size, series.groupKey).toBe(314);
      expect(odi.size, series.groupKey).toBe(302);
      expect(314 - 12).toBe(302);
    }
  });

  it('has no smoothed value across the hole and one again in January 2026', () => {
    const { ebar, odi } = publishedSeries(dataset.rateSeries[0]!, '2000-01', dataset.latest);
    for (const period of ['2000-01', '2000-02', '2025-10', '2025-11', '2025-12']) {
      expect(ebar.has(period), period).toBe(false);
    }
    expect(ebar.has('2026-01')).toBe(true);
    // 2026-01 differences against 2025-01, which the hole does not touch.
    expect(odi.has('2026-01')).toBe(true);
    expect(odi.has('2010-01')).toBe(true);
  });

  it('publishes the ODI from the published smoothed values, not the raw ones', () => {
    // The two paths disagree by a cent on 1,006 of the 4,530 historical values.
    // No trigger flips either way; the count is what catches the wrong path.
    let total = 0;
    let differing = 0;
    for (const series of dataset.rateSeries) {
      const { odi, odiFromRaw } = publishedSeries(series, '2000-01', dataset.latest);
      for (const [period, value] of odi) {
        total += 1;
        const raw = odiFromRaw.get(period);
        if (raw !== undefined && Math.abs(raw - value) > 1e-9) differing += 1;
      }
    }
    expect(total).toBe(4530);
    expect(differing).toBe(1006);
  });
});

describe('the frozen calibration', () => {
  it('is what the archive gives today', () => {
    const recomputed = calibrateDataset(dataset, defaultWindows(dataset.latest));
    for (const series of recomputed) {
      const entry = frozen.series.find((e) => e.group_key === series.groupKey);
      expect(entry, series.groupKey).toBeDefined();
      expect(entry?.attachment_shock, series.groupKey).toBe(series.attachmentShock);
      expect(entry?.level_line, series.groupKey).toBe(series.levelLine);
      expect(entry?.level_line_by_month, series.groupKey).toEqual(series.levelLineByMonth);
      expect(entry?.baseline_p95, series.groupKey).toBe(series.baseline.p95);
      expect(entry?.baseline_p50, series.groupKey).toBe(series.baseline.p50);
    }
  });

  it('reproduces the published table in docs/INDEX-FINDINGS.md section 4', () => {
    const expected: Record<string, [number, number, number, number]> = {
      // group_key: A, L, base p50, base p95
      management_business_financial: [1.5, -0.98, -2.97, -1.73],
      professional_related: [1.5, -0.62, -2.9, -1.37],
      service: [1.5, 2.28, 1.03, 1.53],
      sales_related: [1.5, 1.15, 0.0, 0.4],
      office_admin_support: [1.5, 0.85, -0.37, 0.1],
      farming_fishing_forestry: [5.5, 12.25, 5.27, 11.5],
      construction_extraction: [3.5, 12.78, 3.87, 12.03],
      installation_maintenance_repair: [2.0, 0.65, -1.2, -0.1],
      production: [2.5, 3.72, 0.93, 2.97],
      transportation_material_moving: [1.5, 4.35, 1.7, 3.6],
      computer_math: [2.0, -0.68, -3.17, -1.43],
      legal: [2.5, -1.32, -3.87, -2.07],
      arts_design_ent_media: [3.0, 1.32, -0.57, 0.57],
      business_financial_ops: [1.5, -0.38, -2.47, -1.13],
      education_training_library: [2.0, 1.62, -2.73, 0.87],
    };
    expect(frozen.series).toHaveLength(15);
    for (const entry of frozen.series) {
      const row = expected[entry.group_key];
      expect(row, entry.group_key).toBeDefined();
      const [a, l, p50, p95] = row as [number, number, number, number];
      expect(entry.attachment_shock, `${entry.group_key} A`).toBe(a);
      expect(entry.level_line, `${entry.group_key} L`).toBe(l);
      expect(entry.baseline_p50, `${entry.group_key} p50`).toBe(p50);
      expect(entry.baseline_p95, `${entry.group_key} p95`).toBe(p95);
      // L is the baseline p95 plus 0.75, published at two decimals.
      expect(fmt2(entry.baseline_p95 + 0.75), entry.group_key).toBe(fmt2(entry.level_line));
    }
  });

  it('uses 120 baseline months and 172 months of ODI for sigma', () => {
    const recomputed = calibrateDataset(dataset, defaultWindows(dataset.latest));
    for (const series of recomputed) {
      // 2010-01 to 2019-12 is 120 months and every one of them has an ebar.
      expect(series.baseline.n, series.groupKey).toBe(120);
      // 2010-01 to 2026-07 is 199 months, less the 24 excluded and the 3 with
      // no ODI because the hole sits in their window.
      expect(series.shock.n, series.groupKey).toBe(199 - 24 - 3);
      expect(series.shock.n).toBe(172);
    }
  });

  it('prints three population sigma to four decimals as the published diagnostic', () => {
    const expected: Record<string, number> = {
      management_business_financial: 1.0604,
      professional_related: 1.2461,
      service: 1.5788,
      sales_related: 1.0478,
      office_admin_support: 0.95,
      farming_fishing_forestry: 5.4006,
      construction_extraction: 3.3697,
      installation_maintenance_repair: 1.9187,
      production: 2.4522,
      transportation_material_moving: 1.664,
      computer_math: 1.9398,
      legal: 2.6437,
      arts_design_ent_media: 2.8639,
      business_financial_ops: 1.5082,
      education_training_library: 1.7947,
    };
    // Population and sample sigma move no attachment on this data, so a suite
    // that checks only A cannot tell them apart. The diagnostic can.
    for (const series of calibrateDataset(dataset, defaultWindows(dataset.latest))) {
      expect(Number(series.shock.threeSigma.toFixed(4)), series.groupKey).toBe(
        expected[series.groupKey],
      );
      expect(series.shock.sampleSd).toBeGreaterThan(series.shock.popSd);
    }
  });

  it('gives the same attachment from the raw ODI path', () => {
    // The two paths must not drift apart later without the suite noticing.
    const windows = defaultWindows(dataset.latest);
    for (const series of dataset.rateSeries) {
      const { odiFromRaw } = publishedSeries(series, windows.baselineFrom, windows.sigmaTo);
      const values: number[] = [];
      for (const period of periodRange(windows.sigmaFrom, windows.sigmaTo)) {
        if (period >= windows.sigmaExcludeFrom && period <= windows.sigmaExcludeTo) continue;
        const value = odiFromRaw.get(period);
        if (value !== undefined) values.push(value);
      }
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      const sigma = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
      const attachment = Math.max(1.5, Math.floor(2 * (3 * sigma) + 0.5) / 2);
      const entry = frozen.series.find((e) => e.group_key === series.groupKey);
      expect(attachment, series.groupKey).toBe(entry?.attachment_shock);
    }
  });
});

describe('the backtest, 2010-01 to the archive end', () => {
  it('opens exactly 99 group months and no others', () => {
    const expected: Record<string, string[]> = {
      management_business_financial: [
        '2021-05:shock', '2021-06:shock', '2021-07:shock', '2021-08:shock',
      ],
      professional_related: ['2021-06:shock', '2021-07:shock'],
      service: [
        '2020-04:both', '2020-05:both', '2020-06:both', '2020-07:both', '2020-08:both',
        '2020-09:both', '2020-10:both', '2020-11:both', '2020-12:both', '2021-01:both',
        '2021-02:both', '2021-03:both', '2021-04:level', '2021-05:level',
      ],
      sales_related: ['2020-05:level', '2020-06:both', '2020-07:both'],
      office_admin_support: [],
      farming_fishing_forestry: [
        '2010-02:level', '2010-03:level', '2021-06:shock', '2021-07:shock',
      ],
      construction_extraction: [
        '2010-01:shock', '2010-02:level', '2010-03:level', '2010-04:level',
      ],
      installation_maintenance_repair: [],
      production: [
        '2010-01:level', '2010-02:level', '2010-03:level', '2010-04:level', '2010-05:level',
      ],
      transportation_material_moving: [
        '2010-03:level', '2010-04:level', '2020-04:shock', '2020-05:shock', '2020-06:shock',
        '2020-07:both', '2020-08:shock', '2020-09:shock', '2020-10:shock', '2020-11:shock',
        '2020-12:shock', '2021-01:shock',
      ],
      computer_math: [
        '2021-05:shock', '2021-06:shock', '2021-07:shock', '2021-11:shock', '2021-12:shock',
        '2022-01:shock', '2022-08:shock', '2026-04:level', '2026-05:level',
      ],
      legal: [
        '2011-02:shock', '2011-03:shock', '2021-05:shock', '2021-06:shock', '2021-07:shock',
        '2021-08:shock', '2021-09:shock',
      ],
      arts_design_ent_media: [
        '2020-04:level', '2020-05:level', '2020-06:both', '2020-07:both', '2020-08:both',
        '2020-09:both', '2020-10:level', '2020-11:level', '2020-12:level', '2021-01:both',
        '2021-02:level', '2021-03:level', '2021-04:level', '2021-05:level', '2021-06:level',
        '2021-07:level', '2021-08:level', '2022-01:level', '2022-02:level', '2022-03:level',
        '2025-01:level', '2025-02:level', '2025-03:level', '2025-04:level', '2026-01:level',
        '2026-02:level',
      ],
      business_financial_ops: [
        '2021-05:shock', '2021-06:shock', '2021-07:shock', '2021-08:shock', '2021-09:shock',
      ],
      education_training_library: [
        '2018-08:level', '2019-08:level', '2020-08:level', '2022-08:level',
      ],
    };
    let rows = 0;
    for (const [groupKey, observations] of backtest) {
      const open = observations
        .filter((o) => o.open)
        .map((o) => `${o.period}:${o.openReason}`);
      expect(open, groupKey).toEqual(expected[groupKey]);
      rows += open.length;
    }
    expect(rows).toBe(99);
  });

  it('has two occupations that have never been triggerable since 2010', () => {
    // This sentence goes on the index screen, so the suite owns it.
    expect(backtest.get('office_admin_support')?.every((o) => !o.open)).toBe(true);
    expect(backtest.get('installation_maintenance_repair')?.every((o) => !o.open)).toBe(true);
  });

  it('opens on equality, on both forms', () => {
    const shockEquality = backtest
      .get('business_financial_ops')
      ?.find((o) => o.period === '2021-09');
    expect(shockEquality?.odi).toBe(1.5);
    expect(shockEquality?.attachmentShock).toBe(1.5);
    expect(shockEquality?.openReason).toBe('shock');

    const levelEquality = backtest
      .get('education_training_library')
      ?.find((o) => o.period === '2019-08');
    expect(levelEquality?.ebar).toBe(2.0);
    expect(levelEquality?.levelLine).toBe(1.62);
    expect(levelEquality?.openReason).toBe('level');
  });

  it('prints no negative zero for an ODI of exactly zero', () => {
    const zero = backtest.get('arts_design_ent_media')?.find((o) => o.period === '2022-02');
    expect(zero?.odi).toBe(0);
    expect(fmt2(zero?.odi ?? null)).toBe('0.00');
    expect(zero?.openReason).toBe('level');
  });

  it('keeps the near misses closed', () => {
    // Arts is 0.02 short in the archive's last year.
    const arts = backtest.get('arts_design_ent_media')?.find((o) => o.period === '2026-07');
    expect(arts?.ebar).toBe(1.3);
    expect(arts?.levelLine).toBe(1.32);
    expect(arts?.open).toBe(false);

    const computer = backtest.get('computer_math')?.find((o) => o.period === '2026-06');
    expect(computer?.ebar).toBe(-1.0);
    expect(computer?.open).toBe(false);
  });

  it('leaves the exclusion window out of sigma and not out of the backtest', () => {
    // The exclusion changes the attachment; it never changes whether a month
    // was open.
    const computer = backtest.get('computer_math');
    for (const period of ['2021-11', '2021-12', '2022-01']) {
      expect(computer?.find((o) => o.period === period)?.openReason, period).toBe('shock');
    }
  });
});

describe('the 2020 stress case', () => {
  it('opens exactly three bindable series in April 2020', () => {
    // The relative definition is doing its job: unemployment more than doubled
    // for every group and the index opened three of fifteen.
    const open = [...backtest.entries()]
      .map(([groupKey, rows]) => ({
        groupKey,
        row: rows.find((o) => o.period === '2020-04'),
      }))
      .filter((entry) => entry.row?.open);
    expect(open.map((e) => `${e.groupKey}:${e.row?.openReason}`)).toEqual([
      'service:both',
      'transportation_material_moving:shock',
      'arts_design_ent_media:level',
    ]);
  });

  it('leaves computer and mathematical far closed in April 2020, at an excess of -10.10', () => {
    const row = backtest.get('computer_math')?.find((o) => o.period === '2020-04');
    expect(row?.e).toBe(-10.1);
    expect(row?.open).toBe(false);
  });

  it('peaks at service in June 2020 on both forms', () => {
    const inWindow = (period: string) => period >= '2020-01' && period <= '2021-12';
    let maxEbar = { groupKey: '', period: '', value: -Infinity };
    let maxOdi = { groupKey: '', period: '', value: -Infinity };
    for (const [groupKey, rows] of backtest) {
      for (const row of rows) {
        if (!inWindow(row.period)) continue;
        if (row.ebar !== null && row.ebar > maxEbar.value) {
          maxEbar = { groupKey, period: row.period, value: row.ebar };
        }
        if (row.odi !== null && row.odi > maxOdi.value) {
          maxOdi = { groupKey, period: row.period, value: row.odi };
        }
      }
    }
    expect(maxEbar).toEqual({ groupKey: 'service', period: '2020-06', value: 10.3 });
    expect(maxOdi).toEqual({ groupKey: 'service', period: '2020-06', value: 9.73 });
  });
});

describe('the demo window: computer and mathematical, 2025-01 to the archive end', () => {
  const rows = backtest.get('computer_math')!.filter((o) => o.period >= '2025-01');

  it('matches every published column, month by month', () => {
    const expected = [
      // period, u_g, u_all, e, ebar, ebar t-12, odi, level, shock, status
      ['2025-01', 2.9, 4.4, -1.5, -1.6, -1.6, 0.0, false, false, 'final'],
      ['2025-02', 3.3, 4.5, -1.2, -1.5, -1.23, -0.27, false, false, 'final'],
      ['2025-03', 3.1, 4.2, -1.1, -1.27, -1.13, -0.14, false, false, 'final'],
      ['2025-04', 3.5, 3.9, -0.4, -0.9, -0.77, -0.13, false, false, 'final'],
      ['2025-05', 3.4, 4.0, -0.6, -0.7, -0.93, 0.23, false, false, 'final'],
      ['2025-06', 2.8, 4.4, -1.6, -0.87, -0.83, -0.04, false, false, 'final'],
      ['2025-07', 2.9, 4.6, -1.7, -1.3, -1.03, -0.27, false, false, 'final'],
      ['2025-08', 3.0, 4.5, -1.5, -1.6, -0.97, -0.63, false, false, 'final'],
      ['2025-09', 3.9, 4.3, -0.4, -1.2, -1.23, 0.03, false, false, 'final'],
      ['2025-10', null, null, null, null, -1.23, null, false, false, 'no_source'],
      ['2025-11', 4.0, 4.3, -0.3, null, -1.4, null, false, false, 'insufficient_history'],
      ['2025-12', 3.3, 4.1, -0.8, null, -1.53, null, false, false, 'insufficient_history'],
      ['2026-01', 3.6, 4.7, -1.1, -0.73, -1.6, 0.87, false, false, 'final'],
      ['2026-02', 3.8, 4.7, -0.9, -0.93, -1.5, 0.57, false, false, 'final'],
      ['2026-03', 3.9, 4.3, -0.4, -0.8, -1.27, 0.47, false, false, 'final'],
      ['2026-04', 3.5, 4.0, -0.5, -0.6, -0.9, 0.3, true, false, 'final'],
      ['2026-05', 3.1, 4.1, -1.0, -0.63, -0.7, 0.07, true, false, 'final'],
      ['2026-06', 2.9, 4.4, -1.5, -1.0, -0.87, -0.13, false, false, 'final'],
      ['2026-07', 2.8, 4.4, -1.6, -1.37, -1.3, -0.07, false, false, 'final'],
    ];
    expect(rows).toHaveLength(19);
    expect(
      rows.map((r) => [
        r.period, r.uG, r.uAll, r.e, r.ebar, r.ebarBase, r.odi, r.levelOpen, r.shockOpen, r.status,
      ]),
    ).toEqual(expected);
  });

  it('turns on in April 2026 on the level form, by hand', () => {
    const april = rows.find((r) => r.period === '2026-04');
    // e for 2026-02, 2026-03 and 2026-04 is -0.90, -0.40 and -0.50.
    // ebar = (-0.90 + -0.40 + -0.50) / 3 = -1.80 / 3 = -0.60.
    // -0.60 >= -0.68, so the level form holds.
    // odi = -0.60 - (-0.90) = +0.30, nowhere near an attachment of 2.0.
    expect(april?.ebar).toBe(-0.6);
    expect(april?.levelLine).toBe(-0.68);
    expect(april?.odi).toBe(0.3);
    expect(april?.attachmentShock).toBe(2.0);
    expect(april?.openReason).toBe('level');
    expect(fmt2(april?.ebar ?? null)).toBe('-0.60');
    expect(fmt2(april?.odi ?? null)).toBe('0.30');
  });

  it('states the gap rather than filling it', () => {
    const october = rows.find((r) => r.period === '2025-10');
    expect(october?.status).toBe('no_source');
    expect([october?.uG, october?.e, october?.ebar, october?.odi]).toEqual([
      null, null, null, null,
    ]);
    expect(october?.open).toBe(false);
    for (const period of ['2025-11', '2025-12']) {
      const row = rows.find((r) => r.period === period);
      expect(row?.status, period).toBe('insufficient_history');
      expect(row?.e, period).not.toBeNull();
      expect(row?.ebar, period).toBeNull();
      expect(row?.odi, period).toBeNull();
    }
  });

  it('does not open December 2025 the way the hop-over reading would', () => {
    // The three most recent available months at 2025-12 are 2025-12, 2025-11 and
    // 2025-09: e -0.80, -0.30 and -0.40, whose mean is -0.50, which is above the
    // line of -0.68 and would open the month. The calendar window has no value
    // at all, so the month does not open, and two correct-looking
    // implementations would have settled different months.
    const hopOver = (-0.8 + -0.3 + -0.4) / 3;
    expect(Number(hopOver.toFixed(2))).toBe(-0.5);
    expect(hopOver).toBeGreaterThanOrEqual(-0.68);
    const december = rows.find((r) => r.period === '2025-12');
    expect(december?.ebar).toBeNull();
    expect(december?.open).toBe(false);
  });
});

describe('the not-bindable spare window', () => {
  it('opens food preparation and serving in March 2025 only, on the level form', () => {
    // docs/INDEX-FINDINGS.md section 5 offers February and March 2025 on the
    // shock form. That holds at the old generic attachment of 2.0 and not at
    // this series' own calibrated 3.5, so the spare is one month wide and on
    // the other form.
    const windows = defaultWindows(dataset.latest);
    const series = rateSeriesFor(dataset, 'LNU04034031', 'food_prep_serving');
    const calibration = calibrateDataset(
      { ...dataset, rateSeries: [series] },
      windows,
    )[0]!;
    expect(calibration.attachmentShock).toBe(3.5);
    expect(calibration.levelLine).toBe(3.82);
    const rows = evaluateDataset(
      { ...dataset, rateSeries: [series] },
      new Map([
        ['food_prep_serving', {
          attachmentShock: calibration.attachmentShock,
          levelLine: calibration.levelLine,
        }],
      ]),
      '2025-01',
      '2025-06',
    ).get('food_prep_serving')!;
    const february = rows.find((r) => r.period === '2025-02');
    const march = rows.find((r) => r.period === '2025-03');
    expect(february?.ebar).toBe(3.8);
    expect(february?.odi).toBe(2.13);
    expect(february?.open).toBe(false);
    expect(march?.ebar).toBe(3.87);
    expect(march?.odi).toBe(2.37);
    expect(march?.openReason).toBe('level');
  });
});

describe('the months the hole makes level-only, a year later', () => {
  it('gives October 2026 an ebar, a null ODI and the level form alone', () => {
    // The hole at 2025-10 removes the smoothed value at t-12 for 2026-10,
    // 2026-11 and 2026-12, so the shock form is not evaluable for any series in
    // those months. Append three plausible months to the archive's rates to
    // reach 2026-10; the appended values are arbitrary and only the shape of
    // the result is asserted.
    const series = dataset.rateSeries.find((s) => s.groupKey === 'computer_math')!;
    const groupRates = new Map(series.groupRates);
    const aggregateRates = new Map(series.aggregateRates);
    for (const [period, uG, uAll] of [
      ['2026-08', 3.1, 4.3],
      ['2026-09', 3.2, 4.2],
      ['2026-10', 3.3, 4.1],
    ] as const) {
      groupRates.set(period, uG);
      aggregateRates.set(period, uAll);
    }
    const rows = evaluateDataset(
      { ...dataset, rateSeries: [{ ...series, groupRates, aggregateRates }] },
      parameters,
      '2026-09',
      '2026-10',
    ).get('computer_math')!;

    const october = rows.find((r) => r.period === '2026-10')!;
    // ebar = (-0.80 + -1.00 + -1.20) / 3 = -1.00
    expect(october.ebar).toBe(-1.0);
    expect(october.ebarBase).toBeNull();
    expect(october.odi).toBeNull();
    expect(october.forms).toEqual(['level']);
    expect(october.status).toBe('final');
    // The level comparison still runs; -1.00 is below the line of -0.68.
    expect(october.levelOpen).toBe(false);
    expect(october.open).toBe(false);

    // September 2026 is unaffected: its base month 2025-09 is intact.
    const september = rows.find((r) => r.period === '2026-09')!;
    expect(september.forms).toEqual(['shock', 'level']);
    expect(september.odi).not.toBeNull();
  });
});
