import { defaultWindows } from './calibration.js';
import { DEFAULT_TRIGGER_OPTIONS, type Observation } from './core.js';
import {
  calibrateDataset,
  evaluateDataset,
  frozenParameters,
  loadCalibration,
  type Dataset,
  type FrozenCalibration,
} from './dataset.js';
import { addMonths, comparePeriods, monthOf, type Period } from './period.js';
import { fmt2 } from './rounding.js';
import { hazardTable } from './hazard.js';
import { fittedHazard, guideRate, HAZARD_FIT, PRICING, riskCharge } from './pricing.js';
import { BACKTEST_FROM } from './calibration.js';
import { aggregateSeriesId } from './series.js';

/**
 * docs/INDEX.md is generated from a backfill run and never edited by hand. Two
 * runs over the same source produce byte-identical output, which is what makes
 * the page a claim an outsider can check rather than a summary somebody wrote.
 */

/** The caption that goes wherever a chart or a table crosses the gap. */
export const GAP_CAPTION =
  'No reading for October 2025. The source survey was not collected that month, ' +
  'so there is no value to publish and none was invented. November and December ' +
  '2025 have no three-month average for the same reason.';

/**
 * A source month BLS corrected after first print in a way the archive cannot
 * show, because the archive was pulled after the correction and the corrected
 * value carries no footnote. Each entry is one row of the published errata
 * list, restricted to the series the archive carries:
 * https://www.bls.gov/bls/errata/cps-corrections-list-april-2025.xlsx
 * (the April 2025 CPS sample redesign correction, first print 2025-05-02,
 * corrected 2025-06-06, notice at
 * https://www.bls.gov/bls/errata/cps-corrections-april-2025.htm).
 */
export interface SourceCorrection {
  seriesId: string;
  period: Period;
  firstPrint: string;
  corrected: string;
  correctedOn: string;
  url: string;
}

export const SOURCE_CORRECTIONS: readonly SourceCorrection[] = [
  {
    seriesId: 'LNU04032224',
    period: '2025-04',
    firstPrint: '6.0',
    corrected: '5.9',
    correctedOn: '2025-06-06',
    url: 'https://www.bls.gov/bls/errata/cps-corrections-list-april-2025.xlsx',
  },
  {
    seriesId: 'LNU04034023',
    period: '2025-04',
    firstPrint: '3.1',
    corrected: '3.0',
    correctedOn: '2025-06-06',
    url: 'https://www.bls.gov/bls/errata/cps-corrections-list-april-2025.xlsx',
  },
  {
    seriesId: 'LNU04034027',
    period: '2025-04',
    firstPrint: '4.4',
    corrected: '4.3',
    correctedOn: '2025-06-06',
    url: 'https://www.bls.gov/bls/errata/cps-corrections-list-april-2025.xlsx',
  },
  {
    seriesId: 'LNU04034032',
    period: '2025-04',
    firstPrint: '4.3',
    corrected: '4.4',
    correctedOn: '2025-06-06',
    url: 'https://www.bls.gov/bls/errata/cps-corrections-list-april-2025.xlsx',
  },
];

/**
 * The footnote codes under which the archive itself says a month moved after
 * first print: C is "Corrected" (the 2020 occupation coding errors, corrected
 * 2020-09-23) and 12 is the January 2026 population control revision applied
 * 2026-03-06.
 */
const MOVED_FOOTNOTE_CODES = new Set(['C', '12']);

/**
 * The six calendar months a period's computation reads, t to t-2 for the
 * smoothed excess and t-12 to t-14 for its base. They are the rows the
 * published source hash commits to.
 */
const INPUT_OFFSETS = [0, -1, -2, -12, -13, -14] as const;

/** Whether the source month, on this series, was corrected or revised after first print. */
function sourceMonthMoved(dataset: Dataset, seriesId: string, period: Period): boolean {
  const row = dataset.allSeries.get(seriesId)?.find((entry) => entry.period === period);
  if (row?.footnoteCodes.some((code) => MOVED_FOOTNOTE_CODES.has(code))) return true;
  return SOURCE_CORRECTIONS.some((c) => c.seriesId === seriesId && c.period === period);
}

export interface MovedSourceSummary {
  /** Series in the archive, bindable or not. */
  archivedSeries: number;
  /** Series carrying the C footnote anywhere. */
  correctedSeries: number;
  /** The span of months carrying the C footnote. */
  correctedFrom: Period;
  correctedTo: Period;
  /** Open group months in the frozen backtest. */
  open: number;
  /** Of those, the ones computed from at least one later corrected or revised input month. */
  openOnMoved: number;
}

/**
 * What the archive itself says about corrections, plus how many open group
 * months were computed from at least one input month BLS later corrected or
 * revised, on the group's own series or on the aggregate. Computed from the
 * footnotes and the errata constant so the numbers move with the archive
 * rather than going stale in prose.
 */
export function movedSourceSummary(
  dataset: Dataset,
  frozen: ReadonlyMap<string, readonly Observation[]>,
): MovedSourceSummary {
  const corrected = new Set<string>();
  const correctedPeriods: Period[] = [];
  for (const [seriesId, rows] of dataset.allSeries) {
    for (const row of rows) {
      if (row.footnoteCodes.includes('C')) {
        corrected.add(seriesId);
        correctedPeriods.push(row.period);
      }
    }
  }
  correctedPeriods.sort(comparePeriods);

  const aggregateId = aggregateSeriesId(dataset.map);
  let open = 0;
  let openOnMoved = 0;
  for (const rows of frozen.values()) {
    for (const row of rows) {
      if (!row.open) continue;
      open += 1;
      const moved = INPUT_OFFSETS.some((offset) => {
        const input = addMonths(row.period, offset);
        return sourceMonthMoved(dataset, row.seriesId, input) || sourceMonthMoved(dataset, aggregateId, input);
      });
      if (moved) openOnMoved += 1;
    }
  }
  return {
    archivedSeries: dataset.allSeries.size,
    correctedSeries: corrected.size,
    correctedFrom: correctedPeriods[0] ?? 'none',
    correctedTo: correctedPeriods[correctedPeriods.length - 1] ?? 'none',
    open,
    openOnMoved,
  };
}

export interface LossWindow {
  from: Period;
  to: Period;
}

/**
 * The separations an open month covers. A separation in month m qualifies when
 * m, m+1 or m+2 is open, so a run of open months reaches two months back from
 * its first open month.
 */
export function lossWindows(openPeriods: readonly Period[]): LossWindow[] {
  const sorted = [...openPeriods].sort(comparePeriods);
  const windows: LossWindow[] = [];
  for (const period of sorted) {
    const from = addMonths(period, -2);
    const last = windows[windows.length - 1];
    if (last && comparePeriods(from, addMonths(last.to, 1)) <= 0) {
      if (comparePeriods(period, last.to) > 0) last.to = period;
    } else {
      windows.push({ from, to: period });
    }
  }
  return windows;
}

function table(headers: string[], rows: string[][]): string {
  const line = (cells: string[]) => `| ${cells.join(' | ')} |`;
  return [line(headers), line(headers.map(() => '---')), ...rows.map(line)].join('\n');
}

function labelOf(dataset: Dataset, groupKey: string): string {
  return dataset.map.series.find((entry) => entry.group_key === groupKey)?.label ?? groupKey;
}

function countOpen(rows: readonly Observation[]): {
  open: number;
  shock: number;
  level: number;
  last: string;
  periods: Period[];
} {
  const open = rows.filter((row) => row.open);
  return {
    open: open.length,
    shock: open.filter((row) => row.shockOpen).length,
    level: open.filter((row) => row.levelOpen).length,
    last: open.length === 0 ? 'never' : (open[open.length - 1]?.period as string),
    periods: open.map((row) => row.period),
  };
}

export interface ReportInput {
  dataset: Dataset;
  calibration?: FrozenCalibration;
  from?: Period;
}

export function renderIndexReport(input: ReportInput): string {
  const { dataset } = input;
  const calibration = input.calibration ?? loadCalibration();
  const from = input.from ?? BACKTEST_FROM;
  const to = dataset.latest;
  const parameters = frozenParameters(calibration);
  const recomputed = calibrateDataset(dataset, defaultWindows(to));
  const frozen = evaluateDataset(dataset, parameters, from, to, DEFAULT_TRIGGER_OPTIONS);
  const generic = evaluateDataset(dataset, parameters, from, to, {
    ...DEFAULT_TRIGGER_OPTIONS,
    attachmentOverride: 2.0,
    shockOnly: true,
  });
  const matched = evaluateDataset(dataset, parameters, from, to, {
    levelLineMode: 'month_matched',
    baseEffectGuard: false,
  });
  const hazard = hazardTable(dataset);
  const moved = movedSourceSummary(dataset, frozen);

  const parts: string[] = [];

  parts.push(`# The occupation displacement index

Generated by \`pnpm oracle:backfill\`. Do not edit this file by hand: it is
regenerated from the source files listed below and two runs over the same source
produce the same bytes.

The index measures how much worse unemployment is for an occupation than for the
workforce as a whole, and how that gap has moved over a year. It settles claims,
so every number on this page is reproducible from public files by anyone.

    e_g,t     = u_g,t - u_all,t                 the excess
    ebar_g,t  = mean(e_g,t, e_g,t-1, e_g,t-2)   the smoothed excess
    ODI_g,t   = ebar_g,t - ebar_g,t-12          the index

Claims open for a group in month t when either form holds: the shock form,
ODI at or above the attachment A, or the level form, the smoothed excess at or
above the line L. Both comparisons are made on the published two-decimal values,
and equality opens the month.

Source: ${dataset.source.description}, covering to ${to}. The backtest window on this page runs from ${from}.`);

  parts.push(`## The series

Sixteen series: the ten major occupation sub-groups, five detailed groups and the
all-occupation rate every excess is measured against. There is no armed forces
series in the source. The mapping is frozen in
\`packages/index-model/src/series-map.json\` and resolved against the catalogue
\`ln.series\`, whose sha256 is \`${calibration.catalogue_sha256}\`.

${table(
  ['occupation', 'group key', 'BLS series id', 'bindable'],
  dataset.map.series.map((entry) => [
    entry.label,
    `\`${entry.group_key}\``,
    `\`${entry.bls_series_id}\``,
    entry.group_key === 'aggregate' ? 'no, it is the denominator' : 'yes',
  ]),
)}`);

  parts.push(`## Verifying the source

The archive under \`data/bls\` is raw public source data with a
\`PROVENANCE.txt\` that records the url, the sha256 and the byte count of every
file. The loader verifies all of them before it computes anything and fails the
whole run on a mismatch, because a backfill from a modified archive is a
fabricated history.

${table(
  ['file', 'sha256', 'bytes'],
  dataset.source.files.map((file) => [
    `\`${file.label}\``,
    `\`${file.sha256}\``,
    String(file.bytes),
  ]),
)}

Repeat the catalogue check yourself. BLS refuses clients with no descriptive
user agent, so send one with a contact address:

    curl -sS -A 'your-name (+mailto:you@example.com)' \\
      https://download.bls.gov/pub/time.series/ln/ln.series -o ln.series
    sha256sum ln.series
    # expect ${calibration.catalogue_sha256}

    gzip -dc data/bls/raw/ln.series.gz | sha256sum
    # the same hash, from the committed copy

    sha256sum data/bls/api/*.json
    # compare against data/bls/PROVENANCE.txt

The API responses can be repeated the same way. The endpoint needs its trailing
slash; without it the API answers a 404 page inside a 200 response:

    curl -sS -A 'your-name (+mailto:you@example.com)' \\
      -H 'Content-Type: application/json' \\
      -d '{"seriesid":["LNU04034021","LNU04000000"],"startyear":"2020","endyear":"2026"}' \\
      https://api.bls.gov/publicAPI/v1/timeseries/data/`);

  parts.push(`## The frozen calibration

A is three population standard deviations of the group's own index over
${calibration.windows.sigma}, excluding ${calibration.windows.sigma_excludes},
rounded to the nearest half and floored at 1.5. L is the 95th percentile of the
smoothed excess over the fixed baseline decade ${calibration.windows.baseline},
plus 0.75. The percentile is the lower order statistic, not an interpolated
quantile. Both are set at issuance and frozen; the baseline never rolls, because
a rolling baseline would quietly normalise displacement.

A negative level line is meaningful. For an occupation with structurally low
unemployment the trigger is deterioration against its own history, not high
unemployment in absolute terms.

${table(
  ['occupation', 'A (shock)', 'L (level)', 'baseline p50', 'baseline p95', '3 sigma'],
  recomputed.map((series) => [
    labelOf(dataset, series.groupKey),
    series.attachmentShock.toFixed(1),
    fmt2(series.levelLine),
    fmt2(series.baseline.p50),
    fmt2(series.baseline.p95),
    series.shock.threeSigma.toFixed(4),
  ]),
)}

Baseline months per series: ${recomputed[0]?.baseline.n ?? 0}. Months of index in the sigma window: ${recomputed[0]?.shock.n ?? 0}.`);

  parts.push(`## The backtest

Every month from ${from} to ${to} at the frozen per-series parameters. "Open"
counts months in which either form held, so it is not the sum of the two form
columns where both held in the same month.

${table(
  ['occupation', 'A', 'L', 'open', 'shock', 'level', 'last open'],
  [...frozen.entries()].map(([groupKey, rows]) => {
    const counts = countOpen(rows);
    const entry = calibration.series.find((e) => e.group_key === groupKey);
    return [
      labelOf(dataset, groupKey),
      (entry?.attachment_shock ?? 0).toFixed(1),
      fmt2(entry?.level_line ?? 0),
      String(counts.open),
      String(counts.shock),
      String(counts.level),
      counts.last,
    ];
  }),
)}

Total open group months: ${[...frozen.values()].reduce((sum, rows) => sum + rows.filter((r) => r.open).length, 0)}.

### At a generic attachment of 2.0

The backlog asks for the months that would have been open at a flat attachment
of 2.0. This is the shock form alone at 2.0 for every occupation, with the level
form switched off, which is what a single default attachment meant before the
calibration was per series. It is published to show why a flat attachment is
wrong rather than as an alternative the product offers.

${table(
  ['occupation', 'open at 2.0', 'open at its own A and L', 'first', 'last'],
  [...generic.entries()].map(([groupKey, rows]) => {
    const counts = countOpen(rows);
    const own = countOpen(frozen.get(groupKey) ?? []);
    return [
      labelOf(dataset, groupKey),
      String(counts.open),
      String(own.open),
      counts.periods[0] ?? 'never',
      counts.last,
    ];
  }),
)}

At a flat 2.0, farming, fishing and forestry opens ${countOpen(generic.get('farming_fishing_forestry') ?? []).open} times and would trade on sampling noise, while office and administrative support opens ${countOpen(generic.get('office_admin_support') ?? []).open} times and could never be covered at all. That is why the attachment is per series.`);

  const windowRows: string[][] = [];
  for (const [groupKey, rows] of frozen) {
    const counts = countOpen(rows);
    if (counts.open === 0) {
      windowRows.push([labelOf(dataset, groupKey), 'never open since ' + from, 'none']);
      continue;
    }
    windowRows.push([
      labelOf(dataset, groupKey),
      counts.periods.join(', '),
      lossWindows(counts.periods).map((w) => `${w.from} to ${w.to}`).join(', '),
    ]);
  }

  parts.push(`## Months open, and the loss windows they imply

A payout needs both keys: the index open for the occupation, and proof that the
person lost the job. A separation in month m is inside the loss window when m,
m+1 or m+2 is open, so a run of open months reaches two months back from its
first open month.

${table(['occupation', 'open months', 'separations covered'], windowRows)}

${GAP_CAPTION}

Two occupations have never been triggerable since ${from} under either form:
office and administrative support, and installation, maintenance and repair. The
index screen says so per occupation where it is true.

The demo series is computer and mathematical, which opens in April and May 2026
on the level form and covers separations from February 2026 through May 2026. The
spare window, if one is ever needed, is arts, design, entertainment, sports and
media from January to April 2025, four consecutive months on the level form and
bindable in the picker. Food preparation and serving, February and March 2025, is
not a usable spare: at that series' own calibrated attachment of 3.5 those months
are closed on the shock form, only March 2025 opens and only on the level form,
and the series is not bindable.`);

  const stressPeriod: Period = '2020-04';
  const stressRows: string[][] = [];
  for (const [groupKey, rows] of frozen) {
    const row = rows.find((r) => r.period === stressPeriod);
    if (!row) continue;
    stressRows.push([
      labelOf(dataset, groupKey),
      row.uG === null ? 'null' : row.uG.toFixed(1),
      fmt2(row.e),
      fmt2(row.ebar),
      fmt2(row.odi),
      row.open ? row.openReason : 'closed',
    ]);
  }
  const stressAll = frozen.get('service')?.find((r) => r.period === stressPeriod)?.uAll ?? 0;

  parts.push(`## The 2020 stress case

April 2020 is the test of whether the index measures displacement or measures the
business cycle. The all-occupation rate was ${stressAll.toFixed(1)} percent, more
than double its level a year earlier, and unemployment rose sharply for every
occupation. The index opened claims for three of the fifteen.

${table(
  ['occupation', 'u_g', 'e', 'ebar', 'odi', 'open'],
  stressRows,
)}

Subtracting the all-occupation rate is what does this. A recession lifts every
rate at once and leaves the excess roughly where it was, so a recession does not
trigger every occupation together.

Computer and mathematical occupations sat at an excess of ${fmt2(frozen.get('computer_math')?.find((r) => r.period === stressPeriod)?.e ?? 0)} points in the worst month of the pandemic and stayed closed, then opened on the level form in April 2026 at a smoothed excess of ${fmt2(frozen.get('computer_math')?.find((r) => r.period === '2026-04')?.ebar ?? 0)} against a line of ${fmt2(frozen.get('computer_math')?.find((r) => r.period === '2026-04')?.levelLine ?? 0)}. Absolute unemployment and displacement are not the same measurement, and the index measures the second one.`);

  const comparisonRows: string[][] = [];
  for (const [groupKey, rows] of matched) {
    const single = countOpen(frozen.get(groupKey) ?? []);
    const monthMatched = countOpen(rows);
    const gained = monthMatched.periods.filter((p) => !single.periods.includes(p));
    const lost = single.periods.filter((p) => !monthMatched.periods.includes(p));
    comparisonRows.push([
      labelOf(dataset, groupKey),
      String(single.open),
      String(monthMatched.open),
      gained.length === 0 ? 'none' : gained.join(', '),
      lost.length === 0 ? 'none' : lost.join(', '),
    ]);
  }
  const computerMatched = countOpen(matched.get('computer_math') ?? []);
  const computerEntry = calibration.series.find((e) => e.group_key === 'computer_math');

  parts.push(`## The month-matched level line, for comparison

These series are not seasonally adjusted and BLS publishes no seasonally adjusted
occupation rates, so there is nothing to switch to. The year on year shock form
cancels stable seasonality; the level form does not. On the real data every level
form opening for education, training and library falls in August, the school year
peak, and every farming level opening falls between February and April. Those are
calendar artifacts being read as displacement.

The alternative is to draw the level line per calendar month, from that month's
values across the baseline decade, so a January reading is compared with January
history. Version 1 freezes the single line per series, which is what the
calibration table above publishes and what the reference vectors and the demo
assume. The month-matched lines are implemented and tested and the comparison is
published here rather than buried, because choosing between them is a product
decision.

${table(
  ['occupation', 'open, single line', 'open, month matched', 'months gained', 'months lost'],
  comparisonRows,
)}

What changes, in plain terms:

- Computer and mathematical gets an April line of ${fmt2(computerEntry?.level_line_by_month[3] ?? 0)} instead of ${fmt2(computerEntry?.level_line ?? 0)}, and opens in ${computerMatched.periods.filter((p) => p >= '2023-01').length} of the computable months from April 2023 onward. "Opens in April 2026 on official data" becomes "has been open most months since April 2023", which is a different product and different pricing.
- Office and administrative support gains one open month and loses the honest
  line that its cover has never been triggerable since ${from}. That sentence is
  on the first screen a buyer sees.
- Education, training and library loses all four of its August openings, which is
  the seasonality fix working as intended.
- Arts, farming and installation each gain openings.

The month-matched lines per calendar month, January first:

${table(
  ['occupation', ...['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']],
  calibration.series.map((entry) => [
    labelOf(dataset, entry.group_key),
    ...entry.level_line_by_month.map((line) => fmt2(line)),
  ]),
)}`);

  parts.push(`## Pricing: the hazard on distance to the line

The attachment is calibrated per series at three sigma of that series' own index,
so by construction a shock is about as rare for every occupation and the index
cannot differentiate occupations through the shock form at all. It differentiates
through how close an occupation sits to its level line now. The guide price is
therefore conditioned on that distance.

Pooling all ${hazard.seriesCount} occupation series in the source, taking each month from ${hazard.from} to ${hazard.to} excluding the 2020 to 2021 dislocation, and measuring how often claims opened in the following twelve months. Distance is the points still to travel before the smoothed excess reaches the line, measured in whole cents so that no month sits on a bucket boundary by rounding:

${table(
  ['distance to the line', 'claims opened within 12 months', 'sample'],
  hazard.buckets.map((bucket) => [
    bucket.label,
    `${(bucket.rate * 100).toFixed(1)} percent`,
    String(bucket.sample),
  ]),
)}

The first row is not a hazard and must not be read as one. The level form opens
when the smoothed excess reaches the line, and distance is the points still to
travel to reach it, so every month at or past the line is a month in which claims
are already open. All ${
    hazard.buckets[0]?.sample ?? 0
  } of them see an open month inside the following year, by
construction. What the row measures is persistence, which is whether an episode
that is already running has at least one more open month within twelve; the
months that do not are the last month of an episode. Cover cannot be bought in
that state, so the row is here for completeness and no price is quoted from it.

The rows below it are the insurable ones. The curve is steep inside half a point
and flat beyond it, which is the shock form setting a floor of about five percent
a year everywhere. The fitted hazard, so that the price has no cliff at a bucket
edge:

    h(d) = ${HAZARD_FIT.floor} + ${HAZARD_FIT.amplitude} * exp(-d / ${HAZARD_FIT.scale})

    expected loss  = h(d) * ${PRICING.separationGivenOpen} * ${PRICING.expectedShareOfLimit}
    risk charge    = expected loss * ${PRICING.load}
    capital charge = (${PRICING.couponRate} - ${PRICING.impliedBaseYield}) * (1 + ${PRICING.reserveMargin}) / ${PRICING.targetUtilisation}
    guide rate     = max(capital charge, capital charge + risk charge)
    market rate    = guide * (1 + ${PRICING.utilisationLambda} * utilisation), capped at ${PRICING.marketCapMultiple} times guide

The measured index sets the risk charge, and so it sets the whole of the
difference between one occupation and another. It does not set the level. The
level is the capital charge, which is what the capital standing behind a unit of
limit costs for a year over and above what it makes by waiting: the coupon that
capital is promised, less the ${(PRICING.impliedBaseYield * 100).toFixed(0)} percent a year the collateral is assumed to make
while it sits, with a ${(PRICING.reserveMargin * 100).toFixed(0)} percent reserve margin on the difference, over the
utilisation a series is priced to clear at.

That subtraction is deliberate and it halves the price. An insurer's capital is
not idle while it waits to pay claims, it is invested, and the income on that
float is a real and usually dominant part of the return, so the premium only has
to fund the spread the investor is paid for taking displacement risk on top of
the base. **This deployment does not deploy its collateral.** The ${(PRICING.impliedBaseYield * 100).toFixed(0)} percent is
what the collateral would make in tokenised treasuries, an assumption of 12
September 2026 and not a rate anything looked up; the TUSD sits in a
\`CollateralVault\` on Hedera testnet making nothing, and no yield source is
implemented.

The capital charge is the same for every occupation, and that is a fact about
the contract rather than a simplification. \`CoverPool.bind\` refuses any policy
that would take a series' active exposure past its remaining principal, so the
pool is collateralised one for one and a unit of limit locks a whole unit of
capital whatever the job is. A book writing several times its capital would
divide this term by that multiple. It is the single change that would most
reduce what a worker pays, and this build cannot make it.

The table starts at 0.05 points rather than at 0, because equality opens the
level form and there is no cover to price at 0. The curve's value there is the
limit it approaches, not a quotable rate.

${table(
  [
    'distance to the line',
    'fitted hazard',
    'risk charge',
    'guide rate',
    'monthly premium on a 5,000 limit',
  ],
  [0.05, 0.25, 0.5, 1, 2, 4].map((d) => [
    `${d.toFixed(2)} points`,
    `${(fittedHazard(d) * 100).toFixed(1)} percent`,
    `${(riskCharge(d) * 100).toFixed(2)} percent`,
    `${(guideRate(d) * 100).toFixed(2)} percent`,
    (guideRate(d) * 5000 / 12).toFixed(2),
  ]),
)}

Read the risk charge column, not the guide column, for what the index is saying.
Across the offered occupations the risk charge runs about thirteen times from
the nearest to its line to the furthest, and the guide rate runs about one and a
half times, because the capital charge every occupation carries equally is much
the larger of the two. That compression is real and it is what fully
collateralised cover costs. It is not the measurement being softened.

The market term is per experience band, and the guide term is not. Cover is
sold in three bands of years worked, 0 to 5, 5 to 25 and 25 or more, and a band
changes the utilisation the market rate is computed at, because utilisation is
exposure written in a band over capital committed to that band. It changes
nothing above that line. The distance, the fitted hazard and the guide rate are
identical in all three bands, and so are the attachment, the level line, the
loss window and the payout.

That is a limitation and not a design preference. The CPS catalogue this index
resolves against carries 739 unemployment rate series with an occupation code
and 819 unemployed level series with one, and not a single series in either set
also carries an age code. There is no published occupation-by-age unemployment
rate and none can be derived from these files, because the numerator does not
exist. The catalogue's own experience field is binary, experienced against
inexperienced labour force, and is not years. So this index cannot measure
whether displacement falls harder on a worker of one seniority than another,
and nothing in this product claims that it can. What a band expresses is
capital's appetite, which is a fact about capital.

Every assumption in that formula is arguable and all of them are stated. The chance a covered worker is involuntarily separated inside a loss window is taken as ${PRICING.separationGivenOpen}, the JOLTS layoffs and discharges base with a three times open-month uplift over a six month window. The expected share of the limit paid is ${PRICING.expectedShareOfLimit}, partial at attachment and full at twice it. The load on the loss term is ${((PRICING.load - 1) * 100).toFixed(0)} percent. The coupon is ${(PRICING.couponRate * 100).toFixed(0)} percent a year, set at issuance, and the reserve margin on it is ${(PRICING.reserveMargin * 100).toFixed(0)} percent. The target utilisation is ${PRICING.targetUtilisation}, which is a judgment about the level a series is priced to clear at and not a measurement of anything. The base yield the collateral is assumed to make while it waits is ${(PRICING.impliedBaseYield * 100).toFixed(0)} percent, implied from tokenised treasuries, and it is an assumption of 12 September 2026 rather than a rate anything looked up. The floor of ${(PRICING.floorRate * 100).toFixed(2)} percent is derived rather than chosen: it is the capital charge on its own, the price at which a policy pays for the spread the capital behind it is owed and nothing for the risk. It never binds, because the flat end of the hazard adds ${(riskCharge(100) * 100).toFixed(2)} percent on top of it even at the far end of the curve. The floor it replaces was 0.5 percent a year, which was less than the collateral is assumed to make sitting still.

Three things this pricing does not claim. It does not claim the base yield has been earned: this deployment holds its collateral in a vault on Hedera testnet, that collateral makes nothing there, and no yield source is implemented or going to be. It does not fund the coupon below the target utilisation, and no price fixes that: a series nobody has bought cover from earns no premium and still owes its coupon on the whole of its principal. And the hazard is fitted to ${hazard.from} to ${hazard.to}, so it describes what displacement has done and not what it is about to do. The history is the floor of what is known rather than the ceiling of what is coming, and nothing here models a trend, because nothing in these sources measures one.`);

  parts.push(`## Honesty notes

- The index does not attribute cause. A shock that has nothing to do with AI
  opens claims too, and the loss key does not try to tell the two apart.
- The index has no age or seniority dimension and cannot be given one from
  these sources. Cover is priced in three experience bands, and that band moves
  the capacity term of the price and nothing else. It is what capital will take
  a risk for, not a difference this index has measured.
- The detailed occupation series carry more sampling noise than the majors. The
  per-series attachments price that in rather than hiding it.
- First published values settle, and that rests on this pipeline rather than
  on the source. Not seasonally adjusted household data has no scheduled
  revision cycle, but the occupation series have been corrected three times
  since 2020. On 2020-09-23 BLS corrected January to July 2020 for errors that
  came in with the new occupation classification; ${moved.correctedSeries} of the ${moved.archivedSeries} archived
  series carry the C footnote on ${moved.correctedFrom} to ${moved.correctedTo}. On 2025-06-06 it corrected
  April 2025 after a sample redesign weighting error, five weeks after first
  print; construction and extraction moved from 6.0 to 5.9 and arts, design,
  entertainment, sports and media from 4.4 to 4.3. On 2026-03-06 it revised
  every January 2026 value for updated population controls, footnote 12 on all
  ${moved.archivedSeries} series. BLS corrects its database in place and in 2020 reissued the
  archived release itself, so the archive here holds the corrected values and
  no vintage of what a month read first. Determinism therefore comes from the
  first-final rule: the first value published to the index topic settles, its
  signed message commits to the sha256 of the six source rows it was computed
  from, and a later change to those rows produces a revision record that
  references the original, never a resettlement. ${moved.openOnMoved} of the ${moved.open} open group
  months in the table above were computed from at least one input month BLS
  later corrected or revised, counting the six months a period reads, t to t-2
  and t-12 to t-14, on the group's series and on the aggregate. The three
  notices:
  https://www.bls.gov/bls/errata/revision-to-current-population-survey-estimates-for-January-through-July-2020.htm
  https://www.bls.gov/bls/errata/cps-corrections-april-2025.htm
  https://www.bls.gov/cps/methods/population-controls/experimental-series-accounting-for-january-2026-population-control-effects.htm
- The index is a lagging measure by construction. Job postings and layoff
  announcement series turned twelve to twenty four months before this index did
  for computer and mathematical work. They are suitable for pricing and not for
  settlement, and they are not used in the trigger.
- ${GAP_CAPTION}`);

  return `${parts.join('\n\n')}\n`;
}

export function reportMonthLabel(period: Period): string {
  return `${period} (month ${monthOf(period)})`;
}
