import { describe, expect, it, afterEach, vi } from 'vitest';

import { computeRpSignatureMessage, signRequest } from '@worldcoin/idkit-core/signing';
import { hashSignal } from '@worldcoin/idkit-core/hashing';

import { signRpContext, WorldNotConfigured } from '../src/world/rp-context.js';
import type { WorldConfig } from '../src/world/config.js';

/**
 * The RP signature, against the vectors World publishes.
 *
 * When the World App refuses a request it says `invalid_rp_signature` and names
 * none of the four inputs that went into the message. These vectors turn that
 * whole class of failure into a test that runs without a phone, a Portal
 * account or a network: if they pass, a live rejection is the action string or
 * the clock, and nothing else.
 *
 * The signing helper reads its randomness and its clock from the two globals
 * rather than from its parameters, so both are stubbed here. That is the only
 * trick in the file.
 *
 * Vectors: https://docs.world.org/world-id/idkit/signatures
 */

const SIGNING_KEY = '0xabababababababababababababababababababababababababababababababab';
const NONCE = '0x008ae1aa597fa146ebd3aa2ceddf360668dea5e526567e92b0321816a4e895bd';
const CREATED_AT = 1_700_000_000;
const EXPIRES_AT = 1_700_000_300;
const MESSAGE_49 =
  '0x01008ae1aa597fa146ebd3aa2ceddf360668dea5e526567e92b0321816a4e895bd' +
  '000000006553f100000000006553f22c';
const ACTION_TAIL = '00aa0ce59768ae5b1c52f07a9387f14f09f277422c0d2f8a268c7bad0c60a46a';
const SIG_49 =
  '0x14f693175773aed912852a601e9c0fd30f2afe2738d31388316232ce6f64ae9e' +
  '4edbfb19d81c4229ba9c9fca78ede4b28956b7ba4415f08d957cbc1b3bdaa4021b';
const SIG_81 =
  '0x05594adb6c1495768a38d523d7d6ee6356b2c31231919198794ed022ade7d08f' +
  '73753f83bd167067d99c9b969d28e9222315837c66af25867b041273a6d5056f1b';

function hex(bytes: Uint8Array): string {
  return `0x${Buffer.from(bytes).toString('hex')}`;
}

function bytes(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value.replace(/^0x/, ''), 'hex'));
}

/** The two seams the helper does not take as parameters. */
function freeze(randomByte: (index: number) => number = (index) => index): void {
  vi.spyOn(Date, 'now').mockReturnValue(CREATED_AT * 1000);
  vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(((array: Uint8Array) => {
    for (let index = 0; index < array.length; index += 1) array[index] = randomByte(index);
    return array;
  }) as typeof globalThis.crypto.getRandomValues);
}

function world(overrides: Partial<WorldConfig> = {}): WorldConfig {
  return {
    appId: 'app_8569aa8d1bbfb24b1243e86d4fc34adc',
    rpId: 'rp_d6ae9b4ff2018a15',
    verifyId: 'rp_d6ae9b4ff2018a15',
    verifyUrl: 'https://developer.world.org/api/v4/verify',
    signingKey: SIGNING_KEY,
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

afterEach(() => {
  vi.restoreAllMocks();
});

describe('hash_to_field', () => {
  it('matches the four published vectors', () => {
    expect(hashSignal('')).toBe(
      '0x00c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a4',
    );
    expect(hashSignal('test_signal')).toBe(
      '0x00c1636e0a961a3045054c4d61374422c31a95846b8442f0927ad2ff1d6112ed',
    );
    expect(hashSignal('hello')).toBe(
      '0x001c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36dea',
    );
    expect(hashSignal(Uint8Array.from([1, 2, 3]))).toBe(
      '0x00f1885eda54b7a053318cd41e2093220dab15d65381b1157a3633a83bfd5c92',
    );
  });

  /**
   * A 0x-prefixed string is hashed as the bytes it spells, not as its
   * characters. Our purchase signal is a Hedera account id like `0.0.10366453`
   * and is hashed as text, but an EVM address passed to the same helper would
   * take the other path, so the two must never be used interchangeably.
   */
  it('hashes a 0x-prefixed string as bytes', () => {
    expect(hashSignal('0x010203')).toBe(hashSignal(Uint8Array.from([1, 2, 3])));
  });

  it('always leaves a leading zero byte, because the field element is shifted', () => {
    for (const signal of ['', 'hello', '0.0.10366453', 'policy_01K4']) {
      expect(hashSignal(signal).startsWith('0x00')).toBe(true);
    }
  });
});

describe('the signed message', () => {
  it('is the published 49 bytes without an action', () => {
    const message = computeRpSignatureMessage(bytes(NONCE), CREATED_AT, EXPIRES_AT);
    expect(message).toHaveLength(49);
    expect(message[0]).toBe(1);
    expect(hex(message)).toBe(MESSAGE_49);
  });

  it('appends the action as a field element, making 81 bytes', () => {
    const message = computeRpSignatureMessage(
      bytes(NONCE),
      CREATED_AT,
      EXPIRES_AT,
      'test-action',
    );
    expect(message).toHaveLength(81);
    expect(hex(message)).toBe(`${MESSAGE_49}${ACTION_TAIL}`);
  });

  /**
   * The trap this file exists for. A trailing space in an action string is
   * invisible in a `.env` file and produces a signature the World App refuses
   * without saying which input was wrong.
   */
  it('changes its last 32 bytes when the action string changes by one character', () => {
    const clean = computeRpSignatureMessage(bytes(NONCE), CREATED_AT, EXPIRES_AT, 'occupation-cover');
    const spaced = computeRpSignatureMessage(
      bytes(NONCE),
      CREATED_AT,
      EXPIRES_AT,
      'occupation-cover ',
    );
    expect(hex(clean.slice(49))).toBe(
      '0x00c2dc53588d7c913d6a688e33749684daa3bd4e24f17c43f81af80225d7df8b',
    );
    expect(hex(spaced.slice(49))).not.toBe(hex(clean.slice(49)));
  });
});

describe('signRequest', () => {
  it('reproduces the published signature without an action', () => {
    freeze();
    const signed = signRequest({ signingKeyHex: SIGNING_KEY, ttl: 300 });
    expect(signed).toEqual({
      sig: SIG_49,
      nonce: NONCE,
      createdAt: CREATED_AT,
      expiresAt: EXPIRES_AT,
    });
  });

  it('reproduces the published signature for the action case', () => {
    freeze();
    const signed = signRequest({ signingKeyHex: SIGNING_KEY, action: 'test-action', ttl: 300 });
    expect(signed.sig).toBe(SIG_81);
  });

  it('takes the key with or without the 0x prefix', () => {
    freeze();
    const prefixed = signRequest({ signingKeyHex: SIGNING_KEY, ttl: 300 });
    freeze();
    const bare = signRequest({ signingKeyHex: SIGNING_KEY.slice(2), ttl: 300 });
    expect(bare.sig).toBe(prefixed.sig);
  });
});

describe('signRpContext', () => {
  it('maps the helper onto the snake_case object IDKit takes', () => {
    freeze();
    expect(signRpContext(world(), 'test-action')).toEqual({
      rp_id: 'rp_d6ae9b4ff2018a15',
      nonce: NONCE,
      created_at: CREATED_AT,
      expires_at: EXPIRES_AT,
      signature: SIG_81,
    });
  });

  it('gives every request a fresh nonce and a fresh signature', () => {
    const first = signRpContext(world(), 'occupation-cover-eligibility');
    const second = signRpContext(world(), 'occupation-cover-eligibility');
    expect(first.nonce).not.toBe(second.nonce);
    expect(first.signature).not.toBe(second.signature);
    expect(first.nonce).toMatch(/^0x00[0-9a-f]{62}$/);
    expect(first.signature).toMatch(/^0x[0-9a-f]{128}(1b|1c)$/);
  });

  it('spends exactly the configured ttl and stamps the wall clock', () => {
    const signed = signRpContext(world({ rpContextTtlSeconds: 600 }), 'occupation-cover-claim');
    expect(signed.expires_at - signed.created_at).toBe(600);
    expect(Math.abs(signed.created_at - Math.floor(Date.now() / 1000))).toBeLessThanOrEqual(2);
  });

  it('falls back to the app id when no rp id is registered', () => {
    expect(signRpContext(world({ rpId: '' }), 'occupation-cover-eligibility').rp_id).toBe(
      'app_8569aa8d1bbfb24b1243e86d4fc34adc',
    );
  });

  it('refuses to sign without a key rather than signing with a placeholder', () => {
    expect(() => signRpContext(world({ signingKey: undefined }), 'a')).toThrow(WorldNotConfigured);
  });
});
