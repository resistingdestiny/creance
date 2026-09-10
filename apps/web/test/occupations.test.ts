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

  it('has one occupation with capacity behind it today', () => {
    const covered = OCCUPATIONS.filter(hasCover);
    expect(covered.map((row) => row.key)).toEqual(['computer_math']);
    expect(covered[0]?.series).toBe('ODI-COMP-2026-01');
  });

  it('marks the two occupations whose claims have never opened since 2010', () => {
    const never = OCCUPATIONS.filter((row) => row.lastOpenPeriod === null);
    expect(never.map((row) => row.key)).toEqual([
      'office_admin_support',
      'installation_maintenance_repair',
    ]);
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
  it('puts what can be bought first and sinks the rest, in the addendum order inside each part', () => {
    const groups = groupOccupations(OCCUPATIONS);
    expect(groups.open.map((row) => row.key)).toEqual(['computer_math']);
    expect(groups.noCover).toHaveLength(14);
    expect(groups.noCover[0]?.key).toBe('office_admin_support');
    expect(groups.noCover.at(-1)?.key).toBe('farming_fishing_forestry');
  });

  it('groups a filtered list, so a search matching only unbuyable rows still shows them', () => {
    const groups = groupOccupations(filterOccupations('legal'));
    expect(groups.open).toHaveLength(0);
    expect(groups.noCover.map((row) => row.key)).toEqual(['legal']);
  });
});

describe('findOccupation', () => {
  it('answers null for an unknown or absent key', () => {
    expect(findOccupation('not_a_group')).toBeNull();
    expect(findOccupation(null)).toBeNull();
  });
});
