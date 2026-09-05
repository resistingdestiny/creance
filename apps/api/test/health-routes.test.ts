import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import type { Repository } from '../src/db/types.js';
import type { OracleRun } from '../src/oracle/runs.js';
import { idleReplayState, type ReplayState } from '../src/replay/state.js';
import { opsRoutes } from '../src/routes/ops.js';
import { buildServices } from '../src/services.js';
import { buildTestServer, buildTestServices, observation } from './policy-fixtures.js';

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

const LAST_RUN: OracleRun = {
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

async function serverWith(
  state: ReplayState,
  run: OracleRun | null = LAST_RUN,
): Promise<FastifyInstance> {
  const { services } = await buildTestServices({ observations: [observation()] });
  const app = Fastify();
  await app.register(opsRoutes, {
    services,
    readReplay: () => state,
    readRun: () => run,
    now: () => new Date('2026-09-05T14:10:00Z'),
  });
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

  it('reads a blank GIT_SHA as unknown, because .env.example ships it empty', async () => {
    const fixture = await buildTestServices();
    const previous = process.env.GIT_SHA;
    process.env.GIT_SHA = '  ';
    try {
      const services = await buildServices({
        config: fixture.services.config,
        repository: fixture.repository,
        chain: fixture.chain,
        hedera: null,
        x402: null,
        indexData: null,
        issuer: fixture.services.issuer,
        loadIndex: false,
      });
      expect(services.gitSha).toBe('unknown');
    } finally {
      if (previous === undefined) delete process.env.GIT_SHA;
      else process.env.GIT_SHA = previous;
    }
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

describe('the index block on GET /health', () => {
  let app: FastifyInstance | null = null;

  afterEach(async () => {
    await app?.close();
    app = null;
  });

  it('says whether the index is still being published, not only whether the process is up', async () => {
    app = await serverWith(idleReplayState());
    const body = (await app.inject({ method: 'GET', url: '/health' })).json();
    expect(body.index).toEqual({
      status: 'ok',
      mode: 'live',
      database: 'ok',
      last_run: {
        id: 12,
        state: 'done',
        target_period: '2026-07',
        finished_at: '2026-09-05T14:10:26Z',
      },
      qa: 'pass',
      newest_period: '2026-07',
      stale_days: 35,
      stale: false,
    });
  });

  it('keeps the sha and the replay block the deploy script already reads', async () => {
    app = await serverWith(REPLAYING);
    const body = (await app.inject({ method: 'GET', url: '/health' })).json();
    expect(body.sha).toBe('testsha');
    expect(body.replay).toEqual(REPLAYING);
    expect(body.status).toBe('ok');
  });

  it('reads a deployment whose oracle has never run as never_run, and still answers 200', async () => {
    app = await serverWith(idleReplayState(), null);
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json().index).toMatchObject({ status: 'never_run', last_run: null, qa: 'unknown' });
  });

  it('does not turn a stale source into a failing container', async () => {
    // Restarting this container would not make the Bureau of Labor Statistics
    // publish, so staleness is reported and the status code stays 200.
    const { services } = await buildTestServices({ observations: [observation()] });
    const stale = Fastify();
    await stale.register(opsRoutes, {
      services,
      readReplay: () => idleReplayState(),
      readRun: () => LAST_RUN,
      now: () => new Date('2026-11-01T00:00:00Z'),
    });
    await stale.ready();
    try {
      const response = await stale.inject({ method: 'GET', url: '/health' });
      expect(response.statusCode).toBe(200);
      expect(response.json().index).toMatchObject({ status: 'stale', stale: true });
    } finally {
      await stale.close();
    }
  });
});

describe('GET /health with the database down', () => {
  let app: FastifyInstance | null = null;

  afterEach(async () => {
    await app?.close();
    app = null;
  });

  /**
   * A repository that refuses every read, keeping the rest of the instance.
   *
   * `Object.create` rather than a spread, because the methods are on the
   * prototype: a spread would give an object with the fields and none of the
   * behaviour, which is a different failure from the one being tested.
   */
  function unreachable(repository: Repository): Repository {
    const refuse = async (): Promise<never> => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:5432');
    };
    return Object.assign(Object.create(repository) as Repository, {
      groups: refuse,
      latestPeriods: refuse,
    });
  }

  async function degraded(): Promise<FastifyInstance> {
    const built = await buildTestServices({ observations: [observation()] });
    const server = Fastify();
    await server.register(opsRoutes, {
      services: { ...built.services, repository: unreachable(built.repository) },
      readReplay: () => REPLAYING,
      readRun: () => LAST_RUN,
      now: () => new Date('2026-09-05T14:10:00Z'),
    });
    await server.ready();
    return server;
  }

  it('still returns the degraded document, with the sha and the replay state', async () => {
    // The case this endpoint exists for. A handler that throws because it could
    // not read the database answers with an error envelope, and then the one
    // call that says which commit is deployed and whether the clock is walking
    // says neither, exactly when an operator needs it most.
    app = await degraded();
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(503);
    const body = response.json();
    expect(body.status).toBe('degraded');
    expect(body.sha).toBe('testsha');
    expect(body.deps.db).toBe('unreachable');
    expect(body.replay).toEqual(REPLAYING);
  });

  it('still carries an index block, because the run and the gates come from files', async () => {
    app = await degraded();
    const body = (await app.inject({ method: 'GET', url: '/health' })).json();
    expect(body.index).toEqual({
      status: 'degraded',
      mode: 'replay',
      database: 'unreachable',
      last_run: {
        id: 12,
        state: 'done',
        target_period: '2026-07',
        finished_at: '2026-09-05T14:10:26Z',
      },
      qa: 'pass',
      newest_period: null,
      stale_days: null,
      stale: false,
    });
  });
});
