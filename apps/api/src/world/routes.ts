import type { FastifyPluginAsync } from 'fastify';

import { seriesForGroup } from '../config.js';
import type { CredentialRow } from '../db/types.js';
import { AppError } from '../errors.js';
import { requiredString } from '../routes/quote.js';
import type { Services } from '../services.js';
import { rfc3339 } from '../views.js';
import { requestContext, WorldNotConfigured } from './rp-context.js';
import { verifySelfieCheck, type IdKitResult } from './verify.js';

/// The two World endpoints the purchase flow uses.
///
///   POST /v1/world/rp-context   a fresh signed context for one IDKit request
///   POST /v1/world/verify       the completed result, checked, then a credential
///
/// Neither is metered. A person confirming they are a person is not a paid
/// call, and the x402 gate covers the index feed, the quote and the bind.
///
/// The credential the second endpoint mints is the one DESIGN.md 3.6 describes
/// and apps/api/src/credentials.ts already issues and verifies. T11 replaces
/// only how it is earned: a Selfie Check that World confirmed, rather than the
/// labelled interim issuer in apps/api/src/routes/ops.ts.

export const worldRoutes: FastifyPluginAsync<{ services: Services }> = async (app, options) => {
  const { services } = options;
  const world = services.config.world;

  /**
   * A signed context, one per widget opening.
   *
   * Never cached: reusing a nonce returns `duplicate_nonce`, and the context
   * expires in five minutes by default, so a retry after someone cancelled
   * needs its own. The response carries the app id, the action, the preset and
   * the environment as well, so the browser has one source for all of them and
   * the web app holds no World configuration of its own.
   */
  app.post<{ Body: Record<string, unknown> }>('/v1/world/rp-context', async (request, reply) => {
    const body = request.body ?? {};
    const wallet = requiredString(body['wallet'], 'wallet');
    const context = signed(services, wallet);
    request.log?.debug(
      { created_at: context.created_at, expires_at: context.expires_at, action: context.action },
      'issued an rp_context',
    );
    return reply.status(201).send(context);
  });

  /**
   * The completed result, verified, and the credential it earns.
   *
   * The signal is not taken from the body. It is the wallet the credential will
   * be issued to, so a caller cannot name the value its own proof was bound to
   * and pass the check that way.
   */
  app.post<{ Body: Record<string, unknown> }>('/v1/world/verify', async (request, reply) => {
    const body = request.body ?? {};
    const groupKey = requiredString(body['group'], 'group');
    const wallet = requiredString(body['wallet'], 'wallet');
    const walletEvm = requiredString(body['wallet_evm'], 'wallet_evm');
    const result = body['result'];
    if (result === null || typeof result !== 'object' || Array.isArray(result)) {
      throw new AppError(
        400,
        'validation_failed',
        'Validation failed',
        'The complete IDKit result goes in `result`, unchanged.',
        [{ path: 'body.result', message: 'expected the IDKit result object' }],
      );
    }

    const group = await services.repository.group(groupKey);
    if (group === null) {
      throw new AppError(
        400,
        'group_unknown',
        'Unknown occupation',
        'That is not one of the fifteen occupation groups this index covers.',
      );
    }
    const series = seriesForGroup(services.config, groupKey);
    if (series === undefined) {
      throw new AppError(
        409,
        'no_capacity_for_group',
        'No cover behind this occupation',
        'No series has been issued for that occupation, so a credential for it would buy nothing.',
      );
    }
    if (!world.enabled) throw notConfigured();

    const verification = await verifySelfieCheck({
      world,
      purpose: 'purchase',
      signal: wallet,
      result: result as IdKitResult,
      onWorldError: (worldBody, status) =>
        request.log?.warn(
          {
            status,
            code: worldBody.code,
            detail: worldBody.detail,
            attribute: worldBody.attribute,
          },
          'World refused a proof',
        ),
    });

    // Before the pay step, not only at bind. The rule is the same rule the
    // database takes inside `reservePolicy`; taking it here as well is what
    // lets the screen say it to someone who has not been asked for money yet.
    const active = await services.repository.activePolicy(verification.nullifier, series.label);
    if (active !== null) {
      throw new AppError(
        409,
        'already_covered',
        'Already covered',
        'One person, one cover. This stops bots and duplicate accounts.',
        [{ path: 'policy_id', message: active.policyId }],
      );
    }

    const issued = await services.issuer.issue({
      nullifier: verification.nullifier,
      group: groupKey,
      series_id: series.label,
      wallet,
      wallet_evm: walletEvm,
      scope: 'bind',
      world: {
        action: verification.action,
        environment: verification.environment,
        credential: verification.credential,
        verified_at: verification.verifiedAt,
        presence: verification.presence,
      },
    });

    await services.repository.upsertUser({
      nullifier: verification.nullifier,
      groupKey,
      wallet,
      walletEvm,
    });
    const row: CredentialRow = {
      jti: issued.jti,
      kind: 'eligibility',
      nullifier: verification.nullifier,
      seriesId: series.label,
      groupKey,
      policyId: null,
      wallet,
      walletEvm,
      presence: verification.presence,
      issuer: 'world',
      issuedAt: issued.issuedAt.toISOString(),
      expiresAt: issued.expiresAt.toISOString(),
      consumedAt: null,
    };
    await services.repository.insertCredential(row);

    return reply.status(201).send({
      eligibility: issued.token,
      jti: issued.jti,
      series_id: series.label,
      group: groupKey,
      wallet,
      expires_at: rfc3339(issued.expiresAt),
      issuer: 'world',
      world: {
        environment: verification.environment,
        credential: verification.credential,
        protocol_version: verification.protocolVersion,
        presence: verification.presence,
      },
    });
  });
};

function signed(services: Services, wallet: string) {
  try {
    return requestContext(services.config.world, 'purchase', wallet);
  } catch (error) {
    if (error instanceof WorldNotConfigured) throw notConfigured();
    throw error;
  }
}

function notConfigured(): AppError {
  return new AppError(
    503,
    'world_not_configured',
    'The check is not configured',
    'This deployment has no World ID app id and RP signing key, so it cannot run a Selfie Check.',
  );
}
