import { describe, expect, it } from 'vitest';

import { evaluateDataset, frozenParameters, loadCalibration, loadDataset } from '../src/dataset.js';
import { monthOf } from '../src/period.js';

/**
 * Version 1 freezes one level line per series. The pre-kick-off decision on the
 * seasonality of the level form asks for a line per calendar month, and for a
 * guard against base effects on the shock form. Both are implemented here as
 * selectable modes and both are compared against the frozen set, because the
 * difference is a product decision rather than an implementation detail.
 */
const dataset = loadDataset();
const frozen = loadCalibration();
const parameters = frozenParameters(frozen);

const single = evaluateDataset(dataset, parameters, '2010-01', dataset.latest);
const monthMatched = evaluateDataset(dataset, parameters, '2010-01', dataset.latest, {
  levelLineMode: 'month_matched',
  baseEffectGuard: false,
});

function openPeriods(rows: Map<string, { period: string; open: boolean }[]>, groupKey: string) {
  return rows.get(groupKey)!.filter((r) => r.open).map((r) => r.period);
}

describe('the frozen mode', () => {
  it('is the single line with no base-effect guard', () => {
    expect(frozen.level_line_mode).toBe('single');
    expect(frozen.base_effect_guard).toBe(false);
  });

  it('carries twelve month-matched lines per series alongside the single one', () => {
    for (const entry of frozen.series) {
      expect(entry.level_line_by_month, entry.group_key).toHaveLength(12);
    }
  });
});

describe('the seasonality the level form reads as displacement', () => {
  it('puts every education opening in August under the single line', () => {
    // Not seasonally adjusted data, and BLS publishes no seasonally adjusted
    // occupation rates, so there is nothing to switch to. August is the school
    // year trough and it is what the level form is finding.
    const months = openPeriods(single, 'education_training_library').map(monthOf);
    expect(months).toEqual([8, 8, 8, 8]);
  });

  it('puts every farming level opening between February and April', () => {
    const levelOpenings = single
      .get('farming_fishing_forestry')!
      .filter((r) => r.open && r.openReason === 'level')
      .map((r) => monthOf(r.period));
    expect(levelOpenings.every((month) => month >= 2 && month <= 4)).toBe(true);
  });

  it('removes all four August openings for education when the line is month matched', () => {
    // Compared with its own August history, an August reading is ordinary.
    expect(openPeriods(single, 'education_training_library')).toEqual([
      '2018-08', '2019-08', '2020-08', '2022-08',
    ]);
    const matched = openPeriods(monthMatched, 'education_training_library');
    expect(matched).toEqual(['2020-04', '2020-05']);
    expect(matched.map(monthOf)).not.toContain(8);
  });
});

describe('what the month-matched line does to the demo series', () => {
  it('draws an April line of -1.35 rather than -0.68', () => {
    const entry = frozen.series.find((e) => e.group_key === 'computer_math')!;
    expect(entry.level_line).toBe(-0.68);
    // Index 3 is April.
    expect(entry.level_line_by_month[3]).toBe(-1.35);
  });

  it('turns the demo from one opening into a standing condition since 2023', () => {
    // Under the frozen line the story is "opens in April 2026 on official data".
    expect(openPeriods(single, 'computer_math').filter((p) => p >= '2023-01')).toEqual([
      '2026-04', '2026-05',
    ]);
    // Under month-matched lines it becomes "open most months since April 2023",
    // which is a different product, not a tuning difference.
    const matched = openPeriods(monthMatched, 'computer_math').filter((p) => p >= '2023-01');
    expect(matched).toEqual([
      '2023-04', '2023-05',
      '2024-03', '2024-04', '2024-05', '2024-06', '2024-07', '2024-08',
      '2025-03', '2025-04', '2025-05', '2025-06', '2025-07', '2025-09',
      '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07',
    ]);
    expect(matched).toHaveLength(21);
  });

  it('costs office and administrative support its honesty line', () => {
    // "This cover has never paid for this occupation since 2010" is on the first
    // screen a judge sees. It is true under the frozen line and false under the
    // month-matched one.
    expect(openPeriods(single, 'office_admin_support')).toEqual([]);
    expect(openPeriods(monthMatched, 'office_admin_support')).toEqual(['2019-07']);
  });

  it('opens more months overall, for arts, farming and installation among others', () => {
    const count = (rows: typeof single) =>
      [...rows.values()].reduce((total, obs) => total + obs.filter((o) => o.open).length, 0);
    expect(count(single)).toBe(99);
    expect(count(monthMatched)).toBe(154);
    for (const groupKey of [
      'arts_design_ent_media',
      'farming_fishing_forestry',
      'installation_maintenance_repair',
    ]) {
      expect(
        openPeriods(monthMatched, groupKey).length,
        groupKey,
      ).toBeGreaterThan(openPeriods(single, groupKey).length);
    }
  });
});

describe('the base-effect guard', () => {
  it('suppresses nothing in the published history', () => {
    // The guard is real and tested on synthetic data. On the archive, under the
    // frozen parameters and under month-matched lines, no shock-only opening has
    // a base period that was itself open, so switching it on changes no month.
    // That is worth stating rather than leaving a reader to assume it bites.
    for (const mode of ['single', 'month_matched'] as const) {
      const guarded = evaluateDataset(dataset, parameters, '2010-01', dataset.latest, {
        levelLineMode: mode,
        baseEffectGuard: true,
      });
      const unguarded = evaluateDataset(dataset, parameters, '2010-01', dataset.latest, {
        levelLineMode: mode,
        baseEffectGuard: false,
      });
      for (const [groupKey, rows] of guarded) {
        expect(rows.filter((r) => r.guardSuppressed), `${mode} ${groupKey}`).toEqual([]);
        expect(
          rows.filter((r) => r.open).map((r) => r.period),
          `${mode} ${groupKey}`,
        ).toEqual(unguarded.get(groupKey)!.filter((r) => r.open).map((r) => r.period));
      }
    }
  });
});

describe('the generic attachment the backlog asks to publish', () => {
  it('opens 93 group months at a flat 2.0 on the shock form', () => {
    const generic = evaluateDataset(dataset, parameters, '2010-01', dataset.latest, {
      levelLineMode: 'single',
      baseEffectGuard: false,
      attachmentOverride: 2.0,
      shockOnly: true,
    });
    const total = [...generic.values()].reduce(
      (sum, rows) => sum + rows.filter((r) => r.open).length,
      0,
    );
    expect(total).toBe(93);
  });

  it('shows why a flat attachment is wrong: farming opens 28 times', () => {
    // Farming opens on sampling noise at a flat 2.0, and office and
    // administrative support could not open at any plausible flat level.
    const generic = evaluateDataset(dataset, parameters, '2010-01', dataset.latest, {
      levelLineMode: 'single',
      baseEffectGuard: false,
      attachmentOverride: 2.0,
      shockOnly: true,
    });
    const farming = generic.get('farming_fishing_forestry')!.filter((r) => r.open);
    expect(farming).toHaveLength(28);
    expect(
      farming.filter((r) => r.period < '2020-01' || r.period > '2021-12'),
    ).toHaveLength(22);
    expect(generic.get('office_admin_support')!.filter((r) => r.open)).toHaveLength(0);
  });
});
