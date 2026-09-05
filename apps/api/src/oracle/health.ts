import { loadCalibration } from '@creance/index-model';

import { periodFromInteger } from '../index-data.js';
import type { LatestPeriod } from '../db/types.js';
import type { ReplayState } from '../replay/state.js';
import { rfc3339 } from '../views.js';
import type { FailedGate, OracleRun } from './runs.js';

/**
 * The index health document of docs/INDEX-SPEC.md section 9: the last run, the
 * last period per group, the QA status, the staleness of the source and the
 * mode the feed is in.
 *
 * The runs table is the heartbeat and this is how it is read. What it answers
 * is the question an operator actually has, which is not "is the process up"
 * but "is the index still being published": a run that succeeds every day while
 * the source has published nothing new is a heartbeat with nothing behind it,
 * so staleness is measured from the end of the newest reference month and never
 * from the last successful run.
 *
 * The 45 day line and the age arithmetic are a second copy of what
 * apps/oracle/src/staleness.ts holds, deliberately, and for the same reason
 * apps/api/src/replay/state.ts holds a second copy of the state reader: the API
 * must not import the worker. The line is docs/INDEX-SPEC.md section 9's, so
 * both copies answer to the specification rather than to each other.
 *
 * The two do not measure from the same place, on purpose. The oracle measures
 * the newest period the source carries, because its question is whether the
 * Bureau has published. This measures the newest period that was published
 * here, because its question is whether the feed a caller is paying for is
 * current. They agree while publication is keeping up, and when they disagree
 * the difference is the thing worth seeing: a source that has moved on while
 * this deployment has not.
 */

export const STALE_AFTER_DAYS = 45;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface IndexSource {
  newest_period: string | null;
  stale_days: number | null;
  stale: boolean;
  stale_after_days: number;
}

export interface IndexQa {
  status: 'pass' | 'fail' | 'unknown';
  period: string | null;
  failed_gates: FailedGate[];
}

export interface IndexHealth {
  status: 'ok' | 'stale' | 'failed' | 'degraded' | 'never_run';
  mode: string;
  time: string;
  last_run: OracleRun | null;
  qa: IndexQa;
  /** Where `last_period_by_group` and the newest period came from. */
  database: 'ok' | 'unreachable';
  last_period_by_group: Record<string, string>;
  source: IndexSource;
  replay: ReplayState;
  model_version: string;
}

/** Whole days from the end of a reference month to now, never negative. */
export function ageInDays(period: string, now: Date): number {
  const [year, month] = period.split('-').map(Number) as [number, number];
  const endOfMonth = Date.UTC(month === 12 ? year + 1 : year, month === 12 ? 0 : month, 1);
  return Math.max(0, Math.floor((now.getTime() - endOfMonth) / DAY_MS));
}

export function sourceHealth(newest: string | null, now: Date): IndexSource {
  if (newest === null) {
    return {
      newest_period: null,
      stale_days: null,
      stale: false,
      stale_after_days: STALE_AFTER_DAYS,
    };
  }
  const days = ageInDays(newest, now);
  return {
    newest_period: newest,
    stale_days: days,
    stale: days > STALE_AFTER_DAYS,
    stale_after_days: STALE_AFTER_DAYS,
  };
}

export interface HealthInput {
  run: OracleRun | null;
  replay: ReplayState;
  /**
   * One row per group with a published observation, as the repository reports,
   * or null when the database could not be read.
   *
   * Null and empty are different answers and are reported differently. An empty
   * list is a deployment that has published nothing; null is a deployment that
   * could not be asked, and saying "no group has a period" of that one would be
   * a claim the document has no basis for.
   */
  latest: readonly LatestPeriod[] | null;
  now: Date;
}

export function buildIndexHealth(input: HealthInput): IndexHealth {
  const byGroup: Record<string, string> = {};
  let newest: string | null = null;
  for (const row of [...(input.latest ?? [])].sort((a, b) => a.groupKey.localeCompare(b.groupKey))) {
    const period = periodFromInteger(row.period);
    byGroup[row.groupKey] = period;
    if (newest === null || period > newest) newest = period;
  }

  const source = sourceHealth(newest, input.now);
  const qa: IndexQa = {
    status:
      input.run === null || input.run.qa_passed === null
        ? 'unknown'
        : input.run.qa_passed
          ? 'pass'
          : 'fail',
    period: input.run?.target_period ?? null,
    failed_gates: input.run?.failed_gates ?? [],
  };

  return {
    // One word for a screen and for a pager. A failed last run outranks
    // everything, because a run that failed is a fact about this deployment and
    // the rest are facts about the world or about what could be read. A
    // database that could not be reached outranks freshness, because freshness
    // is the thing that could not be measured.
    status:
      input.run === null
        ? 'never_run'
        : input.run.state === 'failed'
          ? 'failed'
          : input.latest === null
            ? 'degraded'
            : source.stale
              ? 'stale'
              : 'ok',
    database: input.latest === null ? 'unreachable' : 'ok',
    // Which calendar the feed is on, which is the run state's answer and not
    // the last run's: a replay walks history without changing what `live` runs
    // published.
    mode: input.replay.mode,
    time: rfc3339(input.now),
    last_run: input.run,
    qa,
    last_period_by_group: byGroup,
    source,
    replay: input.replay,
    model_version: loadCalibration().model_version,
  };
}

/** The compact form GET /health carries, so an uptime check reads one document. */
export function indexHealthSummary(health: IndexHealth): Record<string, unknown> {
  return {
    status: health.status,
    mode: health.mode,
    // Why `newest_period` may be null, which otherwise reads as "nothing has
    // ever been published" rather than "nobody could be asked".
    database: health.database,
    last_run: health.last_run === null ? null : {
      id: health.last_run.id,
      state: health.last_run.state,
      target_period: health.last_run.target_period,
      finished_at: health.last_run.finished_at,
    },
    qa: health.qa.status,
    newest_period: health.source.newest_period,
    stale_days: health.source.stale_days,
    stale: health.source.stale,
  };
}
