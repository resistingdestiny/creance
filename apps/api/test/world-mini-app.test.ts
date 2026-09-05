import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { miniAppEntry, miniAppLaunchUrl, occupationIndexPath } from '../src/world/mini-app.js';
import { buildTestServer, CONFIG, type TestHarness } from './policy-fixtures.js';

/// GET /v1/world/mini-app, and the links it answers with.
///
/// The links are checked against the schema the quick actions page publishes,
/// which asks for the path encoded once. The SDK's own `getMiniAppUrl` encodes it
/// twice; that difference is pinned by a test in the web app, where the SDK
/// lives, so a release that changes it fails a test rather than quietly changing
/// what we publish.

const MINI_APP_ID = 'app_1ff11ea9d0eb0d3ea0e9e17e0f7d2d3f';

describe('the Mini App entry links', () => {
  it('launches at the app id alone, on the documented host', () => {
    expect(miniAppLaunchUrl(MINI_APP_ID)).toBe(
      `https://world.org/mini-app?app_id=${MINI_APP_ID}`,
    );
  });

  it('encodes the path once, as the quick actions schema asks', () => {
    const entry = miniAppEntry(MINI_APP_ID, occupationIndexPath('computer_math'));

    expect(entry.path).toBe('/cover/index/computer_math');
    expect(entry.url).toBe(
      `https://world.org/mini-app?app_id=${MINI_APP_ID}&path=%2Fcover%2Findex%2Fcomputer_math`,
    );
    expect(entry.miniAppPath).toBe(
      `worldapp://mini-app?app_id=${MINI_APP_ID}&path=%2Fcover%2Findex%2Fcomputer_math`,
    );
  });

  it('makes a relative path absolute', () => {
    expect(miniAppEntry(MINI_APP_ID, 'cover/index/legal').path).toBe('/cover/index/legal');
  });
});

describe('GET /v1/world/mini-app', () => {
  let app: FastifyInstance | null = null;

  afterEach(async () => {
    await app?.close();
    app = null;
  });

  async function harness(miniAppId: string): Promise<TestHarness & { app: FastifyInstance }> {
    const built = await buildTestServer({
      config: { ...CONFIG, world: { ...CONFIG.world, miniAppId } },
    });
    app = built.app;
    return built;
  }

  it('says the deployment has no Mini App until one is registered', async () => {
    const built = await harness('');

    const response = await built.app.inject({ method: 'GET', url: '/v1/world/mini-app' });

    expect(response.statusCode).toBe(503);
    expect(response.json().code).toBe('world_mini_app_not_configured');
  });

  it('answers with the launch link and the occupation index entry', async () => {
    const built = await harness(MINI_APP_ID);

    const response = await built.app.inject({ method: 'GET', url: '/v1/world/mini-app' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      app_id: MINI_APP_ID,
      launch_url: `https://world.org/mini-app?app_id=${MINI_APP_ID}`,
      occupation_index: {
        group: 'computer_math',
        label: 'Computer and mathematical',
        series_id: 'ODI-COMP-2026-01',
        path: '/cover/index/computer_math',
        url: `https://world.org/mini-app?app_id=${MINI_APP_ID}&path=%2Fcover%2Findex%2Fcomputer_math`,
        mini_app_path: `worldapp://mini-app?app_id=${MINI_APP_ID}&path=%2Fcover%2Findex%2Fcomputer_math`,
      },
    });
  });

  it('opens another occupation when one is named, and says it has no series', async () => {
    const built = await harness(MINI_APP_ID);

    const response = await built.app.inject({
      method: 'GET',
      url: '/v1/world/mini-app?group=legal',
    });

    const body = response.json();
    expect(response.statusCode).toBe(200);
    expect(body.occupation_index.path).toBe('/cover/index/legal');
    expect(body.occupation_index.series_id).toBe(null);
  });

  it('refuses an occupation the index does not cover', async () => {
    const built = await harness(MINI_APP_ID);

    const response = await built.app.inject({
      method: 'GET',
      url: '/v1/world/mini-app?group=astronaut',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('group_unknown');
  });
});
