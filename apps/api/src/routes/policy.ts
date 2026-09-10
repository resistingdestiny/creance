import type { FastifyPluginAsync } from 'fastify';

import { AppError } from '../errors.js';
import { hasPrefix } from '../ids.js';
import type { Services } from '../services.js';
import { coverView } from './cover.js';

/// GET /v1/policy/:id
///
/// Free, because DESIGN.md 3.7 says free. That decides the response: it has to
/// be safe to hand to a stranger who guessed an id, so it carries the cover,
/// the dates, the receipt and the chain links and nothing that identifies the
/// person. `buildPolicyView` is the enforcement, not a convention: a field that
/// is not in the view cannot leak even if a handler starts returning the row.

export const policyRoutes: FastifyPluginAsync<{ services: Services }> = async (app, options) => {
  const { services } = options;

  app.get<{ Params: { id: string } }>('/v1/policy/:id', async (request, reply) => {
    const id = request.params.id;
    // A wrong prefix is a 400 rather than a 404, because a 404 makes a caller
    // retry a request that can never succeed.
    if (!hasPrefix(id, 'policy')) {
      throw new AppError(
        400,
        'bad_id_prefix',
        'Not a policy id',
        'A policy id starts with pol_.',
      );
    }
    const policy = await services.repository.policy(id);
    if (policy === null) {
      throw new AppError(404, 'policy_not_found', 'Policy not found', 'No policy with that id.');
    }
    return reply.send(await coverView(services, policy));
  });
};
