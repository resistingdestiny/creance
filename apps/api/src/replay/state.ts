import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The oracle's run state, as the API sees it.
 *
 * The oracle writes a small JSON file and the API reads it. It is not a
 * Postgres row yet on purpose: the API's schema arrives with T07 and is not
 * merged, and a file keeps the two apps decoupled until it is. The path is
 * `ORACLE_STATE_PATH`, the same variable the oracle writes to, defaulting to
 * var/oracle/replay-state.json at the repository root.
 *
 * The reader is duplicated here rather than imported from apps/oracle: an API
 * that imports a worker to render a badge has the dependency the wrong way
 * round, and the file is a contract between them, thirty lines wide. Every
 * field is coerced, so a half written or hand edited file cannot make a request
 * throw; the badge is decoration and the topic is the record.
 *
 * `readReplayState` is exported separately from the route because T21's
 * GET /health and T26's GET /v1/index/health both have to include this, and
 * neither should have to call an endpoint to get it.
 */

export type OracleMode = 'live' | 'replay' | 'scenario';

export interface ReplayState {
  mode: OracleMode;
  running: boolean;
  series: string | null;
  from: string | null;
  to: string | null;
  current_period: string | null;
  latest_published: string | null;
  started_at: string | null;
  updated_at: string;
  scenario_label: string | null;
}

const DEFAULT_STATE = '../../../../var/oracle/replay-state.json';

const MODES: readonly OracleMode[] = ['live', 'replay', 'scenario'];

export function replayStatePath(vars: NodeJS.ProcessEnv = process.env): string {
  const configured = vars.ORACLE_STATE_PATH?.trim();
  return configured !== undefined && configured.length > 0
    ? resolve(configured)
    : fileURLToPath(new URL(DEFAULT_STATE, import.meta.url));
}

function asMode(value: unknown): OracleMode {
  return MODES.includes(value as OracleMode) ? (value as OracleMode) : 'live';
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** What is served when no run has ever written the file: live, and idle. */
export function idleReplayState(now: Date = new Date()): ReplayState {
  return {
    mode: 'live',
    running: false,
    series: null,
    from: null,
    to: null,
    current_period: null,
    latest_published: null,
    started_at: null,
    updated_at: `${now.toISOString().slice(0, 19)}Z`,
    scenario_label: null,
  };
}

export function parseReplayState(text: string, now: Date = new Date()): ReplayState {
  const raw = JSON.parse(text) as Record<string, unknown>;
  const base = idleReplayState(now);
  return {
    mode: asMode(raw.mode),
    running: raw.running === true,
    series: asStringOrNull(raw.series),
    from: asStringOrNull(raw.from),
    to: asStringOrNull(raw.to),
    current_period: asStringOrNull(raw.current_period),
    latest_published: asStringOrNull(raw.latest_published),
    started_at: asStringOrNull(raw.started_at),
    updated_at: asStringOrNull(raw.updated_at) ?? base.updated_at,
    scenario_label: asStringOrNull(raw.scenario_label),
  };
}

/** The current state. Never throws: an unreadable file reads as idle and live. */
export function readReplayState(path: string = replayStatePath()): ReplayState {
  try {
    return parseReplayState(readFileSync(path, 'utf8'));
  } catch {
    return idleReplayState();
  }
}

/**
 * Whether a screen should show the badge, and what it should say.
 *
 * A finished replay still reports mode `replay`, because the numbers on the
 * page came from one; the badge stays and stops saying "running".
 */
export function badgeFor(state: ReplayState): { show: boolean; label: string } | null {
  if (state.mode === 'live') return null;
  if (state.mode === 'scenario') {
    return { show: true, label: state.scenario_label ?? 'SCENARIO' };
  }
  return { show: true, label: 'REPLAY' };
}
