import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { hashSignal } from '@worldcoin/idkit-core/hashing';

import { buildTestServer, POLICYHOLDER_1, type TestHarness } from './policy-fixtures.js';

/// POST /v1/world/rp-context and POST /v1/world/verify, through Fastify's own
/// injector. World's endpoint is the one thing stubbed, with the body its
/// reference publishes; everything else is the real handler, the real signer
/// and the real credential issuer.

const NULLIFIER_HEX = '0x2bf8406809dcefb1486dadc96c0a897db9bab002053054cf64272db512c6fbd8';
const NULLIFIER_DECIMAL =
  '19888075077784840540223737223137982910975806272286153757503062117164780026840';

function idKitResult(overrides: Record<string, unknown> = {}) {
  return {
    protocol_version: '3.0',
    nonce: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    action: 'occupation-cover-eligibility',
    environment: 'staging',
    responses: [
      {
        identifier: 'selfie',
        signal_hash: hashSignal(POLICYHOLDER_1.accountId),
        proof: '0x1a2b3c',
        merkle_root: '0x0abc123',
        nullifier: NULLIFIER_HEX,
      },
    ],
    user_presence_completed: false,
    ...overrides,
  };
}

/** World, confirming the proof. The shape is the documented success body. */
function worldConfirms(nullifier = NULLIFIER_HEX) {
  // A fresh Response per call: a body can only be read once, and the second
  // check in this file is the whole point of the file.
  return vi.spyOn(globalThis, 'fetch').mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          success: true,
          action: 'occupation-cover-eligibility',
          nullifier,
          created_at: '2026-09-05T11:20:39.530041+00:00',
          environment: 'staging',
          results: [{ identifier: 'selfie', success: true, nullifier }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
  );
}

/**
 * Every line the server's own logger writes, taken at the stream so that what
 * is asserted is the JSON that would reach journalctl, redaction and all,
 * rather than the arguments a call was made with.
 */
function captureLog(app: FastifyInstance): string[] {
  const lines: string[] = [];
  const logger = app.log as unknown as Record<symbol, { write: (chunk: string) => void }>;
  // The destination the logger and every child of it write through. Pino keeps
  // it on a symbol of its own rather than a name, and a request's logger is a
  // child, so this is the one point both are visible from.
  const stream = Object.getOwnPropertySymbols(logger).find(
    (symbol) => symbol.description === 'pino.stream',
  );
  if (stream === undefined) throw new Error('the logger has no stream to read');
  vi.spyOn(logger[stream], 'write').mockImplementation((chunk: string) => {
    lines.push(chunk);
  });
  return lines;
}

describe('the World endpoints', () => {
  let app: FastifyInstance | null = null;

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await app?.close();
    app = null;
  });

  async function harness(): Promise<TestHarness & { app: FastifyInstance }> {
    const built = await buildTestServer();
    app = built.app;
    return built;
  }

  function verify(built: TestHarness & { app: FastifyInstance }, result: unknown) {
    return built.app.inject({
      method: 'POST',
      url: '/v1/world/verify',
      payload: {
        group: 'computer_math',
        wallet: POLICYHOLDER_1.accountId,
        wallet_evm: POLICYHOLDER_1.address,
        result,
      },
    });
  }

  describe('POST /v1/world/rp-context', () => {
    it('returns the snake_case object IDKit takes, with the widget configuration', async () => {
      const built = await harness();
      const response = await built.app.inject({
        method: 'POST',
        url: '/v1/world/rp-context',
        payload: { wallet: POLICYHOLDER_1.accountId },
      });
      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(Object.keys(body).sort()).toEqual(
        [
          'action',
          'app_id',
          'created_at',
          'environment',
          'expires_at',
          'nonce',
          'preset',
          'require_user_presence',
          'rp_id',
          'signal',
          'signature',
        ].sort(),
      );
      expect(body.rp_id).toBe('rp_d6ae9b4ff2018a15');
      expect(body.app_id).toBe('app_8569aa8d1bbfb24b1243e86d4fc34adc');
      expect(body.action).toBe('occupation-cover-eligibility');
      expect(body.preset).toBe('selfieCheckLegacy');
      expect(body.environment).toBe('staging');
      expect(body.signal).toBe(POLICYHOLDER_1.accountId);
      expect(body.require_user_presence).toBe(false);
      expect(body.expires_at - body.created_at).toBe(300);
      expect(body.signature).toMatch(/^0x[0-9a-f]{130}$/);
    });

    it('never repeats a nonce, because World refuses one twice', async () => {
      const built = await harness();
      const first = await built.app.inject({
        method: 'POST',
        url: '/v1/world/rp-context',
        payload: { wallet: POLICYHOLDER_1.accountId },
      });
      const second = await built.app.inject({
        method: 'POST',
        url: '/v1/world/rp-context',
        payload: { wallet: POLICYHOLDER_1.accountId },
      });
      expect(first.json().nonce).not.toBe(second.json().nonce);
    });

    it('does not sign a context for a purchase with no wallet to bind it to', async () => {
      const built = await harness();
      const response = await built.app.inject({
        method: 'POST',
        url: '/v1/world/rp-context',
        payload: {},
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe('POST /v1/world/verify', () => {
    it('forwards the result to World and issues the eligibility credential', async () => {
      const built = await harness();
      const fetched = worldConfirms();
      const response = await verify(built, idKitResult());

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.issuer).toBe('world');
      expect(body.series_id).toBe('ODI-COMP-2026-01');
      expect(body.world).toEqual({
        environment: 'staging',
        credential: 'selfie',
        protocol_version: '3.0',
        presence: false,
      });
      expect(fetched).toHaveBeenCalledTimes(1);
      expect(fetched.mock.calls[0]?.[0]).toBe(
        'https://developer.world.org/api/v4/verify/rp_d6ae9b4ff2018a15',
      );
    });

    it('puts the nullifier in the credential as a decimal integer, never hex', async () => {
      const built = await harness();
      worldConfirms();
      const body = (await verify(built, idKitResult())).json();
      const credential = await built.services.issuer.verify(body.eligibility);
      expect(credential.nullifier).toBe(NULLIFIER_DECIMAL);
      expect(credential.world.action).toBe('occupation-cover-eligibility');
      expect(credential.world.environment).toBe('staging');
      expect(credential.world.credential).toBe('selfie');
      expect(credential.world.presence).toBe(false);
      expect(credential.expiresAt - credential.issuedAt).toBe(1800);
    });

    it('records the credential against the World issuer, so a bind can find it', async () => {
      const built = await harness();
      worldConfirms();
      const body = (await verify(built, idKitResult())).json();
      const stored = await built.repository.credential(body.jti);
      expect(stored?.issuer).toBe('world');
      expect(stored?.nullifier).toBe(NULLIFIER_DECIMAL);
      expect(stored?.consumedAt).toBeNull();
    });

    /**
     * The signal is the wallet the credential is issued to and is never taken
     * from the body, so a proof bound to another wallet cannot be presented
     * here with that wallet named beside it.
     */
    it('refuses a proof bound to a different wallet', async () => {
      const built = await harness();
      worldConfirms();
      const response = await verify(
        built,
        idKitResult({
          responses: [
            {
              identifier: 'selfie',
              signal_hash: hashSignal('0.0.99999'),
              nullifier: NULLIFIER_HEX,
            },
          ],
        }),
      );
      expect(response.statusCode).toBe(403);
      expect(response.json().code).toBe('world_signal_mismatch');
    });

    it('answers a refusal from World without issuing anything', async () => {
      const built = await harness();
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(
          JSON.stringify({
            success: false,
            code: 'all_verifications_failed',
            detail: 'All proof verifications failed.',
            results: [{ identifier: 'selfie', success: false, code: 'verification_error' }],
          }),
          { status: 400, headers: { 'content-type': 'application/json' } },
        ),
      );
      const response = await verify(built, idKitResult());
      expect(response.statusCode).toBe(403);
      expect(response.json().code).toBe('world_verification_failed');
    });

    it('refuses an occupation with no series behind it before it calls World', async () => {
      const built = await harness();
      const fetched = worldConfirms();
      const response = await built.app.inject({
        method: 'POST',
        url: '/v1/world/verify',
        payload: {
          group: 'legal',
          wallet: POLICYHOLDER_1.accountId,
          wallet_evm: POLICYHOLDER_1.address,
          result: idKitResult(),
        },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json().code).toBe('no_capacity_for_group');
      expect(fetched).not.toHaveBeenCalled();
    });

    /**
     * The line this ticket exists for. A refused check used to leave a request
     * in the log, a 403 out and nothing to say why, so a diagnosis meant
     * reading the source. The reason is now on a warn line beside the request
     * id, and the proof, the nullifier and the wallet are all absent from it.
     */
    it('logs why a check was refused, with nothing about the person on the line', async () => {
      // The suite runs the server silent, because a line per request is noise.
      // This one test wants the lines, so it builds a server that writes them.
      vi.stubEnv('LOG_LEVEL', 'warn');
      const built = await harness();
      worldConfirms();
      const lines = captureLog(built.app);
      const response = await verify(
        built,
        idKitResult({
          responses: [
            {
              identifier: 'orb',
              signal_hash: hashSignal(POLICYHOLDER_1.accountId),
              proof: '0x1a2b3c',
              nullifier: NULLIFIER_HEX,
            },
          ],
        }),
      );
      expect(response.statusCode).toBe(403);
      expect(response.json().code).toBe('world_credential_unaccepted');

      const written = lines.find((line) => line.includes('a World check was refused'));
      expect(written).toBeDefined();
      const line = JSON.parse(written ?? '{}');
      expect(line.level).toBe(40);
      expect(line.check).toBe('credential');
      expect(line.code).toBe('world_credential_unaccepted');
      expect(line.reason).toBe(
        'The check returned a orb credential and this deployment accepts selfie or face.',
      );
      // The request id is what joins this line to the 403 the person saw, and
      // it is the whole of the context the line needs.
      expect(line.reqId).toBe(response.json().request_id);
      expect(written).not.toContain(NULLIFIER_HEX);
      expect(written).not.toContain(POLICYHOLDER_1.accountId);
      expect(written).not.toContain('0x1a2b3c');
    });

    /**
     * The rule DESIGN.md 3.6 states, taken here rather than only at bind, so a
     * second purchase is refused before anyone is asked to pay for it. The copy
     * is the Verify line from docs/DESIGN-TOKENS.md section 8.
     */
    it('refuses a second cover for the same person in the same series', async () => {
      const built = await harness();
      worldConfirms();

      const quote = (
        await built.app.inject({
          method: 'POST',
          url: '/v1/quote',
          payload: {
            group: 'computer_math',
            limit: '5000000000',
            wallet: POLICYHOLDER_1.accountId,
          },
        })
      ).json();
      const first = (await verify(built, idKitResult())).json();
      const bound = await built.app.inject({
        method: 'POST',
        url: '/v1/bind',
        headers: { authorization: `Bearer ${first.eligibility}` },
        payload: { quote_id: quote.quote_id },
      });
      expect(bound.statusCode).toBe(201);

      const second = await verify(built, idKitResult());
      expect(second.statusCode).toBe(409);
      const body = second.json();
      expect(body.code).toBe('already_covered');
      expect(body.detail).toBe(
        'One person, one cover. This stops bots and duplicate accounts.',
      );
      expect(body.errors?.[0]?.message).toBe(bound.json().policy_id);
    });

    it('lets a different person buy in the same series', async () => {
      const built = await harness();
      worldConfirms();
      const quote = (
        await built.app.inject({
          method: 'POST',
          url: '/v1/quote',
          payload: {
            group: 'computer_math',
            limit: '5000000000',
            wallet: POLICYHOLDER_1.accountId,
          },
        })
      ).json();
      const first = (await verify(built, idKitResult())).json();
      await built.app.inject({
        method: 'POST',
        url: '/v1/bind',
        headers: { authorization: `Bearer ${first.eligibility}` },
        payload: { quote_id: quote.quote_id },
      });

      const otherHex = '0x1111406809dcefb1486dadc96c0a897db9bab002053054cf64272db512c6fbd8';
      worldConfirms(otherHex);
      const second = await verify(
        built,
        idKitResult({
          responses: [
            {
              identifier: 'selfie',
              signal_hash: hashSignal(POLICYHOLDER_1.accountId),
              nullifier: otherHex,
            },
          ],
        }),
      );
      expect(second.statusCode).toBe(201);
    });
  });
});
