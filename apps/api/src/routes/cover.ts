import type { FastifyPluginAsync } from 'fastify';

import { claimsOpenness } from '../claims/openness.js';
import { findSeries } from '../config.js';
import { coverKeyHash, normaliseCoverKey } from '../cover-key.js';
import type { PolicyRow } from '../db/types.js';
import { AppError } from '../errors.js';
import { seriesRowFrom } from '../series.js';
import type { Services } from '../services.js';
import { buildPolicyView, type PolicyView } from '../views.js';

/// POST /v1/cover/open
///
/// One of the two ways back into a dashboard. A cover key was issued once, at
/// bind, and this is where it is spent: the key comes in, the cover it opens
/// goes out, and nothing about the person goes out with it.
///
/// A POST rather than a GET with the key in the path, for one reason. A key in
/// a URL is in the browser's history, in a screenshot and in whatever the next
/// request sends as a referrer. In a body it is in none of those. It is
/// redacted from this API's logs by name in apps/api/src/server.ts.
///
/// Free, and deliberately not metered: `GET /v1/policy/:id` is already free
/// (DESIGN.md 3.7), so charging for the same view because the caller named it
/// with a key instead of an id would be charging for the way in rather than for
/// a reading.
///
/// A wrong key is a 404 with the same body whether the key was never issued or
/// was issued for a policy that has since gone. The response says nothing about
/// which, because the difference is only useful to somebody working through
/// keys they were not given.

export const coverRoutes: FastifyPluginAsync<{ services: Services }> = async (app, options) => {
  const { services } = options;

  app.post<{ Body: Record<string, unknown> }>('/v1/cover/open', async (request, reply) => {
    const raw = request.body?.['cover_key'];
    if (typeof raw !== 'string' || raw.trim() === '') {
      throw new AppError(
        400,
        'validation_failed',
        'Validation failed',
        'The cover key goes in `cover_key`.',
        [{ path: 'body.cover_key', message: 'expected the cover key as a string' }],
      );
    }
    const key = normaliseCoverKey(raw);
    // A key that is not the right shape is refused before it reaches the
    // database, and refused with the same answer a wrong key gets: a caller
    // learns nothing from the difference.
    const policy = key === null ? null : await services.repository.policyForCoverKey(coverKeyHash(key));
    if (policy === null) throw unknownKey();
    return reply.send({ cover: await coverView(services, policy) });
  });
};

function unknownKey(): AppError {
  return new AppError(
    404,
    'cover_key_unknown',
    'That key does not open a cover',
    'Check the key and try again, or sign in with World ID.',
  );
}

/**
 * The policy view, with the claims block where the chain can be read for it.
 *
 * The same pair of reads `GET /v1/policy/:id` makes, and the same view builder:
 * what is not in the view cannot leak, and the nullifier and the holder's EVM
 * address are not in it.
 */
export async function coverView(services: Services, policy: PolicyRow): Promise<PolicyView> {
  return buildPolicyView(policy, services.config.coverPoolAddress, await claims(services, policy));
}

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
