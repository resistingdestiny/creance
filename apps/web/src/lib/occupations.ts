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
 * and the picker says so. All fifteen have one now: ODI-COMP-2026-01 for
 * computer and mathematical, the demo series, and one per group beside it
 * (docs/HEDERA.md, "The series"). The API answers GET /v1/series with the same
 * list, live from the deployment record, and that is what the investor screens
 * read; this stays a constant because the picker is rendered on the first
 * screen a person sees and must not wait on the API to say what is buyable.
 * A series that is registered but absent here reads as no cover, which is the
 * safe direction to be wrong in.
 *
 * `lastOpenPeriod` is from the backtest in docs/INDEX.md, every month from
 * 2010-01 to 2026-07 at the frozen per-series calibration. Null means claims
 * have never opened for the occupation since 2010, which is true of two of the
 * fifteen and is the one fact a buyer most needs on the first screen.
 *
 * `levelLineNeverReached` is the second such fact (T56). Five of the fifteen
 * have a level line that the smoothed excess has never reached in the whole
 * published history, 2000 to 2026: the all time maximum sits 0.25 to 0.52
 * points under the line. A distance to that line is not a countdown and the
 * row says so. The five come from a check of every series against its all time
 * maximum, recorded in docs/DECISIONS.md under T56; they are not the level
 * column of docs/INDEX.md, which is also zero for legal, and legal reached its
 * line once in 2007, before the backtest window. It is a constant for the same
 * reason `lastOpenPeriod` is: the picker never waits on the API, and the API
 * caps the history it serves well short of twenty six years.
 */

export interface Occupation {
  readonly key: string;
  readonly label: string;
  /** The series behind the occupation, or null when nothing has been issued. */
  readonly series: string | null;
  /** The last month the index opened claims, or null for never since 2010. */
  readonly lastOpenPeriod: string | null;
  /** True when the level line has never been reached in the published history since 2000. */
  readonly levelLineNeverReached: boolean;
}

export const OCCUPATIONS: readonly Occupation[] = [
  {
    key: 'office_admin_support',
    label: 'Office and administrative support',
    series: 'ODI-OFFC-2026-01',
    lastOpenPeriod: null,
    levelLineNeverReached: true,
  },
  {
    key: 'computer_math',
    label: 'Computer and mathematical',
    series: 'ODI-COMP-2026-01',
    lastOpenPeriod: '2026-05',
    levelLineNeverReached: false,
  },
  {
    key: 'management_business_financial',
    label: 'Management, business and financial',
    series: 'ODI-MGMT-2026-01',
    lastOpenPeriod: '2021-08',
    levelLineNeverReached: true,
  },
  {
    key: 'professional_related',
    label: 'Professional and related',
    series: 'ODI-PROF-2026-01',
    lastOpenPeriod: '2021-07',
    levelLineNeverReached: true,
  },
  {
    key: 'business_financial_ops',
    label: 'Business and financial operations',
    series: 'ODI-BUSF-2026-01',
    lastOpenPeriod: '2021-09',
    levelLineNeverReached: true,
  },
  {
    key: 'legal',
    label: 'Legal',
    series: 'ODI-LEGL-2026-01',
    lastOpenPeriod: '2021-09',
    levelLineNeverReached: false,
  },
  {
    key: 'arts_design_ent_media',
    label: 'Arts, design, entertainment and media',
    series: 'ODI-ARTS-2026-01',
    lastOpenPeriod: '2026-02',
    levelLineNeverReached: false,
  },
  {
    key: 'education_training_library',
    label: 'Education, training and library',
    series: 'ODI-EDUC-2026-01',
    lastOpenPeriod: '2022-08',
    levelLineNeverReached: false,
  },
  {
    key: 'sales_related',
    label: 'Sales and related',
    series: 'ODI-SALE-2026-01',
    lastOpenPeriod: '2020-07',
    levelLineNeverReached: false,
  },
  {
    key: 'service',
    label: 'Service',
    series: 'ODI-SERV-2026-01',
    lastOpenPeriod: '2021-05',
    levelLineNeverReached: false,
  },
  {
    key: 'production',
    label: 'Production',
    series: 'ODI-PROD-2026-01',
    lastOpenPeriod: '2010-05',
    levelLineNeverReached: false,
  },
  {
    key: 'transportation_material_moving',
    label: 'Transportation and material moving',
    series: 'ODI-TRAN-2026-01',
    lastOpenPeriod: '2021-01',
    levelLineNeverReached: false,
  },
  {
    key: 'installation_maintenance_repair',
    label: 'Installation, maintenance and repair',
    series: 'ODI-INMR-2026-01',
    lastOpenPeriod: null,
    levelLineNeverReached: true,
  },
  {
    key: 'construction_extraction',
    label: 'Construction and extraction',
    series: 'ODI-CNST-2026-01',
    lastOpenPeriod: '2010-04',
    levelLineNeverReached: false,
  },
  {
    key: 'farming_fishing_forestry',
    label: 'Farming, fishing and forestry',
    series: 'ODI-FARM-2026-01',
    lastOpenPeriod: '2021-07',
    levelLineNeverReached: false,
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

/**
 * The label over an occupation chooser: the index explorer's, and the investor
 * screens' series chooser, which is the same act on another page. It lives here
 * rather than beside either of them because one is a client component and the
 * other is a server component, and a constant shared between the two has to sit
 * in a module that is neither.
 *
 * It says "occupation" and not "industry", which is what Root called it when he
 * asked for the label. Every other screen in the product says occupation, and a
 * second word for the same thing costs more than the one it saves.
 */
export const CHOOSE_OCCUPATION = 'Choose an occupation';
