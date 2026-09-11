import { describe, expect, it } from 'vitest';

import {
  OCCUPATIONS,
  filterOccupations,
  findOccupation,
  groupOccupations,
  hasCover,
  occupationLabel,
} from '../src/lib/occupations.js';

describe('the occupation picker rows', () => {
  it('carries fifteen rows and no armed forces row', () => {
    expect(OCCUPATIONS).toHaveLength(15);
    expect(OCCUPATIONS.map((row) => row.label)).not.toContain('Armed forces');
  });

  it('is in the addendum order, with office and administrative support first', () => {
    expect(OCCUPATIONS.map((row) => row.label)).toEqual([
      'Office and administrative support',
      'Computer and mathematical',
      'Management, business and financial',
      'Professional and related',
      'Business and financial operations',
      'Legal',
      'Arts, design, entertainment and media',
      'Education, training and library',
      'Sales and related',
      'Service',
      'Production',
      'Transportation and material moving',
      'Installation, maintenance and repair',
      'Construction and extraction',
      'Farming, fishing and forestry',
    ]);
  });

  it('keys every row to a group the API answers for', () => {
    // The fifteen keys the API seeds, confirmed one by one against
    // GET /v1/index/:group on 5 September 2026.
    expect([...OCCUPATIONS].map((row) => row.key).sort()).toEqual(
      [
        'arts_design_ent_media',
        'business_financial_ops',
        'computer_math',
        'construction_extraction',
        'education_training_library',
        'farming_fishing_forestry',
        'installation_maintenance_repair',
        'legal',
        'management_business_financial',
        'office_admin_support',
        'production',
        'professional_related',
        'sales_related',
        'service',
        'transportation_material_moving',
      ].sort(),
    );
  });

  it('has capacity behind every occupation, one series each', () => {
    const covered = OCCUPATIONS.filter(hasCover);
    expect(covered).toHaveLength(OCCUPATIONS.length);
    expect(findOccupation('computer_math')?.series).toBe('ODI-COMP-2026-01');
    // The copy deck's worked example, which could not be bought until T39.
    expect(findOccupation('office_admin_support')?.series).toBe('ODI-OFFC-2026-01');
  });

  it('gives every occupation a series of its own', () => {
    const series = OCCUPATIONS.map((row) => row.series);
    expect(new Set(series).size).toBe(OCCUPATIONS.length);
    for (const label of series) expect(label).toMatch(/^ODI-[A-Z]{4}-2026-01$/);
  });

  it('marks the two occupations whose claims have never opened since 2010', () => {
    const never = OCCUPATIONS.filter((row) => row.lastOpenPeriod === null);
    expect(never.map((row) => row.key)).toEqual([
      'office_admin_support',
      'installation_maintenance_repair',
    ]);
  });

  it('marks the five occupations whose level line has never been reached since 2000', () => {
    // T56. The five whose all time maximum smoothed excess sits under the
    // frozen level line across the whole published history, 2000 to 2026.
    // Legal is not one of them: its level column in the 2010 backtest is also
    // zero, but it reached its line once in 2007.
    const never = OCCUPATIONS.filter((row) => row.levelLineNeverReached);
    expect(never.map((row) => row.key)).toEqual([
      'office_admin_support',
      'management_business_financial',
      'professional_related',
      'business_financial_ops',
      'installation_maintenance_repair',
    ]);
    expect(findOccupation('legal')?.levelLineNeverReached).toBe(false);
    expect(findOccupation('computer_math')?.levelLineNeverReached).toBe(false);
  });

  it('spells two labels the addendum way, not the index model way', () => {
    expect(occupationLabel('management_business_financial')).toBe(
      'Management, business and financial',
    );
    expect(occupationLabel('arts_design_ent_media')).toBe(
      'Arts, design, entertainment and media',
    );
  });
});

describe('the search field', () => {
  it('filters on a case-insensitive substring of the label', () => {
    expect(filterOccupations('COMPUT').map((row) => row.key)).toEqual(['computer_math']);
  });

  it('returns every row for an empty query', () => {
    expect(filterOccupations('   ')).toHaveLength(15);
  });

  it('finds nothing for a job title, because the product covers groups', () => {
    expect(filterOccupations('programmer')).toHaveLength(0);
  });
});

describe('groupOccupations', () => {
  it('puts every occupation in the open part, because all fifteen have a series', () => {
    const groups = groupOccupations(OCCUPATIONS);
    expect(groups.open).toHaveLength(15);
    expect(groups.open[0]?.key).toBe('office_admin_support');
    expect(groups.open.at(-1)?.key).toBe('farming_fishing_forestry');
    expect(groups.noCover).toHaveLength(0);
  });

  it('still sinks an occupation with no series under the second part', () => {
    // Nothing in the catalogue has a null series now. The partition is what
    // T38 added and it has to keep working the day a series is retired, so it
    // is exercised against a list built for it rather than the catalogue.
    const withCover = OCCUPATIONS[1]!;
    const groups = groupOccupations([
      { ...OCCUPATIONS[0]!, key: 'no_series', series: null },
      withCover,
    ]);
    expect(groups.open.map((row) => row.key)).toEqual([withCover.key]);
    expect(groups.noCover.map((row) => row.key)).toEqual(['no_series']);
  });

  it('groups a filtered list, keeping the order the filter returned', () => {
    const groups = groupOccupations(filterOccupations('legal'));
    expect(groups.open.map((row) => row.key)).toEqual(['legal']);
    expect(groups.noCover).toHaveLength(0);
  });
});

describe('findOccupation', () => {
  it('answers null for an unknown or absent key', () => {
    expect(findOccupation('not_a_group')).toBeNull();
    expect(findOccupation(null)).toBeNull();
  });
});
