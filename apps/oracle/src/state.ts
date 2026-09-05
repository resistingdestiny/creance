import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { Period } from '@creance/index-model';

/**
 * The run state the web app reads to decide whether to show the REPLAY badge.
 *
 * It is a small JSON file, not a database row, on purpose. The API's Postgres
 * schema arrives with T07 and is not merged; a file the oracle writes and the
 * API reads keeps the two apps decoupled until it is, and needs no migration to
 * throw away afterwards. The path is `ORACLE_STATE_PATH`, defaulting to
 * var/oracle/replay-state.json, which is gitignored.
 *
 * The write is atomic: a temporary file then a rename, so a reader that opens
 * the file mid-tick never sees half a document.
 */

export type OracleMode = 'live' | 'replay' | 'scenario';

export interface OracleState {
  mode: OracleMode;
  /** True only while a clock is actually walking periods. */
  running: boolean;
  /** The cover series label the run targets, or null for every group. */
  series: string | null;
  from: Period | null;
  to: Period | null;
  /** The period the current tick is on. */
  current_period: Period | null;
  /** The newest period this run put on the topic. */
  latest_published: Period | null;
  started_at: string | null;
  updated_at: string;
  /** Set in scenario mode, so a screen can say which scenario is running. */
  scenario_label: string | null;
}

/** What the API serves when no run has ever written the file. */
export function idleState(now: Date = new Date()): OracleState {
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

const MODES: readonly OracleMode[] = ['live', 'replay', 'scenario'];

function asMode(value: unknown): OracleMode {
  return MODES.includes(value as OracleMode) ? (value as OracleMode) : 'live';
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Read the state, coercing every field. A half written or hand edited file must
 * not be able to make the API throw: the badge is decoration, the topic is the
 * record.
 */
export function parseState(text: string, now: Date = new Date()): OracleState {
  const raw = JSON.parse(text) as Record<string, unknown>;
  const base = idleState(now);
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

export function readState(path: string, now: Date = new Date()): OracleState {
  try {
    return parseState(readFileSync(path, 'utf8'), now);
  } catch {
    return idleState(now);
  }
}

export function writeState(path: string, state: OracleState): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  renameSync(temporary, path);
}

/**
 * A run's handle on the state file. Every tick calls `advance`, and `finish`
 * runs whether the run succeeded or failed, so a crashed replay does not leave
 * `running` true forever.
 */
export class StateFile {
  private state: OracleState;

  constructor(
    private readonly path: string,
    initial: Partial<OracleState> = {},
  ) {
    this.state = { ...idleState(), ...initial };
  }

  current(): OracleState {
    return { ...this.state };
  }

  start(): void {
    const now = new Date();
    this.state = {
      ...this.state,
      running: true,
      started_at: `${now.toISOString().slice(0, 19)}Z`,
      updated_at: `${now.toISOString().slice(0, 19)}Z`,
    };
    writeState(this.path, this.state);
  }

  advance(period: Period, published: boolean): void {
    this.state = {
      ...this.state,
      current_period: period,
      latest_published: published ? period : this.state.latest_published,
      updated_at: `${new Date().toISOString().slice(0, 19)}Z`,
    };
    writeState(this.path, this.state);
  }

  finish(): void {
    this.state = {
      ...this.state,
      running: false,
      updated_at: `${new Date().toISOString().slice(0, 19)}Z`,
    };
    writeState(this.path, this.state);
  }
}
