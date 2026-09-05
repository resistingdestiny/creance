import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { StateFile, idleState, readState, writeState } from '../src/state.js';
import { JsonObservationWriter, MemoryObservationWriter, type ObservationRecord } from '../src/store.js';

function scratch(): string {
  return mkdtempSync(join(tmpdir(), 'creance-oracle-'));
}

describe('the run state file', () => {
  it('reads as idle and live when nothing has run', () => {
    const state = readState(join(scratch(), 'nothing.json'));
    expect(state).toMatchObject({ mode: 'live', running: false, current_period: null });
  });

  it('survives a file that is not the shape it expects', () => {
    const path = join(scratch(), 'replay-state.json');
    writeFileSync(path, '{"mode":"nonsense","running":"yes","from":7}');
    expect(readState(path)).toMatchObject({ mode: 'live', running: false, from: null });
  });

  it('round trips through the file', () => {
    const path = join(scratch(), 'replay-state.json');
    const state = { ...idleState(), mode: 'replay' as const, series: 'ODI-COMP-2026-01' };
    writeState(path, state);
    expect(readState(path)).toEqual(state);
  });

  it('tracks a replay through start, ticks and finish', () => {
    const path = join(scratch(), 'replay-state.json');
    const file = new StateFile(path, { mode: 'replay', series: 'ODI-COMP-2026-01', from: '2025-01', to: '2025-03' });
    file.start();
    expect(readState(path).running).toBe(true);

    file.advance('2025-01', true);
    file.advance('2025-02', false);
    const midway = readState(path);
    expect(midway.current_period).toBe('2025-02');
    // A tick that published nothing does not move the published marker.
    expect(midway.latest_published).toBe('2025-01');

    file.finish();
    const done = readState(path);
    expect(done.running).toBe(false);
    expect(done.current_period).toBe('2025-02');
  });

  it('carries a scenario label so a screen can name the scenario', () => {
    const path = join(scratch(), 'replay-state.json');
    const file = new StateFile(path, { mode: 'scenario', scenario_label: 'Synthetic shock' });
    file.start();
    expect(readState(path)).toMatchObject({ mode: 'scenario', scenario_label: 'Synthetic shock' });
  });
});

const RECORD: ObservationRecord = {
  group_key: 'computer_math',
  period: '2026-04',
  series: 'ODI-COMP-2026-01',
  u_g: 3.5,
  u_all: 4,
  e: -0.5,
  ebar: -0.6,
  odi: 0.3,
  open: true,
  open_reason: 'level',
  status: 'final',
  model_version: 'odi-1.0.0',
  hcs_topic: '0.0.10366470',
  hcs_seq: 16,
  hcs_tx: '0.0.1@2.3',
  submit_tx: '0xabc',
  revises_seq: null,
  mode: 'replay',
  replay: true,
  scenario_label: null,
  source_files: [],
  message: {} as ObservationRecord['message'],
  written_at: '2026-09-05T12:00:00Z',
};

describe('the observation store', () => {
  // This asserted the opposite until the mode keyed guard was found to let the
  // live path republish a month the replay had already put on the index topic.
  // Live and replay write the same topic, so one row covers both; a scenario
  // writes no index message and keeps its own.
  it('keys on group and period across the two modes that write the index topic', async () => {
    const writer = new MemoryObservationWriter();
    await writer.write(RECORD);
    expect(await writer.has('computer_math', '2026-04', 'replay')).toBe(true);
    expect(await writer.has('computer_math', '2026-04', 'live')).toBe(true);
    expect(await writer.has('computer_math', '2026-04', 'scenario')).toBe(false);
    expect(await writer.has('legal', '2026-04', 'replay')).toBe(false);
  });

  it('answers a live lookup with the replay row, mode and all', async () => {
    const writer = new MemoryObservationWriter();
    await writer.write(RECORD);
    const found = await writer.get('computer_math', '2026-04', 'live');
    expect(found?.mode).toBe('replay');
    expect(found?.hcs_seq).toBe(RECORD.hcs_seq);
  });

  it('keeps a scenario row beside the real one for the same group and period', async () => {
    const writer = new MemoryObservationWriter();
    await writer.write(RECORD);
    await writer.write({ ...RECORD, mode: 'scenario', scenario_label: 'comp-shock-2026', hcs_seq: null });
    expect(await writer.all()).toHaveLength(2);
    expect((await writer.get('computer_math', '2026-04', 'live'))?.mode).toBe('replay');
    expect((await writer.get('computer_math', '2026-04', 'scenario'))?.scenario_label).toBe(
      'comp-shock-2026',
    );
  });

  it('persists to a file and reloads through a new writer', async () => {
    const path = join(scratch(), 'observations.json');
    const writer = new JsonObservationWriter(path);
    await writer.write(RECORD);
    await writer.write({ ...RECORD, period: '2026-05', hcs_seq: 17 });

    const reopened = new JsonObservationWriter(path);
    expect(await reopened.has('computer_math', '2026-04', 'replay')).toBe(true);
    expect((await reopened.get('computer_math', '2026-05', 'replay'))?.hcs_seq).toBe(17);
    expect(await reopened.all()).toHaveLength(2);
  });

  it('replaces a row rather than appending a second one for the same key', async () => {
    const path = join(scratch(), 'observations.json');
    const writer = new JsonObservationWriter(path);
    await writer.write(RECORD);
    await writer.write({ ...RECORD, submit_tx: '0xdef' });
    expect(await writer.all()).toHaveLength(1);
    expect((await writer.get('computer_math', '2026-04', 'replay'))?.submit_tx).toBe('0xdef');
  });
});
