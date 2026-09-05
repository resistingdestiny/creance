import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import {
  badgeFor,
  idleReplayState,
  parseReplayState,
  readReplayState,
  replayRoutes,
  replayStatePath,
  type ReplayState,
} from '../src/replay/index.js';

/// The oracle writes the file, the API reads it. These tests write the file the
/// oracle would write, so a change to the shape on either side is caught here.

function scratchFile(state: unknown): string {
  const path = join(mkdtempSync(join(tmpdir(), 'creance-replay-')), 'replay-state.json');
  writeFileSync(path, JSON.stringify(state, null, 2));
  return path;
}

const RUNNING: ReplayState = {
  mode: 'replay',
  running: true,
  series: 'ODI-COMP-2026-01',
  from: '2025-01',
  to: '2026-07',
  current_period: '2026-04',
  latest_published: '2026-04',
  started_at: '2026-09-05T12:00:00Z',
  updated_at: '2026-09-05T12:02:30Z',
  scenario_label: null,
};

async function get(options: Parameters<typeof replayRoutes>[1]) {
  const app = Fastify();
  await app.register(replayRoutes, options);
  const response = await app.inject({ method: 'GET', url: '/v1/replay' });
  await app.close();
  return response;
}

describe('reading the oracle run state', () => {
  it('is live and idle when the oracle has never run', () => {
    expect(readReplayState(join(tmpdir(), 'no-such-creance-state.json'))).toMatchObject({
      mode: 'live',
      running: false,
    });
  });

  it('reads a running replay off disk', () => {
    expect(readReplayState(scratchFile(RUNNING))).toEqual(RUNNING);
  });

  it('coerces a file that is not the shape it expects rather than throwing', () => {
    expect(parseReplayState('{"mode":42,"running":"yes","current_period":null}')).toMatchObject({
      mode: 'live',
      running: false,
      current_period: null,
    });
    expect(readReplayState(scratchFile('not an object'))).toMatchObject({ mode: 'live' });
  });

  it('takes the path the oracle writes to from the same variable', () => {
    expect(replayStatePath({ ORACLE_STATE_PATH: '/tmp/somewhere/state.json' })).toBe(
      '/tmp/somewhere/state.json',
    );
    expect(replayStatePath({})).toMatch(/var\/oracle\/replay-state\.json$/);
  });
});

describe('the badge the web app shows', () => {
  it('shows nothing on the live path', () => {
    expect(badgeFor(idleReplayState())).toBeNull();
  });

  it('says REPLAY while the demo clock is walking', () => {
    expect(badgeFor(RUNNING)).toEqual({ show: true, label: 'REPLAY' });
  });

  it('stays up after the clock stops, because the numbers still came from it', () => {
    expect(badgeFor({ ...RUNNING, running: false })).toEqual({ show: true, label: 'REPLAY' });
  });

  it('names the scenario in scenario mode', () => {
    expect(
      badgeFor({ ...RUNNING, mode: 'scenario', scenario_label: 'Synthetic shock, spring 2026' }),
    ).toEqual({ show: true, label: 'Synthetic shock, spring 2026' });
    expect(badgeFor({ ...RUNNING, mode: 'scenario' })).toEqual({ show: true, label: 'SCENARIO' });
  });
});

describe('GET /v1/replay', () => {
  it('serves the state and the badge', async () => {
    const response = await get({ read: () => RUNNING });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ...RUNNING, badge: { show: true, label: 'REPLAY' } });
  });

  it('serves live and idle when the oracle has never run', async () => {
    const response = await get({ statePath: join(tmpdir(), 'no-such-creance-state.json') });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ mode: 'live', running: false, badge: null });
  });

  it('reads the file through the path it was given', async () => {
    const response = await get({ statePath: scratchFile({ ...RUNNING, mode: 'scenario', scenario_label: 'A' }) });
    expect(response.json()).toMatchObject({ mode: 'scenario', badge: { label: 'A' } });
  });
});
