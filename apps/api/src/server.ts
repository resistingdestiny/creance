import Fastify, { type FastifyInstance } from 'fastify';

import { adminClaimRoutes } from './claims/index.js';
import { registerErrorHandling } from './errors.js';
import { investorRoutes } from './investor/index.js';
import { replayRoutes } from './replay/index.js';
import { auditRoutes } from './routes/audit.js';
import { bindRoutes } from './routes/bind.js';
import { indexRoutes } from './routes/index-feed.js';
import { opsRoutes } from './routes/ops.js';
import { policyRoutes } from './routes/policy.js';
import { quoteRoutes } from './routes/quote.js';
import { worldRoutes } from './world/routes.js';
import { buildServices, type BuildServicesOptions, type Services } from './services.js';
import { registerX402 } from './x402/gate.js';

/// The server.
///
/// It is here rather than in main.ts so a test can build one without listening
/// on a port. The investor plugin from T14 is registered unchanged, which is
/// what docs/DECISIONS.md, "The investor endpoints stand alone", said would
/// happen when this ticket arrived.

export interface ServerOptions extends BuildServicesOptions {
  services?: Services;
}

export async function buildServer(
  options: ServerOptions = {},
): Promise<FastifyInstance & { services: Services }> {
  const services = options.services ?? (await buildServices(options));

  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      // The one certain way to leak a person's identity out of this system is
      // an error log that serialises a request body.
      redact: [
        'req.headers.authorization',
        'req.headers["payment-signature"]',
        'req.headers.cookie',
        'req.body.eligibility',
        'nullifier',
      ],
    },
    // A JSON API has no business accepting a megabyte, which is Fastify's
    // default. The claim evidence route in T13 raises it for itself.
    bodyLimit: 64 * 1024,
  });

  registerErrorHandling(app);

  // Before the routes: the gate is an onRequest hook and it has to be in place
  // when a paid route is matched. DESIGN.md 3.7.
  if (services.x402 !== null) registerX402(app, services.x402);

  await app.register(investorRoutes);
  await app.register(replayRoutes);
  await app.register(opsRoutes, { services });
  await app.register(indexRoutes, { services });
  await app.register(quoteRoutes, { services });
  await app.register(bindRoutes, { services });
  await app.register(policyRoutes, { services });
  await app.register(auditRoutes, { services });
  await app.register(worldRoutes, { services });
  await app.register(adminClaimRoutes, { services });

  return Object.assign(app, { services }) as FastifyInstance & { services: Services };
}
