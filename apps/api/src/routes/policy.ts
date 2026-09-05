import type { FastifyPluginAsync } from 'fastify';

import { claimsOpenness } from '../claims/openness.js';
import { findSeries } from '../config.js';
import type { PolicyRow } from '../db/types.js';
import { AppError } from '../errors.js';
import { hasPrefix } from '../ids.js';
import { seriesRowFrom } from '../series.js';
import type { Services } from '../services.js';
import { buildPolicyView, type PolicyView } from '../views.js';

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
    return reply.send(
      buildPolicyView(policy, services.config.coverPoolAddress, await claims(services, policy)),
    );
  });
};

async function claims(services: Services, policy: PolicyRow): Promise<PolicyView['claims']> {
  const config = findSeries(services.config, policy.seriesId);
  if (config === undefined) return undefined;
  try {
    const state = await services.chain.seriesState(config.seriesId);
    const row = seriesRowFrom(config, state, services.config);
    await services.repository.upsertSeries(row);
    const observations = await services.repository.observations(policy.groupKey, 1);
    const openness = claimsOpenness({
      policy,
      series: row,
      state,
      observation: observations[0] ?? null,
    });
    return {
      open: openness.open,
      code: openness.code,
      title: openness.title,
      reason_lines: openness.reason_lines,
      reading: openness.reading,
    };
  } catch {
    return undefined;
  }
}
