import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';

import { seriesForGroup } from '../config.js';
import type { CredentialRow } from '../db/types.js';
import { AppError } from '../errors.js';
import { requiredString } from '../routes/quote.js';
import type { Services } from '../services.js';
import { rfc3339 } from '../views.js';
import { continuityHolds } from './config.js';
import { miniAppEntry, miniAppLaunchUrl, occupationIndexPath } from './mini-app.js';
import { coverView } from '../routes/cover.js';
import { requestContext, WorldNotConfigured, type WorldPurpose } from './rp-context.js';
import { verifySelfieCheck, type IdKitResult, type VerifyInput } from './verify.js';

/// The four World endpoints.
///
///   POST /v1/world/rp-context   a fresh signed context for one IDKit request
///   POST /v1/world/verify       the completed result, checked, then a credential
///   POST /v1/world/sign-in      the completed result, checked, then their cover
///   GET  /v1/world/mini-app     the Mini App id and the links that enter it
///
/// None of them is metered. A person confirming they are a person is not a paid
/// call, an entry link is public by construction, and the x402 gate covers the
/// index feed, the quote and the bind.
///
/// Each endpoint runs two ways, told apart by `purpose`. At purchase the signal
/// is the wallet and no liveness check is asked for; at claim the signal is the
/// policy id, `require_user_presence` is set, and what is earned is a claim
/// credential in its own audience rather than an eligibility credential
/// (DESIGN.md 3.6 and 3.9 item 1). One pair of endpoints rather than four,
/// because the difference is three values and the checks are the same checks:
/// two handlers would be two places for the signal comparison to be forgotten
/// in, and forgetting it is the whole of the vulnerability.
///
/// The credential the second endpoint mints is the one DESIGN.md 3.6 describes
/// and apps/api/src/credentials.ts signs and verifies. This module owns only
/// how it is earned: a Selfie Check that World confirmed, rather than the
/// labelled interim issuer in apps/api/src/routes/ops.ts.

export const worldRoutes: FastifyPluginAsync<{ services: Services }> = async (app, options) => {
  const { services } = options;
  const world = services.config.world;

  /**
   * How the Mini App surface is entered.
   *
   * The Mini App id lives here with the rest of the World configuration, so the
   * web app holds none of its own and one answer serves a QR code, a shared link
   * and a notification's `mini_app_path`. Free and unauthenticated: everything in
   * it is public the moment a link is shared.
   *
   * `group` names the occupation the index entry opens, and defaults to the
   * group the first configured series covers, which is the one with cover behind
   * it.
   */
  app.get<{ Querystring: { group?: string } }>('/v1/world/mini-app', async (request, reply) => {
    if (world.miniAppId === '') throw noMiniApp();
    const groupKey = request.query.group ?? services.config.series[0]?.groupKey ?? '';
    const group = groupKey === '' ? null : await services.repository.group(groupKey);
    if (group === null) {
      throw new AppError(
        400,
        'group_unknown',
        'Unknown occupation',
        'That is not one of the fifteen occupation groups this index covers.',
      );
    }
    const series = seriesForGroup(services.config, groupKey);
    const entry = miniAppEntry(world.miniAppId, occupationIndexPath(groupKey));
    return reply.send({
      app_id: world.miniAppId,
      launch_url: miniAppLaunchUrl(world.miniAppId),
      occupation_index: {
        group: groupKey,
        label: group.label,
        series_id: series?.label ?? null,
        path: entry.path,
        url: entry.url,
        mini_app_path: entry.miniAppPath,
      },
    });
  });

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
    const purpose = purposeOf(body['purpose']);
    // The signal is the wallet at purchase and the policy id at claim, and it
    // is read from the body only so that the widget and the verify step agree
    // about it. The verify step recomputes it from what it looked up, never
    // from what it was told, which is what makes the check a check.
    const signal =
      purpose === 'claim'
        ? requiredString(body['policy_id'], 'policy_id')
        : requiredString(body['wallet'], 'wallet');
    const context = signed(services, purpose, signal);
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
    if (purposeOf(body['purpose']) === 'claim') return await verifyClaim(services, request, reply);
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
      ...checkLogging(request),
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

  /**
   * Signing in: the same check, and the cover it finds.
   *
   * Nothing about how a proof is made or checked changes here. It is
   * `verifySelfieCheck` with `purpose: 'purchase'`, the same signed context the
   * purchase step asks for, the same signal, the same preset. What is different
   * is what happens afterwards: no credential is issued, nothing is written,
   * and the answer is the cover already bound to the nullifier the proof
   * carried.
   *
   * The purchase action rather than an action of its own, and the backlog says
   * the opposite. The nullifier is scoped by the action, so a third registered
   * action would return a number that matched no purchase and would find no
   * cover, which makes signing in impossible rather than merely different. The
   * acceptance is that this route finds exactly the cover bound to that person,
   * so it runs the action that bound it. Recorded in docs/DECISIONS.md.
   *
   * A person with no cover is a 200 with `cover: null`, not a 404. They proved
   * who they are and the honest answer is that there is nothing here yet, which
   * is an empty screen rather than an error.
   *
   * https://docs.world.org/world-id/idkit/reference
   */
  app.post<{ Body: Record<string, unknown> }>('/v1/world/sign-in', async (request, reply) => {
    const body = request.body ?? {};
    const wallet = requiredString(body['wallet'], 'wallet');
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

    // Exactly the covers bound to this nullifier, newest first, and never
    // another: the lookup takes the number out of the proof and nothing the
    // caller supplied. The newest is the one a dashboard opens on.
    const held = await services.repository.policiesForPerson(verification.nullifier);
    const policy = held[0];
    return reply.send({
      cover: policy === undefined ? null : await coverView(services, policy),
      covers_held: held.length,
    });
  });
};

/**
 * The two log seams `verifySelfieCheck` offers, wired to this request's logger.
 *
 * Until T42 a refused check left a request going in, a 403 coming out and
 * nothing at all in between, so the reason a person was turned away lived only
 * in the response body they could not read. Both lines are warn, both are found
 * by the request id the logger already stamps on every line, and neither
 * carries the proof, the nullifier, the signal or the wallet: what refused and
 * what this deployment expected are configuration, and configuration is the
 * whole of what a diagnosis needs.
 */
function checkLogging(request: FastifyRequest): Pick<VerifyInput, 'onWorldError' | 'onRefused'> {
  return {
    onWorldError: (worldBody, status) =>
      request.log?.warn(
        { status, code: worldBody.code, detail: worldBody.detail, attribute: worldBody.attribute },
        'World refused a proof',
      ),
    onRefused: (refusal) =>
      request.log?.warn(
        { check: refusal.check, code: refusal.code, reason: refusal.reason },
        'a World check was refused',
      ),
  };
}

/**
 * The claim's identity leg. DESIGN.md 3.9 item 1.
 *
 * A fresh Selfie Check with `require_user_presence`, on the claim action, with
 * the policy id as the signal, "whose nullifier matches the purchase". The
 * presence and the signal are checked inside `verifySelfieCheck`; the nullifier
 * comparison is here, because only this module knows which policy was named.
 *
 * What "matches the purchase" can mean depends on how the deployment is
 * configured, and both regimes are honest as long as the response says which
 * one it is. With one registered action the nullifier is the same number and
 * the comparison is exact. With two, it is a different number for the same
 * person by definition, the comparison cannot be made, and what is left is
 * "both were live people and the claimant controls the wallet": the wallet
 * signs the attestation, and the claim's own nullifier still enforces one claim
 * per person per series on its own key. See docs/DECISIONS.md, T11.
 */
async function verifyClaim(
  services: Services,
  request: FastifyRequest<{ Body: Record<string, unknown> }>,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const world = services.config.world;
  const body = request.body ?? {};
  const policyId = requiredString(body['policy_id'], 'policy_id');
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
  const policy = await services.repository.policy(policyId);
  if (policy === null) {
    throw new AppError(404, 'policy_not_found', 'Policy not found', 'No cover with that id.');
  }
  if (!world.enabled) throw notConfigured();

  const verification = await verifySelfieCheck({
    world,
    purpose: 'claim',
    signal: policy.policyId,
    result: result as IdKitResult,
    ...checkLogging(request),
  });

  const continuity = continuityHolds(world);
  if (continuity && verification.nullifier !== policy.nullifier) {
    // A security event, not a user error: a valid proof from the wrong person.
    request.log?.warn(
      { policy_id: policy.policyId },
      'a claim check returned a different person from the one who bought the cover',
    );
    throw new AppError(
      403,
      'world_nullifier_mismatch',
      "This isn't the World ID that bought this cover",
      'Sign in to World ID with the account you used when you bought it.',
    );
  }

  const issued = await services.issuer.issueClaim({
    nullifier: verification.nullifier,
    policy_id: policy.policyId,
    series_id: policy.seriesId,
    group: policy.groupKey,
    wallet: policy.wallet,
    wallet_evm: policy.walletEvm,
    scope: 'claim',
    world: {
      action: verification.action,
      environment: verification.environment,
      credential: verification.credential,
      verified_at: verification.verifiedAt,
      presence: verification.presence,
    },
  });
  await services.repository.insertCredential({
    jti: issued.jti,
    kind: 'claim',
    nullifier: policy.nullifier,
    seriesId: policy.seriesId,
    groupKey: policy.groupKey,
    policyId: policy.policyId,
    wallet: policy.wallet,
    walletEvm: policy.walletEvm,
    presence: verification.presence,
    issuer: 'world',
    issuedAt: issued.issuedAt.toISOString(),
    expiresAt: issued.expiresAt.toISOString(),
    consumedAt: null,
  });

  return reply.status(201).send({
    claim_credential: issued.token,
    jti: issued.jti,
    policy_id: policy.policyId,
    series_id: policy.seriesId,
    group: policy.groupKey,
    expires_at: rfc3339(issued.expiresAt),
    issuer: 'world',
    world: {
      environment: verification.environment,
      credential: verification.credential,
      protocol_version: verification.protocolVersion,
      presence: verification.presence,
      action: verification.action,
      continuity,
    },
  });
}

function purposeOf(value: unknown): WorldPurpose {
  if (value === undefined || value === null || value === 'purchase') return 'purchase';
  if (value === 'claim') return 'claim';
  throw new AppError(
    400,
    'validation_failed',
    'Validation failed',
    'purpose is purchase or claim.',
    [{ path: 'body.purpose', message: 'expected purchase or claim' }],
  );
}

function signed(services: Services, purpose: WorldPurpose, signal: string) {
  try {
    return requestContext(services.config.world, purpose, signal);
  } catch (error) {
    if (error instanceof WorldNotConfigured) throw notConfigured();
    throw error;
  }
}

function noMiniApp(): AppError {
  return new AppError(
    503,
    'world_mini_app_not_configured',
    'This deployment has no Mini App',
    'Set WORLD_MINI_APP_ID to the Developer Portal Mini App this web app is published as.',
  );
}

function notConfigured(): AppError {
  return new AppError(
    503,
    'world_not_configured',
    'The check is not configured',
    'This deployment has no World ID app id and RP signing key, so it cannot run a Selfie Check.',
  );
}
