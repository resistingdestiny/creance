import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The oracle's runs table, as the API sees it.
 *
 * docs/INDEX-SPEC.md section 10 puts this table in Postgres. The oracle has no
 * database connection and writes a JSON file instead, one row per run, and the
 * API reads it exactly as it reads the run state file beside it. See
 * docs/DECISIONS.md, "The runs table is a file the API reads".
 *
 * The reader is duplicated here rather than imported from apps/oracle, for the
 * same reason apps/api/src/replay/state.ts duplicates the state reader: an API
 * that imports a worker to answer a health check has the dependency the wrong
 * way round, and the file is a contract between them. Every field is coerced,
 * so a half written or hand edited file cannot make a health check throw.
 */

export type RunState =
  | 'fetch'
  | 'verify'
  | 'compute'
  | 'qa'
  | 'publish'
  | 'submit'
  | 'done'
  | 'failed';

const STATES: readonly RunState[] = [
  'fetch',
  'verify',
  'compute',
  'qa',
  'publish',
  'submit',
  'done',
  'failed',
];

const MODES = ['live', 'replay', 'backfill', 'scenario'] as const;

export type RunMode = (typeof MODES)[number];

/** One failed gate, as the health endpoint reports it. */
export interface FailedGate {
  gate: string;
  detail: string;
}

export interface OracleRun {
  id: number;
  mode: RunMode;
  state: RunState;
  started_at: string | null;
  finished_at: string | null;
  target_period: string | null;
  notes: string | null;
  /** Whether every gate passed, or null when the run recorded no gates. */
  qa_passed: boolean | null;
  failed_gates: FailedGate[];
}

const DEFAULT_RUNS = '../../../../var/oracle/runs.json';

export function oracleRunsPath(vars: NodeJS.ProcessEnv = process.env): string {
  const configured = vars.ORACLE_RUNS_PATH?.trim();
  return configured !== undefined && configured.length > 0
    ? resolve(configured)
    : fileURLToPath(new URL(DEFAULT_RUNS, import.meta.url));
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asState(value: unknown): RunState {
  return STATES.includes(value as RunState) ? (value as RunState) : 'fetch';
}

function asMode(value: unknown): RunMode {
  return MODES.includes(value as RunMode) ? (value as RunMode) : 'live';
}

/**
 * The gate results of one run, flattened to the question health answers: did
 * every gate pass, and which ones did not.
 *
 * A run carries one report per period it gated, so a failure anywhere in the
 * window is a failure for the run.
 */
function readQa(value: unknown): { passed: boolean | null; failed: FailedGate[] } {
  if (!Array.isArray(value) || value.length === 0) return { passed: null, failed: [] };
  const failed: FailedGate[] = [];
  for (const report of value as Record<string, unknown>[]) {
    for (const gate of Array.isArray(report.failures)
      ? (report.failures as Record<string, unknown>[])
      : []) {
      failed.push({
        gate: asStringOrNull(gate.gate) ?? 'unknown',
        detail: asStringOrNull(gate.detail) ?? '',
      });
    }
  }
  return { passed: failed.length === 0, failed };
}

export function parseRun(raw: Record<string, unknown>): OracleRun {
  const qa = readQa(raw.qa_json);
  return {
    id: typeof raw.id === 'number' ? raw.id : 0,
    mode: asMode(raw.mode),
    state: asState(raw.state),
    started_at: asStringOrNull(raw.started_at),
    finished_at: asStringOrNull(raw.finished_at),
    target_period: asStringOrNull(raw.target_period),
    notes: asStringOrNull(raw.notes),
    qa_passed: qa.passed,
    failed_gates: qa.failed,
  };
}

/**
 * The newest run, or null when the oracle has never run on this deployment.
 *
 * Never throws. A missing file is a clone that has not run the oracle yet,
 * which is a fact about the deployment and not an error in the API.
 */
export function readLastRun(path: string = oracleRunsPath()): OracleRun | null {
  let rows: Record<string, unknown>[];
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    rows = parsed as Record<string, unknown>[];
  } catch {
    return null;
  }
  const runs = rows.map(parseRun);
  return runs.reduce((newest, run) => (run.id >= newest.id ? run : newest), runs[0] as OracleRun);
}
