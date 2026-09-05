import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { idleReplayState, type ReplayState } from '../src/replay/state.js';
import { opsRoutes } from '../src/routes/ops.js';
import { buildTestServer, buildTestServices } from './policy-fixtures.js';

/// GET /health is the deployment's own answer to "which commit is live and is
/// the demo clock walking", which is the definition of done in MISSION.md and
/// the acceptance for this ticket. GET /healthz is the same handler under the
/// path that shipped first.
///
/// The replay reader is injected, so these tests neither write nor depend on
/// var/oracle/replay-state.json on the machine running them.

const REPLAYING: ReplayState = {
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

async function serverWith(state: ReplayState): Promise<FastifyInstance> {
  const { services } = await buildTestServices();
  const app = Fastify();
  await app.register(opsRoutes, { services, readReplay: () => state });
  await app.ready();
  return app;
}

describe('GET /health', () => {
  let app: FastifyInstance | null = null;

  afterEach(async () => {
    await app?.close();
    app = null;
  });

  it('returns the git SHA the definition of done asks for', async () => {
    app = await serverWith(idleReplayState());
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.sha).toBe('testsha');
    expect(body.status).toBe('ok');
    expect(body.network).toBe('testnet');
  });

  it('returns the oracle run state, so one call says whether the clock is walking', async () => {
    app = await serverWith(REPLAYING);
    const body = (await app.inject({ method: 'GET', url: '/health' })).json();
    expect(body.replay).toEqual(REPLAYING);
  });

  it('reads a clone that has never run the oracle as live and idle', async () => {
    app = await serverWith(idleReplayState());
    const body = (await app.inject({ method: 'GET', url: '/health' })).json();
    expect(body.replay.mode).toBe('live');
    expect(body.replay.running).toBe(false);
  });

  it('answers /healthz with the same body, because the older path is an alias', async () => {
    app = await serverWith(REPLAYING);
    const health = (await app.inject({ method: 'GET', url: '/health' })).json();
    const healthz = (await app.inject({ method: 'GET', url: '/healthz' })).json();
    expect({ ...healthz, time: null }).toEqual({ ...health, time: null });
  });

  it('is served by the real server on both paths', async () => {
    const built = await buildTestServer();
    try {
      for (const url of ['/health', '/healthz']) {
        const response = await built.app.inject({ method: 'GET', url });
        expect(response.statusCode).toBe(200);
        expect(response.json().sha).toBe('testsha');
        expect(response.json().replay.mode).toBeDefined();
      }
    } finally {
      await built.app.close();
    }
  });
});
