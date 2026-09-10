import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { hashSignal } from '@worldcoin/idkit-core/hashing';

import {
  COVER_KEY_LENGTH,
  coverKeyHash,
  groupCoverKey,
  newCoverKey,
  normaliseCoverKey,
} from '../src/cover-key.js';
import {
  buildTestServer,
  issueCredential,
  POLICYHOLDER_1,
  type TestHarness,
} from './policy-fixtures.js';

/// The two ways back into a cover: the key, and the person.
///
/// Both are driven through Fastify's own injector against the memory
/// repository. World's endpoint is the one thing stubbed, exactly as
/// world-routes.test.ts stubs it, because the nullifier is what the sign in
/// route turns into a cover and a real Selfie Check needs a phone.

const NULLIFIER_HEX = '0x2bf8406809dcefb1486dadc96c0a897db9bab002053054cf64272db512c6fbd8';
const NULLIFIER_DECIMAL =
  '19888075077784840540223737223137982910975806272286153757503062117164780026840';

/** A second person, so "never another" has something to be wrong about. */
const OTHER_NULLIFIER_HEX =
  '0x1000000000000000000000000000000000000000000000000000000000000001';
const OTHER_NULLIFIER_DECIMAL = BigInt(OTHER_NULLIFIER_HEX).toString();

function idKitResult(nullifier = NULLIFIER_HEX) {
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
        nullifier,
      },
    ],
    user_presence_completed: false,
  };
}

function worldConfirms(nullifier = NULLIFIER_HEX) {
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

describe('the cover key', () => {
  it('is twenty characters of Crockford base 32', () => {
    const { key } = newCoverKey();
    expect(key).toHaveLength(COVER_KEY_LENGTH);
    expect(key).toMatch(/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{20}$/);
  });

  it('is a fresh key every time, because it is the only thing stopping a guess', () => {
    const keys = new Set(Array.from({ length: 200 }, () => newCoverKey().key));
    expect(keys.size).toBe(200);
  });

  it('stores a digest and not the key', () => {
    const { key, hash } = newCoverKey();
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(key);
    expect(coverKeyHash(key)).toBe(hash);
  });

  it('reads back a key typed with the separators a screen printed', () => {
    const { key } = newCoverKey();
    expect(groupCoverKey(key)).toHaveLength(COVER_KEY_LENGTH + 4);
    expect(normaliseCoverKey(groupCoverKey(key))).toBe(key);
    expect(normaliseCoverKey(groupCoverKey(key).replace(/ /g, '-'))).toBe(key);
    expect(normaliseCoverKey(key.toLowerCase())).toBe(key);
  });

  it('reads I, L and O as the digits a person meant', () => {
    expect(normaliseCoverKey('ILO'.padEnd(20, '0'))).toBe('110'.padEnd(20, '0'));
  });

  it('refuses anything that is not a key rather than dropping characters', () => {
    expect(normaliseCoverKey('')).toBeNull();
    expect(normaliseCoverKey('0'.repeat(19))).toBeNull();
    expect(normaliseCoverKey('0'.repeat(21))).toBeNull();
    // U is not in the alphabet, so this is a typo and not a key with a typo in it.
    expect(normaliseCoverKey('U'.repeat(20))).toBeNull();
    expect(normaliseCoverKey(`${'0'.repeat(19)}!`)).toBeNull();
  });

});

describe('getting back into a cover', () => {
  let app: FastifyInstance | null = null;

  afterEach(async () => {
    vi.restoreAllMocks();
    await app?.close();
    app = null;
  });

  async function harness(): Promise<TestHarness & { app: FastifyInstance }> {
    const built = await buildTestServer();
    app = built.app;
    return built;
  }

  async function buy(
    built: TestHarness & { app: FastifyInstance },
    nullifier = NULLIFIER_DECIMAL,
  ) {
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
    const token = await issueCredential(built, { nullifier });
    const response = await built.app.inject({
      method: 'POST',
      url: '/v1/bind',
      headers: { authorization: `Bearer ${token}` },
      payload: { quote_id: quote.quote_id },
    });
    expect(response.statusCode).toBe(201);
    return response.json();
  }

  function open(built: TestHarness & { app: FastifyInstance }, coverKey: unknown) {
    return built.app.inject({
      method: 'POST',
      url: '/v1/cover/open',
      payload: { cover_key: coverKey },
    });
  }

  function signIn(built: TestHarness & { app: FastifyInstance }, result: unknown) {
    return built.app.inject({
      method: 'POST',
      url: '/v1/world/sign-in',
      payload: { wallet: POLICYHOLDER_1.accountId, result },
    });
  }

  describe('POST /v1/bind', () => {
    it('hands back a cover key once, with the policy it opens', async () => {
      const built = await harness();
      const bound = await buy(built);
      expect(normaliseCoverKey(bound.cover_key)).toBe(bound.cover_key);
    });

    it('stores the key by its digest, so the table holds nothing that opens a cover', async () => {
      const built = await harness();
      const bound = await buy(built);
      const found = await built.repository.policyForCoverKey(coverKeyHash(bound.cover_key));
      expect(found?.policyId).toBe(bound.policy_id);
      expect(await built.repository.policyForCoverKey(bound.cover_key)).toBeNull();
    });

    it('keeps the key off the free policy read', async () => {
      const built = await harness();
      const bound = await buy(built);
      const free = await built.app.inject({ method: 'GET', url: `/v1/policy/${bound.policy_id}` });
      expect(free.statusCode).toBe(200);
      expect(free.json().cover_key).toBeUndefined();
      expect(free.body).not.toContain(bound.cover_key);
    });
  });

  describe('POST /v1/cover/open', () => {
    it('opens the cover the key was issued for', async () => {
      const built = await harness();
      const bound = await buy(built);
      const response = await open(built, bound.cover_key);
      expect(response.statusCode).toBe(200);
      expect(response.json().cover.policy_id).toBe(bound.policy_id);
    });

    it('takes the key as a person typed it off the screen', async () => {
      const built = await harness();
      const bound = await buy(built);
      const typed = groupCoverKey(bound.cover_key).toLowerCase();
      expect((await open(built, typed)).json().cover.policy_id).toBe(bound.policy_id);
    });

    it('says nothing about the person who holds the cover', async () => {
      const built = await harness();
      const bound = await buy(built);
      const body = (await open(built, bound.cover_key)).body;
      expect(body).not.toContain(NULLIFIER_DECIMAL);
      expect(body).not.toContain(POLICYHOLDER_1.address);
    });

    it('answers a key that opens nothing the same way whatever is wrong with it', async () => {
      const built = await harness();
      await buy(built);
      const unissued = await open(built, newCoverKey().key);
      const malformed = await open(built, 'not a cover key at all');
      expect(unissued.statusCode).toBe(404);
      expect(malformed.statusCode).toBe(404);
      expect(unissued.json().code).toBe('cover_key_unknown');
      expect(malformed.json().code).toBe('cover_key_unknown');
    });

    it('refuses a request with no key in it', async () => {
      const built = await harness();
      expect((await open(built, undefined)).statusCode).toBe(400);
      expect((await open(built, 42)).statusCode).toBe(400);
    });

    it('opens one cover and never a second one issued beside it', async () => {
      const built = await harness();
      const mine = await buy(built);
      const theirs = await buy(built, OTHER_NULLIFIER_DECIMAL);
      expect(mine.policy_id).not.toBe(theirs.policy_id);
      expect((await open(built, mine.cover_key)).json().cover.policy_id).toBe(mine.policy_id);
      expect((await open(built, theirs.cover_key)).json().cover.policy_id).toBe(theirs.policy_id);
    });
  });

  describe('POST /v1/world/sign-in', () => {
    /**
     * The stable nullifier World's documentation promises: "the same person
     * verifying the same action always produces the same nullifier". This test
     * is that promise held constant, because a real World ID is the only thing
     * that keeps it and this suite has no phone in it.
     *
     * https://docs.world.org/world-id/concepts
     */
    it('finds the cover bound to the nullifier the proof carried', async () => {
      const built = await harness();
      const bound = await buy(built);
      worldConfirms();
      const response = await signIn(built, idKitResult());
      expect(response.statusCode).toBe(200);
      expect(response.json().cover.policy_id).toBe(bound.policy_id);
    });

    it('finds that cover and never a second person\'s', async () => {
      const built = await harness();
      const mine = await buy(built);
      const theirs = await buy(built, OTHER_NULLIFIER_DECIMAL);
      worldConfirms(OTHER_NULLIFIER_HEX);
      const body = (await signIn(built, idKitResult(OTHER_NULLIFIER_HEX))).json();
      expect(body.cover.policy_id).toBe(theirs.policy_id);
      expect(body.cover.policy_id).not.toBe(mine.policy_id);
    });

    it('gives a person with no cover an empty answer rather than an error', async () => {
      const built = await harness();
      worldConfirms();
      const response = await signIn(built, idKitResult());
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ cover: null, covers_held: 0 });
    });

    it('issues no credential and hands back no cover key', async () => {
      const built = await harness();
      const bound = await buy(built);
      worldConfirms();
      const response = await signIn(built, idKitResult());
      expect(response.json().cover.cover_key).toBeUndefined();
      expect(response.body).not.toContain(bound.cover_key);
      expect(response.json().eligibility).toBeUndefined();
    });

    it('runs the purchase action, because that is the action the nullifier is scoped to', async () => {
      const built = await harness();
      await buy(built);
      const fetched = worldConfirms();
      await signIn(built, idKitResult());
      const sent = JSON.parse(String(fetched.mock.calls[0]?.[1]?.body));
      expect(sent.action).toBe('occupation-cover-eligibility');
    });

    it('refuses a proof bound to a different wallet', async () => {
      const built = await harness();
      await buy(built);
      worldConfirms();
      const response = await built.app.inject({
        method: 'POST',
        url: '/v1/world/sign-in',
        payload: { wallet: '0.0.999999', result: idKitResult() },
      });
      expect(response.statusCode).toBe(403);
    });

    it('refuses a request with no IDKit result in it', async () => {
      const built = await harness();
      const response = await built.app.inject({
        method: 'POST',
        url: '/v1/world/sign-in',
        payload: { wallet: POLICYHOLDER_1.accountId },
      });
      expect(response.statusCode).toBe(400);
    });
  });
});
