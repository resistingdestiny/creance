import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { sourceHealth, type IndexHealth } from '../src/oracle/health.js';
import { readLastRun, type OracleRun } from '../src/oracle/runs.js';
import { idleReplayState, type ReplayState } from '../src/replay/state.js';
import { indexHealthRoutes } from '../src/routes/index-health.js';
import { buildTestServices, observation } from './policy-fixtures.js';

/// GET /v1/index/health, the operations endpoint of docs/INDEX-SPEC.md section
/// 9. The two files it reads are the oracle's, so both readers are injected
/// here and no test depends on var/oracle on the machine running it.
///
/// That it stays free with the x402 gate configured is held in
/// x402-routes.test.ts, beside the rule it could break.

const DONE: OracleRun = {
  id: 12,
  mode: 'live',
  state: 'done',
  started_at: '2026-09-05T14:10:00Z',
  finished_at: '2026-09-05T14:10:26Z',
  target_period: '2026-07',
  notes: 'published 15, submitted 1, skipped 0',
  qa_passed: true,
  failed_gates: [],
};

const FAILED: OracleRun = {
  ...DONE,
  id: 13,
  state: 'failed',
  notes: 'qa failed for 2026-07: bounds, computer_math u=55',
  qa_passed: false,
  failed_gates: [{ gate: 'bounds', detail: 'out of range for 2026-07: computer_math u=55' }],
};

const REPLAYING: ReplayState = {
  ...idleReplayState(new Date('2026-09-05T14:10:00Z')),
  mode: 'replay',
  running: true,
  current_period: '2026-04',
};

async function serverWith(options: {
  run?: OracleRun | null;
  replay?: ReplayState;
  now?: Date;
}): Promise<FastifyInstance> {
  const { services } = await buildTestServices({
    observations: [observation(), observation({ groupKey: 'legal', period: 202606 })],
  });
  const app = Fastify();
  await app.register(indexHealthRoutes, {
    services,
    readRun: () => options.run ?? null,
    readReplay: () => options.replay ?? idleReplayState(new Date('2026-09-05T14:10:00Z')),
    now: () => options.now ?? new Date('2026-09-05T14:10:00Z'),
  });
  await app.ready();
  return app;
}

describe('GET /v1/index/health', () => {
  let app: FastifyInstance | null = null;

  afterEach(async () => {
    await app?.close();
    app = null;
  });

  async function health(options: Parameters<typeof serverWith>[0] = {}) {
    app = await serverWith(options);
    const response = await app.inject({ method: 'GET', url: '/v1/index/health' });
    expect(response.statusCode).toBe(200);
    return response.json() as IndexHealth;
  }

  it('answers with the last run, the last period per group, qa, staleness and mode', async () => {
    const body = await health({ run: DONE });
    expect(body.status).toBe('ok');
    expect(body.mode).toBe('live');
    expect(body.last_run).toMatchObject({
      id: 12,
      state: 'done',
      target_period: '2026-07',
      finished_at: '2026-09-05T14:10:26Z',
    });
    expect(body.last_period_by_group).toEqual({ computer_math: '2026-07', legal: '2026-06' });
    expect(body.qa).toEqual({ status: 'pass', period: '2026-07', failed_gates: [] });
    expect(body.source).toEqual({
      newest_period: '2026-07',
      stale_days: 35,
      stale: false,
      stale_after_days: 45,
    });
    expect(body.model_version).toBe('odi-1.0.0');
  });

  it('names the gates that failed, so a pager body says what to look at', async () => {
    const body = await health({ run: FAILED });
    expect(body.status).toBe('failed');
    expect(body.qa).toMatchObject({ status: 'fail' });
    expect(body.qa.failed_gates).toEqual([
      { gate: 'bounds', detail: 'out of range for 2026-07: computer_math u=55' },
    ]);
  });

  it('reports the source as stale 46 days after the newest period', async () => {
    const body = await health({ run: DONE, now: new Date('2026-09-16T00:00:00Z') });
    expect(body.source).toMatchObject({ stale_days: 46, stale: true });
    expect(body.status).toBe('stale');
  });

  it('says which calendar the feed is on, so a reading is never reported as current by mistake', async () => {
    const body = await health({ run: DONE, replay: REPLAYING });
    expect(body.mode).toBe('replay');
    expect(body.replay).toMatchObject({ mode: 'replay', running: true, current_period: '2026-04' });
  });

  it('reads a deployment whose oracle has never run as never_run rather than an error', async () => {
    const body = await health({ run: null });
    expect(body.status).toBe('never_run');
    expect(body.last_run).toBeNull();
    expect(body.qa).toMatchObject({ status: 'unknown', failed_gates: [] });
    // The archive is loaded at boot, so the periods are there even when no run
    // on this machine put them there.
    expect(body.last_period_by_group).toEqual({ computer_math: '2026-07', legal: '2026-06' });
  });

  it('is not cached, because a cached health document reports the past', async () => {
    app = await serverWith({ run: DONE });
    const response = await app.inject({ method: 'GET', url: '/v1/index/health' });
    expect(response.headers['cache-control']).toBe('no-store');
  });
});

describe('the runs file the API reads', () => {
  it('takes the newest run and flattens its gate reports', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'creance-runs-')), 'runs.json');
    writeFileSync(
      path,
      JSON.stringify([
        { id: 1, mode: 'live', state: 'done', target_period: '2026-06', qa_json: [] },
        {
          id: 2,
          mode: 'live',
          state: 'failed',
          started_at: '2026-09-05T14:10:00Z',
          finished_at: '2026-09-05T14:10:04Z',
          target_period: '2026-07',
          notes: 'qa failed',
          qa_json: [
            { period: '2026-07', passed: false, gates: [], failures: [{ gate: 'jump', detail: 'sigma 9.2' }] },
          ],
        },
      ]),
      'utf8',
    );
    const run = readLastRun(path);
    expect(run).toMatchObject({ id: 2, state: 'failed', qa_passed: false });
    expect(run?.failed_gates).toEqual([{ gate: 'jump', detail: 'sigma 9.2' }]);
  });

  it('reads a missing or unreadable file as no run at all', () => {
    const directory = mkdtempSync(join(tmpdir(), 'creance-runs-'));
    expect(readLastRun(join(directory, 'nothing.json'))).toBeNull();
    const broken = join(directory, 'runs.json');
    writeFileSync(broken, 'half a document', 'utf8');
    expect(readLastRun(broken)).toBeNull();
  });

  it('coerces a hand edited row rather than letting it reach a response', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'creance-runs-')), 'runs.json');
    writeFileSync(path, JSON.stringify([{ id: 4, mode: 'sideways', state: 'melted' }]), 'utf8');
    expect(readLastRun(path)).toMatchObject({
      id: 4,
      mode: 'live',
      state: 'fetch',
      qa_passed: null,
      target_period: null,
    });
  });
});

describe('the staleness line', () => {
  it('holds at 45 days and trips at 46, the same line the oracle alerts on', () => {
    expect(sourceHealth('2026-07', new Date('2026-09-15T00:00:00Z')).stale).toBe(false);
    expect(sourceHealth('2026-07', new Date('2026-09-16T00:00:00Z')).stale).toBe(true);
    expect(sourceHealth('2026-12', new Date('2027-01-05T00:00:00Z')).stale_days).toBe(4);
    expect(sourceHealth(null, new Date('2026-09-05T00:00:00Z'))).toMatchObject({ stale: false });
  });
});
