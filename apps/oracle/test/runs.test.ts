import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { JsonRunsWriter, MemoryRunsWriter, RunLog, type RunRecord } from '../src/runs.js';

/// The runs table is the heartbeat of docs/INDEX-SPEC.md section 9, so what is
/// checked here is that a row exists from the first state onward and survives a
/// run that never finishes. A row written only at the end is the row a crash
/// loses, and a table that only records successes is not a heartbeat.

const CLOCK = (): Date => new Date('2026-09-05T14:10:00Z');

function report(period: string, passed: boolean) {
  return {
    period: period as never,
    passed,
    gates: [{ gate: 'bounds' as const, passed, detail: passed ? 'all rates in range' : 'u=55' }],
    failures: passed ? [] : [{ gate: 'bounds' as const, passed: false, detail: 'u=55' }],
  };
}

describe('a run row', () => {
  it('exists from the first state, before anything is fetched', async () => {
    const writer = new MemoryRunsWriter();
    const log = await RunLog.start(writer, { mode: 'live', now: CLOCK });
    const rows = await writer.all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 1,
      mode: 'live',
      state: 'fetch',
      started_at: '2026-09-05T14:10:00Z',
      finished_at: null,
      target_period: null,
      qa_json: null,
      notes: null,
    });
    expect(log.id).toBe(1);
  });

  it('walks the states of the specification and closes on done', async () => {
    const writer = new MemoryRunsWriter();
    const log = await RunLog.start(writer, { mode: 'live', now: CLOCK });
    for (const state of ['verify', 'compute', 'qa', 'publish', 'submit'] as const) {
      await log.advance(state);
    }
    await log.target('2026-08');
    await log.qa([report('2026-08', true)]);
    const finished = await log.finish('done');
    expect(finished.state).toBe('done');
    expect(finished.finished_at).toBe('2026-09-05T14:10:00Z');
    expect(finished.target_period).toBe('2026-08');
    expect(finished.qa_json?.[0]?.passed).toBe(true);
  });

  it('keeps the state a failed run died on, with the gates that failed', async () => {
    const writer = new MemoryRunsWriter();
    const log = await RunLog.start(writer, { mode: 'live', now: CLOCK });
    await log.advance('qa');
    await log.qa([report('2026-08', false)]);
    await log.note('bounds failed for computer_math');
    const failed = await log.finish('failed');
    expect(failed.state).toBe('failed');
    expect(failed.notes).toBe('bounds failed for computer_math');
    expect(failed.qa_json?.[0]?.failures[0]?.detail).toBe('u=55');
  });

  it('numbers runs in order and keeps the earlier ones', async () => {
    const writer = new MemoryRunsWriter();
    await (await RunLog.start(writer, { mode: 'live', now: CLOCK })).finish('done');
    const second = await RunLog.start(writer, { mode: 'replay', now: CLOCK });
    expect(second.id).toBe(2);
    const rows = await writer.all();
    expect(rows.map((row) => row.id)).toEqual([1, 2]);
    expect(rows.map((row) => row.mode)).toEqual(['live', 'replay']);
  });
});

describe('the runs file', () => {
  it('is readable JSON after every state change, so a reader never blocks a run', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'creance-runs-')), 'runs.json');
    const writer = new JsonRunsWriter(path);
    const log = await RunLog.start(writer, { mode: 'live', targetPeriod: '2026-08', now: CLOCK });
    await log.advance('publish');
    const midway = JSON.parse(readFileSync(path, 'utf8')) as RunRecord[];
    expect(midway).toHaveLength(1);
    expect(midway[0]?.state).toBe('publish');
    expect(midway[0]?.finished_at).toBeNull();

    await log.finish('done');
    const settled = JSON.parse(readFileSync(path, 'utf8')) as RunRecord[];
    expect(settled[0]?.state).toBe('done');
  });

  it('carries on from the rows a previous process wrote', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'creance-runs-')), 'runs.json');
    await (await RunLog.start(new JsonRunsWriter(path), { mode: 'live', now: CLOCK })).finish('done');
    const second = await RunLog.start(new JsonRunsWriter(path), { mode: 'live', now: CLOCK });
    expect(second.id).toBe(2);
    expect(await new JsonRunsWriter(path).all()).toHaveLength(2);
  });

  it('starts again rather than throwing when the file is not readable JSON', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'creance-runs-')), 'runs.json');
    writeFileSync(path, 'half a document', 'utf8');
    const writer = new JsonRunsWriter(path);
    expect(await writer.all()).toEqual([]);
    const log = await RunLog.start(writer, { mode: 'live', now: CLOCK });
    expect(log.id).toBe(1);
    expect(await new JsonRunsWriter(path).all()).toHaveLength(1);
  });
});
