import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { Period, SourceFile } from '@creance/index-model';

import type { ObservationMessage } from './message.js';
import type { OracleMode } from './state.js';

/**
 * Where a published observation is remembered.
 *
 * docs/INDEX-SPEC.md section 10 puts this in Postgres, in the apps/api schema.
 * That schema arrives with T07 and is not merged, so the writer is an interface
 * with a JSON file behind it: the pipeline depends on `ObservationWriter` and
 * nothing else, and a Postgres implementation replaces the file without the
 * pipeline noticing.
 *
 * The record is the row the specification names plus the exact message that was
 * signed, so a reader can re-verify a signature from the store alone, and the
 * full source file list, which does not fit in the 1 KB message.
 */

export interface ObservationRecord {
  group_key: string;
  period: Period;
  /** The cover series this settled, or null for a group with no series. */
  series: string | null;
  u_g: number | null;
  u_all: number | null;
  e: number | null;
  ebar: number | null;
  odi: number | null;
  open: boolean;
  open_reason: string;
  status: string;
  model_version: string;
  hcs_topic: string | null;
  hcs_seq: number | null;
  hcs_tx: string | null;
  submit_tx: string | null;
  revises_seq: number | null;
  /** The run mode, so a public query can filter the demo clock out. */
  mode: OracleMode;
  /** The same distinction as a boolean, which is the column T07 adds. */
  replay: boolean;
  scenario_label: string | null;
  source_files: SourceFile[];
  message: ObservationMessage;
  written_at: string;
}

/**
 * Which set of rows a mode shares a namespace with.
 *
 * Live and replay both publish to the index topic, so they share one. The
 * question the guard asks is "has this group and period already reached the
 * index topic", and the answer cannot depend on which command put it there: a
 * replay walks up to the newest month the source carries and `oracle:once`
 * defaults to that same month, so keying the guard by mode would let the demo
 * clock and the live path each publish their own message for it. They can also
 * read different rows, `--source archive` against `--source api`, so after a
 * BLS revision the two messages would not even agree, with nothing linking
 * them. A scenario publishes no index message at all, so its rows are kept
 * apart and never block a real run.
 *
 * `mode` stays on the record. It is what a public query filters the demo clock
 * out by, and it is now also the answer to which command published a row.
 */
export function publicationScope(mode: OracleMode): 'index' | 'scenario' {
  return mode === 'scenario' ? 'scenario' : 'index';
}

/**
 * The natural key: one row per group, period and status within a publication
 * scope.
 *
 * The status only enters the key when it is a revision, and that is the unique
 * key of docs/INDEX-SPEC.md section 10 read the way section 6 means it: a
 * revision record is stored beside the value that settled, never over it, and
 * everything that asks "was this period published" asks about the settlement
 * and passes no status at all. Two revisions of one period collapse to one row,
 * which is what `unique (group_key, period, status)` says and what stops a
 * fetch that is run twice recording the same restatement twice.
 */
export function recordKey(record: {
  group_key: string;
  period: Period;
  mode: OracleMode;
  status?: string;
}): string {
  const revision =
    record.status === 'revision' || record.status === 'revised' ? '/revised' : '';
  return `${publicationScope(record.mode)}/${record.group_key}/${record.period}${revision}`;
}

export interface ObservationWriter {
  /**
   * True when this group and period already reached the topic. The mode picks
   * the namespace of `publicationScope`, not an exact row: a period a replay
   * published is already published as far as a live run is concerned.
   */
  has(groupKey: string, period: Period, mode: OracleMode): Promise<boolean>;
  get(groupKey: string, period: Period, mode: OracleMode): Promise<ObservationRecord | undefined>;
  write(record: ObservationRecord): Promise<void>;
  all(): Promise<ObservationRecord[]>;
}

/**
 * The file writer. Rewrites the whole document on every write, which is fine
 * for the few hundred rows a replay produces and keeps the file readable by
 * anyone who opens it. The write is atomic, temporary file then rename.
 */
export class JsonObservationWriter implements ObservationWriter {
  private cache: Map<string, ObservationRecord> | null = null;

  constructor(private readonly path: string) {}

  private load(): Map<string, ObservationRecord> {
    if (this.cache !== null) return this.cache;
    const cache = new Map<string, ObservationRecord>();
    try {
      const rows = JSON.parse(readFileSync(this.path, 'utf8')) as ObservationRecord[];
      for (const row of rows) cache.set(recordKey(row), row);
    } catch {
      // No file yet, or one that is not readable JSON. Either way the store is
      // empty and the first write will replace it.
    }
    this.cache = cache;
    return cache;
  }

  async has(groupKey: string, period: Period, mode: OracleMode): Promise<boolean> {
    return this.load().has(recordKey({ group_key: groupKey, period, mode }));
  }

  async get(
    groupKey: string,
    period: Period,
    mode: OracleMode,
  ): Promise<ObservationRecord | undefined> {
    return this.load().get(recordKey({ group_key: groupKey, period, mode }));
  }

  async write(record: ObservationRecord): Promise<void> {
    const cache = this.load();
    cache.set(recordKey(record), record);
    const rows = [...cache.values()].sort(
      (a, b) =>
        a.mode.localeCompare(b.mode) ||
        a.period.localeCompare(b.period) ||
        a.group_key.localeCompare(b.group_key),
    );
    mkdirSync(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(rows, null, 2)}\n`, 'utf8');
    renameSync(temporary, this.path);
  }

  async all(): Promise<ObservationRecord[]> {
    return [...this.load().values()];
  }
}

/** Remembers nothing. What a dry run writes to. */
export class MemoryObservationWriter implements ObservationWriter {
  private readonly rows = new Map<string, ObservationRecord>();

  async has(groupKey: string, period: Period, mode: OracleMode): Promise<boolean> {
    return this.rows.has(recordKey({ group_key: groupKey, period, mode }));
  }

  async get(
    groupKey: string,
    period: Period,
    mode: OracleMode,
  ): Promise<ObservationRecord | undefined> {
    return this.rows.get(recordKey({ group_key: groupKey, period, mode }));
  }

  async write(record: ObservationRecord): Promise<void> {
    this.rows.set(recordKey(record), record);
  }

  async all(): Promise<ObservationRecord[]> {
    return [...this.rows.values()];
  }
}
