import type { FastifyPluginAsync, RouteHandlerMethod } from 'fastify';

import { seriesForGroup } from '../config.js';
import type { CredentialRow } from '../db/types.js';
import { AppError } from '../errors.js';
import { readReplayState, type ReplayState } from '../replay/state.js';
import type { Services } from '../services.js';
import { rfc3339 } from '../views.js';
import { continuityHolds } from '../world/config.js';
import { signerMatches } from '../world/rp-context.js';
import { requiredString } from './quote.js';

/// Health, the JWKS, and the interim eligibility issuer.
///
/// `GET /health` returns the git SHA because MISSION's definition of done names
/// it, so it is a submission artefact rather than plumbing. The SHA comes from
/// an environment variable set at build time, never from running git at request
/// time. It also carries the oracle's run state, so one call to one path tells
/// a judge which commit is deployed and whether the demo clock is walking.
///
/// `GET /healthz` is the same handler under its older path. It shipped first
/// and the README, the deploy script and the T11 signer check all name it, so
/// it stays as an alias rather than being moved. See docs/DECISIONS.md.
///
/// Both paths sit outside `/v1/index/`, which the x402 gate meters, so an
/// uptime check never has to pay to find out whether the site is up.
///
/// The replay state is read with `readReplayState`, the reader
/// apps/api/src/replay/state.ts exports for exactly this. Health never calls
/// `GET /v1/replay`: a process that reaches itself over HTTP to answer a health
/// check reports the proxy's health, not its own.

export interface OpsPluginOptions {
  services: Services;
  /** Injected in tests, so a route test needs no state file on disk. */
  readReplay?: () => ReplayState;
}

export const opsRoutes: FastifyPluginAsync<OpsPluginOptions> = async (app, options) => {
  const { services } = options;
  const readReplay = options.readReplay ?? ((): ReplayState => readReplayState());

  const health: RouteHandlerMethod = async (_request, reply) => {
    let database = 'ok';
    try {
      await services.repository.groups();
    } catch {
      database = 'unreachable';
    }
    return reply.status(database === 'ok' ? 200 : 503).send({
      status: database === 'ok' ? 'ok' : 'degraded',
      sha: services.gitSha,
      network: services.config.network,
      time: rfc3339(new Date()),
      started_at: rfc3339(services.startedAt),
      deps: {
        db: database,
        hedera: services.hedera === null ? 'not_configured' : 'ok',
        index: services.indexData === null ? 'not_loaded' : 'ok',
        world: services.config.world.enabled ? 'ok' : 'not_configured',
      },
      // The oracle's run state, exactly as GET /v1/replay serves it minus the
      // badge, which is a screen's business and not an operator's. A clone that
      // has never run the oracle reads as live and idle rather than as an error.
      replay: readReplay(),
      // Which credential this deployment asks for and in which environment.
      // The preset is configuration because the Selfie Check feature flag is
      // granted per app by a human, so a rung change is a `.env` edit, and a
      // judge should be able to read which rung is running without a redeploy.
      // No secret is here: the app id and the rp id are public request values.
      world: {
        app_id: services.config.world.appId,
        rp_id: services.config.world.rpId,
        environment: services.config.world.environment,
        preset: services.config.world.preset,
        action_eligibility: services.config.world.actionEligibility,
        action_claim: services.config.world.actionClaim,
        continuity: continuityHolds(services.config.world),
        signer_matches: signerMatches(services.config.world),
      },
    });
  };

  app.get('/health', health);
  app.get('/healthz', health);

  /// The public half of the credential signing key. Public material only: the
  /// document is built from the exported public JWK, and a test asserts the
  /// serialised body carries no `d`.
  app.get('/.well-known/jwks.json', async (_request, reply) =>
    reply.header('cache-control', 'public, max-age=300').send(services.issuer.jwks()),
  );

  if (!services.config.demoIssuer) return;

  /**
   * POST /v1/demo/eligibility
   *
   * The interim eligibility issuer. POST /v1/world/verify is the real one: it
   * forwards a completed Selfie Check to World and issues the same credential
   * on the strength of it. This one stays for the testnet bind script and the
   * Steward, which have no World App and no camera. It is labelled in its own
   * response, it is not in the Bazantic gateway's six operations, and it is
   * turned off by setting DEMO_ELIGIBILITY_ISSUER to false. See
   * docs/DECISIONS.md, "The interim eligibility issuer".
   */
  app.post<{ Body: Record<string, unknown> }>('/v1/demo/eligibility', async (request, reply) => {
    const body = request.body ?? {};
    const groupKey = requiredString(body['group'], 'group');
    const wallet = requiredString(body['wallet'], 'wallet');
    const walletEvm = requiredString(body['wallet_evm'], 'wallet_evm');
    const nullifier = requiredString(body['nullifier'], 'nullifier');
    if (!/^\d+$/.test(nullifier)) {
      throw new AppError(
        400,
        'validation_failed',
        'Validation failed',
        'A nullifier is a decimal integer string, never hex.',
        [{ path: 'body.nullifier', message: 'expected decimal digits' }],
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

    const issued = await services.issuer.issue({
      nullifier,
      group: groupKey,
      series_id: series.label,
      wallet,
      wallet_evm: walletEvm,
      scope: 'bind',
      world: {
        action: 'occupation-cover-eligibility',
        environment: 'demo',
        credential: 'demo-issuer',
        verified_at: Math.floor(Date.now() / 1000),
        presence: false,
      },
    });

    await services.repository.upsertUser({
      nullifier,
      groupKey,
      wallet,
      walletEvm,
    });
    const row: CredentialRow = {
      jti: issued.jti,
      kind: 'eligibility',
      nullifier,
      seriesId: series.label,
      groupKey,
      policyId: null,
      wallet,
      walletEvm,
      presence: false,
      issuer: 'demo',
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
      issuer: 'demo',
      warning:
        'Issued without a World Selfie Check. Demo only. The real issuer is POST /v1/world/verify.',
    });
  });
};
