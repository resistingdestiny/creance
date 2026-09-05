import { addMonths, monthOf, periodRange, type Period } from './period.js';
import { pub } from './rounding.js';

/**
 * The index arithmetic. Three lines of algebra and a great deal of care about
 * which months exist.
 *
 *     e_g,t    = u_g,t - u_all,t
 *     ebar_g,t = (e_g,t + e_g,t-1 + e_g,t-2) / 3
 *     ODI_g,t  = ebar_g,t - ebar_g,t-12
 *
 * Computed in float, published at two decimals, compared on the published
 * values. The published ODI is the difference of the two published smoothed
 * values, so a reader recomputing it from the two numbers in the message reaches
 * the oracle's boolean rather than one that disagrees about one row in four.
 */

export type ObservationStatus = 'final' | 'insufficient_history' | 'no_source';
export type OpenReason = 'shock' | 'level' | 'both' | 'none';
export type TriggerForm = 'shock' | 'level';

export interface TriggerParameters {
  /** A, the shock attachment. */
  attachmentShock: number;
  /** L for the whole series, used when the level line mode is single. */
  levelLine: number;
  /** L per calendar month, January first, used in month-matched mode. */
  levelLineByMonth?: readonly number[];
}

export interface TriggerOptions {
  levelLineMode: 'single' | 'month_matched';
  /** An opening on the shock form alone requires an unopened base period. */
  baseEffectGuard: boolean;
}

export const DEFAULT_TRIGGER_OPTIONS: TriggerOptions = {
  levelLineMode: 'single',
  baseEffectGuard: false,
};

export interface Observation {
  groupKey: string;
  seriesId: string;
  period: Period;
  uG: number | null;
  uAll: number | null;
  /** Published excess, or null when the month has no source value. */
  e: number | null;
  /** Published smoothed excess, or null when t, t-1 or t-2 is missing. */
  ebar: number | null;
  /** The published smoothed excess twelve calendar months earlier. */
  ebarBase: number | null;
  /** Published ODI, or null when the shock form is not evaluable. */
  odi: number | null;
  attachmentShock: number;
  levelLine: number;
  /** Which forms could be evaluated at all, in the order shock then level. */
  forms: TriggerForm[];
  levelOpen: boolean;
  shockOpen: boolean;
  open: boolean;
  openReason: OpenReason;
  status: ObservationStatus;
  /** Set when the base-effect guard suppressed a shock-only opening. */
  guardSuppressed?: true;
}

export interface SeriesInput {
  groupKey: string;
  seriesId: string;
  /** Published rate for the group, by period. Absent months are simply absent. */
  groupRates: ReadonlyMap<Period, number>;
  /** Published all-occupation rate, by period. */
  aggregateRates: ReadonlyMap<Period, number>;
  parameters: TriggerParameters;
}

/** The excess of the group's rate over the all-occupation rate, in float. */
export function excess(uG: number, uAll: number): number {
  return uG - uAll;
}

/**
 * The three-month mean over calendar months t, t-1 and t-2. All three must
 * exist: the window never slides over a gap, because a window that closes over
 * a hole is a different index from the one that was issued.
 */
export function smooth(
  e: ReadonlyMap<Period, number>,
  period: Period,
): number | null {
  const at = e.get(period);
  const back1 = e.get(addMonths(period, -1));
  const back2 = e.get(addMonths(period, -2));
  if (at === undefined || back1 === undefined || back2 === undefined) return null;
  return (at + back1 + back2) / 3;
}

function levelLineFor(parameters: TriggerParameters, period: Period, options: TriggerOptions): number {
  if (options.levelLineMode === 'single') return parameters.levelLine;
  const byMonth = parameters.levelLineByMonth;
  if (!byMonth || byMonth.length !== 12) {
    throw new Error('month-matched mode needs twelve level lines');
  }
  return byMonth[monthOf(period) - 1] as number;
}

/**
 * Compute every observation for one series over an inclusive window. Periods are
 * walked in ascending order so that the base-effect guard can consult the
 * openness of t-12, which is already decided by the time t is reached.
 */
export function computeSeries(
  input: SeriesInput,
  from: Period,
  to: Period,
  options: TriggerOptions = DEFAULT_TRIGGER_OPTIONS,
): Observation[] {
  const rawExcess = new Map<Period, number>();
  const publishedEbar = new Map<Period, number>();
  const openUnguarded = new Map<Period, boolean>();

  // The window needs fourteen months of run-up: ebar at t-12 reaches back to
  // t-14. Walking from there rather than from `from` is what lets the first
  // period in the window carry an ODI.
  const walkFrom = addMonths(from, -14);
  for (const period of periodRange(walkFrom, to)) {
    const uG = input.groupRates.get(period);
    const uAll = input.aggregateRates.get(period);
    if (uG !== undefined && uAll !== undefined) {
      rawExcess.set(period, excess(uG, uAll));
    }
  }

  const out: Observation[] = [];
  for (const period of periodRange(walkFrom, to)) {
    const uG = input.groupRates.get(period) ?? null;
    const uAll = input.aggregateRates.get(period) ?? null;
    const rawE = rawExcess.get(period);
    const rawEbar = smooth(rawExcess, period);
    const ebar = rawEbar === null ? null : pub(rawEbar);
    if (ebar !== null) publishedEbar.set(period, ebar);

    const basePeriod = addMonths(period, -12);
    const ebarBase = publishedEbar.get(basePeriod) ?? null;
    const odi = ebar !== null && ebarBase !== null ? pub(ebar - ebarBase) : null;

    const levelLine = levelLineFor(input.parameters, period, options);
    const attachmentShock = input.parameters.attachmentShock;

    const forms: TriggerForm[] = [];
    if (odi !== null) forms.push('shock');
    if (ebar !== null) forms.push('level');

    // Both comparisons are >= on the published two-decimal values. Equality
    // opens the month.
    const levelOpen = ebar !== null && ebar >= levelLine;
    const shockOpenRaw = odi !== null && odi >= attachmentShock;
    openUnguarded.set(period, levelOpen || shockOpenRaw);

    // The year-on-year form compares against a base that may itself have been
    // shocked, so it measures anniversaries rather than states. Under the guard,
    // a month that opens on the shock form alone is suppressed when the base
    // period was itself open. The base openness used is the plain one, so the
    // guard is a filter on top of the index rather than a second index.
    const baseWasOpen = openUnguarded.get(basePeriod) ?? false;
    const guardSuppressed =
      options.baseEffectGuard && shockOpenRaw && !levelOpen && baseWasOpen;
    const shockOpen = shockOpenRaw && !guardSuppressed;

    const status: ObservationStatus =
      rawE === undefined ? 'no_source' : ebar === null ? 'insufficient_history' : 'final';
    const open = status === 'final' && (levelOpen || shockOpen);
    const openReason: OpenReason =
      !open ? 'none' : levelOpen && shockOpen ? 'both' : shockOpen ? 'shock' : 'level';

    out.push({
      groupKey: input.groupKey,
      seriesId: input.seriesId,
      period,
      uG,
      uAll,
      e: rawE === undefined ? null : pub(rawE),
      ebar,
      ebarBase,
      odi,
      attachmentShock,
      levelLine,
      forms: status === 'final' ? forms : [],
      levelOpen: status === 'final' && levelOpen,
      shockOpen: status === 'final' && shockOpen,
      open,
      openReason,
      status,
      ...(guardSuppressed ? { guardSuppressed: true as const } : {}),
    });
  }

  const first = periodRange(from, to);
  const wanted = new Set(first);
  return out.filter((observation) => wanted.has(observation.period));
}

/** Build the rate lookup one series needs, dropping the months with no value. */
export function ratesOf(
  rows: readonly { period: Period; value: number | null }[],
): Map<Period, number> {
  const map = new Map<Period, number>();
  for (const row of rows) {
    if (row.value !== null) map.set(row.period, row.value);
  }
  return map;
}
