import type { FastifyPluginAsync } from 'fastify';

import { buildAuditTrail } from '../audit/trail.js';
import { AppError } from '../errors.js';
import { hasPrefix } from '../ids.js';
import type { Services } from '../services.js';

/// GET /v1/audit/:policyId
///
/// Free, like `GET /v1/policy/:id` and for the same reason: DESIGN.md 3.7 says
/// the audit trail is verifiable independently of our database, and a trail
/// that has to be paid for is not. It carries no personal data, so it is safe
/// to hand to a stranger who guessed an id; `buildAuditTrail` is what enforces
/// that, by naming the fields of each message kind rather than copying it.
///
/// The database supplies the sequence numbers and the mirror node supplies the
/// message bodies, so what comes back is what is on the topic. Where the two
/// disagree the entry says so rather than quietly preferring the row.

export const auditRoutes: FastifyPluginAsync<{ services: Services }> = async (app, options) => {
  const { services } = options;

  app.get<{ Params: { policyId: string } }>('/v1/audit/:policyId', async (request, reply) => {
    const id = request.params.policyId;
    // The same 400 as the policy route: a 404 would make a caller retry a
    // request that can never succeed.
    if (!hasPrefix(id, 'policy')) {
      throw new AppError(400, 'bad_id_prefix', 'Not a policy id', 'A policy id starts with pol_.');
    }
    const policy = await services.repository.policy(id);
    if (policy === null) {
      throw new AppError(404, 'policy_not_found', 'Policy not found', 'No policy with that id.');
    }

    const [payments, claims] = await Promise.all([
      services.repository.paymentsForPolicy(policy.policyId, policy.quoteId),
      services.repository.claimAudit(policy.policyId),
    ]);

    return reply.send(
      await buildAuditTrail({
        policy,
        payments,
        claims,
        config: services.config,
        mirror: services.mirror,
      }),
    );
  });
};
