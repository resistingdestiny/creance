import { describe, expect, it, vi } from 'vitest';

import { hashSignal } from '@worldcoin/idkit-core/hashing';

import { AppError } from '../src/errors.js';
import type { WorldConfig } from '../src/world/config.js';
import {
  decimalNullifier,
  verifySelfieCheck,
  type FetchLike,
  type IdKitResult,
  type VerifyInput,
  type WorldCheckName,
} from '../src/world/verify.js';

/**
 * The five checks the API owns, one test each.
 *
 * World's endpoint says a proof is cryptographically valid. It does not say the
 * proof was made for this purchase, in this environment, for this action, with
 * this credential, or with a fresh liveness check. Each of those is asserted
 * here against a recorded result and a recorded response, because every one of
 * them is a rejection a valid proof would otherwise pass.
 *
 * The result object is the documented 3.0 shape from the integration guide. The
 * success body is the one the verify reference publishes, with our own ids.
 */

const WALLET = '0.0.10366453';
const NULLIFIER_HEX = '0x2bf8406809dcefb1486dadc96c0a897db9bab002053054cf64272db512c6fbd8';
const NULLIFIER_DECIMAL =
  '19888075077784840540223737223137982910975806272286153757503062117164780026840';

function world(overrides: Partial<WorldConfig> = {}): WorldConfig {
  return {
    appId: 'app_8569aa8d1bbfb24b1243e86d4fc34adc',
    miniAppId: '',
    rpId: 'rp_d6ae9b4ff2018a15',
    verifyId: 'rp_d6ae9b4ff2018a15',
    verifyUrl: 'https://developer.world.org/api/v4/verify',
    signingKey: `0x${'ab'.repeat(32)}`,
    signerAddress: '',
    actionEligibility: 'occupation-cover-eligibility',
    actionClaim: 'occupation-cover-claim',
    environment: 'staging',
    preset: 'selfieCheckLegacy',
    identifiers: ['selfie', 'face'],
    rpContextTtlSeconds: 300,
    enabled: true,
    ...overrides,
  };
}

function idKitResult(overrides: Partial<IdKitResult> = {}): IdKitResult {
  return {
    protocol_version: '3.0',
    nonce: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    action: 'occupation-cover-eligibility',
    environment: 'staging',
    responses: [
      {
        identifier: 'selfie',
        signal_hash: hashSignal(WALLET),
        proof: '0x1a2b3c',
        merkle_root: '0x0abc123',
        nullifier: NULLIFIER_HEX,
      },
    ],
    user_presence_completed: false,
    ...overrides,
  };
}

function answers(status: number, body: unknown): FetchLike {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

function verified(): FetchLike {
  return answers(200, {
    success: true,
    action: 'occupation-cover-eligibility',
    nullifier: NULLIFIER_HEX,
    created_at: '2026-09-05T11:20:39.530041+00:00',
    environment: 'staging',
    results: [{ identifier: 'selfie', success: true, nullifier: NULLIFIER_HEX }],
  });
}

async function refusal(input: Parameters<typeof verifySelfieCheck>[0]): Promise<AppError> {
  try {
    await verifySelfieCheck(input);
  } catch (error) {
    return error as AppError;
  }
  throw new Error('the check was accepted when it should have been refused');
}

describe('verifySelfieCheck', () => {
  it('forwards the result byte for byte to the id in the path', async () => {
    const fetchImpl = verified();
    const result = idKitResult();
    await verifySelfieCheck({ world: world(), purpose: 'purchase', signal: WALLET, result, fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://developer.world.org/api/v4/verify/rp_d6ae9b4ff2018a15');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual(result);
    expect(init.headers).toEqual({ 'content-type': 'application/json' });
  });

  it('returns the nullifier as a decimal integer string, never hex', async () => {
    const verification = await verifySelfieCheck({
      world: world(),
      purpose: 'purchase',
      signal: WALLET,
      result: idKitResult(),
      fetchImpl: verified(),
    });
    expect(verification.nullifier).toBe(NULLIFIER_DECIMAL);
    expect(verification.credential).toBe('selfie');
    expect(verification.environment).toBe('staging');
    expect(verification.presence).toBe(false);
    expect(verification.protocolVersion).toBe('3.0');
  });

  it('refuses a result carrying anything other than one response', async () => {
    const error = await refusal({
      world: world(),
      purpose: 'purchase',
      signal: WALLET,
      result: idKitResult({ responses: [] }),
      fetchImpl: verified(),
    });
    expect(error.code).toBe('world_result_malformed');
  });

  /**
   * The live 400 bodies for a malformed request carry no `success` field, so a
   * handler that reads `body.success === false` treats one as a verification.
   * Success comes from the status.
   */
  it('reads failure from the status, not from a success field World may omit', async () => {
    const onWorldError = vi.fn();
    const error = await refusal({
      world: world(),
      purpose: 'purchase',
      signal: WALLET,
      result: idKitResult(),
      fetchImpl: answers(400, {
        code: 'validation_error',
        detail: 'action is required for uniqueness proofs',
        attribute: 'action',
      }),
      onWorldError,
    });
    expect(error.code).toBe('world_verification_failed');
    expect(error.issues?.[0]?.message).toContain('validation_error');
    expect(error.issues?.[0]?.message).toContain('(action)');
    expect(onWorldError).toHaveBeenCalledTimes(1);
  });

  it('reports World being unreachable as its own answer', async () => {
    const error = await refusal({
      world: world(),
      purpose: 'purchase',
      signal: WALLET,
      result: idKitResult(),
      fetchImpl: vi.fn(async () => {
        throw new Error('getaddrinfo ENOTFOUND');
      }),
    });
    expect(error.status).toBe(502);
    expect(error.code).toBe('world_unreachable');
  });

  it('refuses a proof made for a different action', async () => {
    const error = await refusal({
      world: world(),
      purpose: 'purchase',
      signal: WALLET,
      result: idKitResult({ action: 'occupation-cover-claim' }),
      fetchImpl: verified(),
    });
    expect(error.code).toBe('world_verification_failed');
  });

  it('refuses a proof made in another environment', async () => {
    const error = await refusal({
      world: world(),
      purpose: 'purchase',
      signal: WALLET,
      result: idKitResult({ environment: 'production' }),
      fetchImpl: verified(),
    });
    expect(error.code).toBe('world_verification_failed');
  });

  /**
   * The replay this check exists for: a genuinely valid proof, issued for
   * somebody else's wallet, presented against this purchase.
   */
  it('refuses a proof bound to another wallet', async () => {
    const error = await refusal({
      world: world(),
      purpose: 'purchase',
      signal: WALLET,
      result: idKitResult({
        responses: [
          {
            identifier: 'selfie',
            signal_hash: hashSignal('0.0.99999'),
            proof: '0x1a2b3c',
            merkle_root: '0x0abc123',
            nullifier: NULLIFIER_HEX,
          },
        ],
      }),
      fetchImpl: verified(),
    });
    expect(error.status).toBe(403);
    expect(error.code).toBe('world_signal_mismatch');
  });

  /**
   * An empty signal hashes to a published constant. If it ever arrives, the
   * request went out without a signal and the proof is bound to nothing.
   */
  it('refuses the hash of the empty signal', async () => {
    const error = await refusal({
      world: world(),
      purpose: 'purchase',
      signal: WALLET,
      result: idKitResult({
        responses: [{ identifier: 'selfie', signal_hash: hashSignal(''), nullifier: NULLIFIER_HEX }],
      }),
      fetchImpl: verified(),
    });
    expect(error.code).toBe('world_signal_mismatch');
  });

  it('accepts the historical face alias for the Selfie Check credential', async () => {
    const verification = await verifySelfieCheck({
      world: world(),
      purpose: 'purchase',
      signal: WALLET,
      result: idKitResult({
        responses: [
          { identifier: 'face', signal_hash: hashSignal(WALLET), nullifier: NULLIFIER_HEX },
        ],
      }),
      fetchImpl: verified(),
    });
    expect(verification.credential).toBe('face');
  });

  it('refuses a credential the configured preset cannot return', async () => {
    const error = await refusal({
      world: world(),
      purpose: 'purchase',
      signal: WALLET,
      result: idKitResult({
        responses: [
          { identifier: 'device', signal_hash: hashSignal(WALLET), nullifier: NULLIFIER_HEX },
        ],
      }),
      fetchImpl: verified(),
    });
    expect(error.code).toBe('world_credential_unaccepted');
    expect(error.message).toBe(
      "That check isn't the one we asked for. Open the World app and run the face check.",
    );
  });

  it('takes presence off the proof at claim rather than trusting the request', async () => {
    const claim = {
      world: world(),
      purpose: 'claim' as const,
      signal: 'policy_01K4ABCDEF',
      fetchImpl: verified(),
    };
    const responses = [
      { identifier: 'selfie', signal_hash: hashSignal(claim.signal), nullifier: NULLIFIER_HEX },
    ];
    const error = await refusal({
      ...claim,
      result: idKitResult({ action: 'occupation-cover-claim', responses }),
    });
    expect(error.code).toBe('world_presence_missing');

    const passed = await verifySelfieCheck({
      ...claim,
      result: idKitResult({
        action: 'occupation-cover-claim',
        responses,
        user_presence_completed: true,
      }),
    });
    expect(passed.presence).toBe(true);
  });

  it('lets a purchase through without presence, which is what it asks for', async () => {
    const verification = await verifySelfieCheck({
      world: world(),
      purpose: 'purchase',
      signal: WALLET,
      result: idKitResult(),
      fetchImpl: verified(),
    });
    expect(verification.presence).toBe(false);
  });
});

/**
 * Every path that refuses, and the single line each of them says why on.
 *
 * The fault this covers is the one Root met: World said verified, the site said
 * try a different device, and the log held a request going in, a 403 coming out
 * and nothing in between. So what is asserted is not that a reason exists but
 * that it is reported exactly once and that it says nothing about the person.
 * The proof, the nullifier, the signal and the wallet are absent from every
 * line below, and the test fails if any of them appears.
 */
describe('what a refusal reports', () => {
  const PROOF = '0x1a2b3c';

  function item(overrides: Record<string, unknown> = {}) {
    return {
      identifier: 'selfie',
      signal_hash: hashSignal(WALLET),
      proof: PROOF,
      merkle_root: '0x0abc123',
      nullifier: NULLIFIER_HEX,
      ...overrides,
    };
  }

  const paths: {
    name: string;
    check: WorldCheckName;
    code: string;
    says: string;
    input: Omit<VerifyInput, 'onRefused'>;
  }[] = [
    {
      name: 'World cannot be reached',
      check: 'transport',
      code: 'world_unreachable',
      says: 'did not complete',
      input: {
        world: world(),
        purpose: 'purchase',
        signal: WALLET,
        result: idKitResult(),
        fetchImpl: vi.fn(async () => {
          throw new Error('getaddrinfo ENOTFOUND');
        }),
      },
    },
    {
      name: 'the result carries more than one response',
      check: 'responses',
      code: 'world_result_malformed',
      says: 'exactly one',
      input: {
        world: world(),
        purpose: 'purchase',
        signal: WALLET,
        result: idKitResult({ responses: [item(), item()] }),
        fetchImpl: verified(),
      },
    },
    {
      name: 'the proof was made for another action',
      check: 'action',
      code: 'world_verification_failed',
      says: 'occupation-cover-eligibility',
      input: {
        world: world(),
        purpose: 'purchase',
        signal: WALLET,
        result: idKitResult({ action: 'occupation-cover-claim' }),
        fetchImpl: verified(),
      },
    },
    {
      name: 'the proof was made in another environment',
      check: 'environment',
      code: 'world_verification_failed',
      says: 'staging',
      input: {
        world: world(),
        purpose: 'purchase',
        signal: WALLET,
        result: idKitResult({ environment: 'production' }),
        fetchImpl: verified(),
      },
    },
    {
      name: 'the proof was bound to another wallet',
      check: 'signal',
      code: 'world_signal_mismatch',
      says: 'different signal',
      input: {
        world: world(),
        purpose: 'purchase',
        signal: WALLET,
        result: idKitResult({ responses: [item({ signal_hash: hashSignal('0.0.99999') })] }),
        fetchImpl: verified(),
      },
    },
    {
      name: 'the check was of a kind this deployment does not accept',
      check: 'credential',
      code: 'world_credential_unaccepted',
      says: 'selfie or face',
      input: {
        world: world(),
        purpose: 'purchase',
        signal: WALLET,
        result: idKitResult({ responses: [item({ identifier: 'orb' })] }),
        fetchImpl: verified(),
      },
    },
    {
      name: 'a claim arrives without a completed liveness check',
      check: 'presence',
      code: 'world_presence_missing',
      says: 'liveness',
      input: {
        world: world(),
        purpose: 'claim',
        signal: WALLET,
        result: idKitResult({
          action: 'occupation-cover-claim',
          responses: [item()],
        }),
        fetchImpl: verified(),
      },
    },
    {
      name: 'the answer names the person with something that is not a number',
      check: 'nullifier',
      code: 'world_verification_failed',
      says: 'not a number',
      input: {
        world: world(),
        purpose: 'purchase',
        signal: WALLET,
        result: idKitResult(),
        fetchImpl: answers(200, {
          success: true,
          action: 'occupation-cover-eligibility',
          nullifier: 'not-a-nullifier',
          environment: 'staging',
        }),
      },
    },
  ];

  for (const path of paths) {
    it(`says once why it refused when ${path.name}`, async () => {
      const onRefused = vi.fn();
      const error = await refusal({ ...path.input, onRefused });

      expect(error.code).toBe(path.code);
      expect(onRefused).toHaveBeenCalledTimes(1);
      const refused = onRefused.mock.calls[0]?.[0] as {
        check: string;
        code: string;
        reason: string;
      };
      expect(refused.check).toBe(path.check);
      expect(refused.code).toBe(path.code);
      expect(refused.reason).toContain(path.says);

      const line = JSON.stringify(refused);
      for (const secret of [PROOF, NULLIFIER_HEX, NULLIFIER_DECIMAL, WALLET, hashSignal(WALLET)]) {
        expect(line).not.toContain(String(secret));
      }
    });
  }

  /**
   * World refusing outright already had a seam of its own, carrying its code,
   * detail and attribute. It keeps it, and does not report twice: one refusal
   * is one line whichever of the two decided it.
   */
  it('leaves World\'s own refusal on the seam that already carried it', async () => {
    const onWorldError = vi.fn();
    const onRefused = vi.fn();
    await refusal({
      world: world(),
      purpose: 'purchase',
      signal: WALLET,
      result: idKitResult(),
      fetchImpl: answers(400, {
        code: 'all_verifications_failed',
        detail: 'All proof verifications failed.',
      }),
      onWorldError,
      onRefused,
    });
    expect(onWorldError).toHaveBeenCalledTimes(1);
    expect(onRefused).not.toHaveBeenCalled();
  });

  it('lets a nullifier that is missing altogether say so', async () => {
    const onRefused = vi.fn();
    const error = await refusal({
      world: world(),
      purpose: 'purchase',
      signal: WALLET,
      result: idKitResult({ responses: [item({ nullifier: undefined })] }),
      fetchImpl: answers(200, {
        success: true,
        action: 'occupation-cover-eligibility',
        environment: 'staging',
      }),
      onRefused,
    });
    expect(error.code).toBe('world_verification_failed');
    expect(onRefused).toHaveBeenCalledTimes(1);
    expect(onRefused.mock.calls[0]?.[0]).toMatchObject({
      check: 'nullifier',
      reason: 'The check returned no identifier for the person.',
    });
  });
});

describe('decimalNullifier', () => {
  it('converts the hex World returns', () => {
    expect(decimalNullifier(NULLIFIER_HEX)).toBe(NULLIFIER_DECIMAL);
  });

  it('reads the same number whatever the casing of the hex', () => {
    expect(decimalNullifier(NULLIFIER_HEX.toUpperCase().replace('0X', '0x'))).toBe(
      NULLIFIER_DECIMAL,
    );
  });

  it('refuses something that is not a number', () => {
    expect(() => decimalNullifier('not-a-nullifier')).toThrow(AppError);
  });
});
