import type { FastifyPluginAsync } from 'fastify';

import { buildIndexHealth, type IndexHealth } from '../oracle/health.js';
import { readLastRun, type OracleRun } from '../oracle/runs.js';
import { readReplayState, type ReplayState } from '../replay/state.js';
import type { Services } from '../services.js';

/// Index operations health.
///
///     GET /v1/index/health
///
/// docs/INDEX-SPEC.md section 9 names this path and this content: the last run,
/// the last period per group, the QA status, the staleness of the source and
/// the mode. The deploy health check carries a summary of it, so one call says
/// whether the index is still being published and not only whether the process
/// is up.
///
/// It is free, and it sits under a prefix the x402 gate meters. The gate
/// exempts it by name in apps/api/src/x402/gate.ts and a test holds it open
/// with the gate configured: an operations endpoint that answers 402 is not an
/// operations endpoint. The alternative was `GET /v1/health`, outside the
/// metered prefix, which needed no exemption; the specification names this
/// path, an operator will type this path, and one exemption with a test on it
/// is cheaper than a route nobody looks for. See docs/DECISIONS.md.
///
/// Fastify matches a static segment before a parameter, so this route and
/// `GET /v1/index/:group` coexist and `health` never reaches the metered
/// handler. A test holds that too.
///
/// The two files it reads are the oracle's, over the volume both containers
/// mount. Neither is fetched over HTTP: a process that reaches itself through
/// the proxy to answer a health check is reporting the proxy's health.

export interface IndexHealthPluginOptions {
  services: Services;
  /** Injected in tests, so a route test needs no files on disk. */
  readRun?: () => OracleRun | null;
  readReplay?: () => ReplayState;
  now?: () => Date;
}

export async function indexHealth(options: IndexHealthPluginOptions): Promise<IndexHealth> {
  const readRun = options.readRun ?? ((): OracleRun | null => readLastRun());
  const readReplay = options.readReplay ?? ((): ReplayState => readReplayState());
  const now = options.now ?? ((): Date => new Date());
  return buildIndexHealth({
    run: readRun(),
    replay: readReplay(),
    latest: await options.services.repository.latestPeriods(),
    now: now(),
  });
}

export const indexHealthRoutes: FastifyPluginAsync<IndexHealthPluginOptions> = async (
  app,
  options,
) => {
  app.get('/v1/index/health', async (_request, reply) =>
    // No cache. A health document that a shared cache can hold is a health
    // document that can report a state the deployment left five minutes ago.
    reply.header('cache-control', 'no-store').send(await indexHealth(options)),
  );
};
