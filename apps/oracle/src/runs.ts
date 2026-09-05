import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { Period } from '@creance/index-model';

import type { QaReport } from './qa.js';
import type { OracleMode } from './state.js';

/**
 * The runs table of docs/INDEX-SPEC.md section 10, and the run states of
 * section 5.
 *
 * Every run writes a row whether or not it published anything, because the
 * table is the heartbeat: section 9 asks the health endpoint for the last run,
 * and a check that found no new period is as much a sign of life as one that
 * published sixteen messages. A run that dies leaves its row on the state it
 * died in, which is what makes `fetch` or `qa` in the table a diagnosis rather
 * than a guess.
 *
 * The specification puts this in Postgres. It is a JSON file here for the same
 * reason the run state is: the oracle has no database connection, `pnpm test`
 * must stay database free, and the API already reads one file the oracle writes
 * across the same volume. See docs/DECISIONS.md, "The runs table is a file the
 * API reads, not a Postgres table the oracle writes".
 */

/** The states of docs/INDEX-SPEC.md section 5, in the order a run walks them. */
export const RUN_STATES = [
  'fetch',
  'verify',
  'compute',
  'qa',
  'publish',
  'submit',
  'done',
  'failed',
] as const;

export type RunState = (typeof RUN_STATES)[number];

/** The modes the schema allows. `backfill` is not one of the oracle's modes. */
export type RunMode = OracleMode | 'backfill';

export interface RunRecord {
  id: number;
  mode: RunMode;
  started_at: string;
  finished_at: string | null;
  state: RunState;
  /** The month the run targeted, or null for a check that found nothing. */
  target_period: Period | null;
  /** Every gate result, pass or fail, so a run is inspectable months later. */
  qa_json: QaReport[] | null;
  notes: string | null;
}

export interface RunsWriter {
  /** Insert or replace by id. Every state change calls this. */
  write(record: RunRecord): Promise<void>;
  all(): Promise<RunRecord[]>;
}

function stamp(now: Date): string {
  return `${now.toISOString().slice(0, 19)}Z`;
}

/**
 * One run's row, from `fetch` to `done` or `failed`.
 *
 * The row is written on every transition rather than once at the end. A run
 * that is killed between the topic receipt and the contract call has to leave
 * something behind saying where it was, and a row written only on the way out
 * is exactly the row a crash loses.
 */
export class RunLog {
  private constructor(
    private readonly writer: RunsWriter,
    private readonly now: () => Date,
    private row: RunRecord,
  ) {}

  static async start(
    writer: RunsWriter,
    options: { mode: RunMode; targetPeriod?: Period | null; now?: () => Date },
  ): Promise<RunLog> {
    const now = options.now ?? ((): Date => new Date());
    const rows = await writer.all();
    const row: RunRecord = {
      id: rows.reduce((highest, entry) => Math.max(highest, entry.id), 0) + 1,
      mode: options.mode,
      started_at: stamp(now()),
      finished_at: null,
      state: 'fetch',
      target_period: options.targetPeriod ?? null,
      qa_json: null,
      notes: null,
    };
    const log = new RunLog(writer, now, row);
    await log.save();
    return log;
  }

  current(): RunRecord {
    return { ...this.row };
  }

  get id(): number {
    return this.row.id;
  }

  async advance(state: RunState): Promise<void> {
    this.row = { ...this.row, state };
    await this.save();
  }

  async target(period: Period | null): Promise<void> {
    this.row = { ...this.row, target_period: period };
    await this.save();
  }

  /** Every gate report the run produced, failures included. */
  async qa(reports: readonly QaReport[]): Promise<void> {
    this.row = { ...this.row, qa_json: [...reports] };
    await this.save();
  }

  /** Free text: "no new period", "source outage acknowledged", a failure. */
  async note(text: string): Promise<void> {
    this.row = {
      ...this.row,
      notes: this.row.notes === null ? text : `${this.row.notes}; ${text}`,
    };
    await this.save();
  }

  async finish(state: 'done' | 'failed'): Promise<RunRecord> {
    this.row = { ...this.row, state, finished_at: stamp(this.now()) };
    await this.save();
    return this.current();
  }

  private async save(): Promise<void> {
    await this.writer.write(this.current());
  }
}

/**
 * The file writer. The whole document is rewritten on every state change, which
 * is six writes of a few kilobytes per run, and it keeps the file readable by
 * anyone who opens it. Atomic: temporary file then rename, so the API never
 * reads half a document.
 */
export class JsonRunsWriter implements RunsWriter {
  private cache: RunRecord[] | null = null;

  constructor(private readonly path: string) {}

  private load(): RunRecord[] {
    if (this.cache !== null) return this.cache;
    let rows: RunRecord[] = [];
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as RunRecord[];
      if (Array.isArray(parsed)) rows = parsed;
    } catch {
      // No file yet, or one that is not readable JSON. The next write replaces
      // it: a run must not fail because its own heartbeat file was corrupted.
    }
    this.cache = rows;
    return rows;
  }

  async write(record: RunRecord): Promise<void> {
    const rows = this.load().filter((row) => row.id !== record.id);
    rows.push(record);
    rows.sort((a, b) => a.id - b.id);
    this.cache = rows;
    mkdirSync(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(rows, null, 2)}\n`, 'utf8');
    renameSync(temporary, this.path);
  }

  async all(): Promise<RunRecord[]> {
    return [...this.load()];
  }
}

/** Remembers nothing beyond the process. What a dry run and a test write to. */
export class MemoryRunsWriter implements RunsWriter {
  private readonly rows = new Map<number, RunRecord>();

  async write(record: RunRecord): Promise<void> {
    this.rows.set(record.id, record);
  }

  async all(): Promise<RunRecord[]> {
    return [...this.rows.values()].sort((a, b) => a.id - b.id);
  }
}
