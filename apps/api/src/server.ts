import Fastify from 'fastify';

import { investorRoutes } from './investor/index.js';

/// A minimal bootstrap for the investor endpoints, so they can be run and
/// curled before the rest of the API exists.
///
/// T07 builds the real server: the x402 gate, the World verification, the
/// claim intake and Postgres. It registers `investorRoutes` the same way this
/// does, so nothing here has to be unpicked then.

export async function buildServer(): Promise<ReturnType<typeof Fastify>> {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });
  await app.register(investorRoutes);
  return app;
}
