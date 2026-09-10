/**
 * The fifteen occupation groups the purchase flow offers, in the picker's
 * order.
 *
 * The order and the on-screen labels are the "Occupation picker correction" in
 * docs/DESIGN-TOKENS-ADDENDUM.md: fifteen rows, no armed forces row, detailed
 * groups rendering exactly like the majors. The keys are the API's own group
 * keys, which are the enum in recipes/bazantic/openapi.yaml and the rows
 * `pnpm api:migrate` seeds.
 *
 * T38 adds the two headings the addendum's flat list did not have: what can be
 * bought comes first, what cannot sinks to the bottom, and each part says what
 * it is. The addendum order survives as the order inside each part, and
 * `groupOccupations` is the one place the split is made, so the standalone
 * picker and the landing quote cannot group the list differently.
 *
 * Two labels here differ from packages/index-model/src/series.ts, which spells
 * them "Management, business and financial operations" and "Arts, design,
 * entertainment, sports and media". The addendum wins for on-screen copy; the
 * index model's label is what the index publishes and is not shown in the
 * worker flow.
 *
 * `series` is the Displacement Bond Note series that carries capacity for the
 * group. Capacity is committed per occupation (docs/DECISIONS.md), so an
 * occupation with no series has no price rather than a price nobody can buy,
 * and the picker says so. One series exists today, ODI-COMP-2026-01 for
 * computer and mathematical (docs/HEDERA.md, "The demo series"). There is no
 * endpoint that lists series, so this is the same shape as the investor
 * screens' DEFAULT_SERIES_ID and the same thing would replace both.
 *
 * `lastOpenPeriod` is from the backtest in docs/INDEX.md, every month from
 * 2010-01 to 2026-07 at the frozen per-series calibration. Null means claims
 * have never opened for the occupation since 2010, which is true of two of the
 * fifteen and is the one fact a buyer most needs on the first screen.
 */

export interface Occupation {
  readonly key: string;
  readonly label: string;
  /** The series behind the occupation, or null when nothing has been issued. */
  readonly series: string | null;
  /** The last month the index opened claims, or null for never since 2010. */
  readonly lastOpenPeriod: string | null;
}

export const OCCUPATIONS: readonly Occupation[] = [
  {
    key: 'office_admin_support',
    label: 'Office and administrative support',
    series: null,
    lastOpenPeriod: null,
  },
  {
    key: 'computer_math',
    label: 'Computer and mathematical',
    series: 'ODI-COMP-2026-01',
    lastOpenPeriod: '2026-05',
  },
  {
    key: 'management_business_financial',
    label: 'Management, business and financial',
    series: null,
    lastOpenPeriod: '2021-08',
  },
  {
    key: 'professional_related',
    label: 'Professional and related',
    series: null,
    lastOpenPeriod: '2021-07',
  },
  {
    key: 'business_financial_ops',
    label: 'Business and financial operations',
    series: null,
    lastOpenPeriod: '2021-09',
  },
  { key: 'legal', label: 'Legal', series: null, lastOpenPeriod: '2021-09' },
  {
    key: 'arts_design_ent_media',
    label: 'Arts, design, entertainment and media',
    series: null,
    lastOpenPeriod: '2026-02',
  },
  {
    key: 'education_training_library',
    label: 'Education, training and library',
    series: null,
    lastOpenPeriod: '2022-08',
  },
  { key: 'sales_related', label: 'Sales and related', series: null, lastOpenPeriod: '2020-07' },
  { key: 'service', label: 'Service', series: null, lastOpenPeriod: '2021-05' },
  { key: 'production', label: 'Production', series: null, lastOpenPeriod: '2010-05' },
  {
    key: 'transportation_material_moving',
    label: 'Transportation and material moving',
    series: null,
    lastOpenPeriod: '2021-01',
  },
  {
    key: 'installation_maintenance_repair',
    label: 'Installation, maintenance and repair',
    series: null,
    lastOpenPeriod: null,
  },
  {
    key: 'construction_extraction',
    label: 'Construction and extraction',
    series: null,
    lastOpenPeriod: '2010-04',
  },
  {
    key: 'farming_fishing_forestry',
    label: 'Farming, fishing and forestry',
    series: null,
    lastOpenPeriod: '2021-07',
  },
];

export function findOccupation(key: string | null | undefined): Occupation | null {
  if (!key) return null;
  return OCCUPATIONS.find((occupation) => occupation.key === key) ?? null;
}

/** The label the whole worker flow uses for a group, never re-spelled per screen. */
export function occupationLabel(key: string): string {
  return findOccupation(key)?.label ?? key;
}

/**
 * The picker's search field, as a filter over the fifteen labels and nothing
 * else: case-insensitive substring, no fuzzy matching and no synonyms. A person
 * who types a job title gets nothing, which is honest, because this product
 * covers occupation groups and not job titles.
 */
export function filterOccupations(
  query: string,
  rows: readonly Occupation[] = OCCUPATIONS,
): readonly Occupation[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return rows;
  return rows.filter((row) => row.label.toLowerCase().includes(needle));
}

/** True when the occupation has a series behind it and can be bought today. */
export function hasCover(occupation: Occupation): boolean {
  return occupation.series !== null;
}

export interface OccupationGroups {
  /** The rows with a series behind them, which are the ones that can be bought. */
  readonly open: readonly Occupation[];
  /** The rows with nothing committed behind them yet. */
  readonly noCover: readonly Occupation[];
}

/**
 * T38: the list admits its shape. What can be bought comes first, what cannot
 * sinks to the bottom, and the boundary is a heading, not something a person
 * infers from a caption. Both pickers filter first and group after, so a
 * search that matches only unbuyable occupations still shows them, under
 * their own heading.
 */
export function groupOccupations(rows: readonly Occupation[]): OccupationGroups {
  return {
    open: rows.filter(hasCover),
    noCover: rows.filter((row) => !hasCover(row)),
  };
}
