import { exportJWK, generateKeyPair, importJWK, SignJWT, type JWK } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  ALGORITHM,
  CLAIM_AUDIENCE,
  CredentialIssuer,
  ELIGIBILITY_AUDIENCE,
  publicHalf,
  readClaims,
} from '../src/credentials.js';
import { AppError } from '../src/errors.js';

/// The credential verifier, case by case.
///
/// Each step of the verification is a separate refusal with a separate code,
/// because they mean different things to a caller: a bad signature is a forgery
/// and an expired token is a person who took too long, and a client that cannot
/// tell them apart either sends someone back to a check they do not need or
/// waves through one they do.
///
/// The tests hold the signing key themselves rather than going through the
/// issuer, so a token can be minted that the issuer would never mint: the wrong
/// audience, an expiry in the past, the wrong issuer. That is the whole point,
/// because those are the tokens an attacker writes.

const ISSUER = 'http://localhost:3210/';

interface Signer {
  jwk: JWK;
  key: Awaited<ReturnType<typeof importJWK>>;
}

/** A private JWK, base64 of its JSON, which is the form the environment takes. */
function encodeJwk(jwk: JWK): string {
  return Buffer.from(JSON.stringify(jwk), 'utf8').toString('base64');
}

async function makeSigner(): Promise<Signer> {
  const pair = await generateKeyPair(ALGORITHM, { crv: 'Ed25519', extractable: true });
  const jwk = await exportJWK(pair.privateKey);
  return { jwk, key: await importJWK(jwk, ALGORITHM) };
}

const CLAIMS = {
  nullifier: '5972000000000000000000000000000000000009143',
  group: 'computer_math',
  series_id: 'ODI-COMP-2026-01',
  wallet: '0.0.10366453',
  wallet_evm: '0xcad39730d48683b13e6077a70c6972add449b6f5',
  scope: 'bind' as const,
  world: {
    action: 'occupation-cover-eligibility',
    environment: 'demo',
    credential: 'demo-issuer',
    verified_at: 1_757_000_000,
    presence: false,
  },
};

describe('the eligibility credential', () => {
  let signer: Signer;
  let other: Signer;
  let issuer: CredentialIssuer;

  beforeAll(async () => {
    signer = await makeSigner();
    other = await makeSigner();
    issuer = await CredentialIssuer.create({
      issuer: ISSUER,
      ttlSeconds: 1800,
      signingJwk: encodeJwk(signer.jwk),
      kid: 'elig-test',
    });
  });

  /** A token this issuer would never mint, so the verifier can be pushed at. */
  async function mint(
    overrides: {
      audience?: string;
      issuer?: string;
      expiresAt?: number;
      issuedAt?: number;
      key?: Awaited<ReturnType<typeof importJWK>>;
      claims?: Record<string, unknown>;
    } = {},
  ): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const issuedAt = overrides.issuedAt ?? now;
    return await new SignJWT({ ...CLAIMS, ...(overrides.claims ?? {}) })
      .setProtectedHeader({ alg: ALGORITHM, kid: 'elig-test', typ: 'JWT' })
      .setIssuer(overrides.issuer ?? ISSUER)
      .setAudience(overrides.audience ?? ELIGIBILITY_AUDIENCE)
      .setSubject(`wid:${CLAIMS.nullifier}`)
      .setJti('elg_01K4YB9X3M8Q0RZ7T2VD6C5H9E')
      .setIssuedAt(issuedAt)
      .setNotBefore(issuedAt)
      .setExpirationTime(overrides.expiresAt ?? now + 1800)
      .sign(overrides.key ?? signer.key);
  }

  async function refusal(token: string): Promise<AppError> {
    try {
      await issuer.verify(token);
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      return error as AppError;
    }
    throw new Error('the credential verified when it should not have');
  }

  it('accepts one it issued, and returns the claims a bind needs', async () => {
    const issued = await issuer.issue(CLAIMS);
    const verified = await issuer.verify(issued.token);
    expect(verified.jti).toBe(issued.jti);
    expect(verified.nullifier).toBe(CLAIMS.nullifier);
    expect(verified.group).toBe('computer_math');
    expect(verified.series_id).toBe('ODI-COMP-2026-01');
    expect(verified.wallet).toBe('0.0.10366453');
    expect(verified.wallet_evm).toBe(CLAIMS.wallet_evm);
  });

  it('issues for thirty minutes and no longer', async () => {
    const issued = await issuer.issue(CLAIMS);
    const lifetime = (issued.expiresAt.getTime() - issued.issuedAt.getTime()) / 1000;
    expect(lifetime).toBe(1800);
  });

  it('refuses one that has expired, and says so distinctly', async () => {
    const now = Math.floor(Date.now() / 1000);
    // Past the five second clock tolerance, which is deliberately small.
    const token = await mint({ issuedAt: now - 3600, expiresAt: now - 60 });
    const error = await refusal(token);
    expect(error.status).toBe(403);
    expect(error.code).toBe('credential_expired');
  });

  it('refuses a claim credential at a bind, which is what the audience is for', async () => {
    const token = await mint({ audience: CLAIM_AUDIENCE });
    const error = await refusal(token);
    expect(error.status).toBe(401);
    expect(error.code).toBe('credential_invalid');
  });

  it('refuses one signed with a key that is not ours', async () => {
    const token = await mint({ key: other.key });
    const error = await refusal(token);
    expect(error.status).toBe(401);
    expect(error.code).toBe('credential_invalid');
  });

  it('refuses one whose signature has been tampered with', async () => {
    const token = await mint();
    const [header, payload, signature] = token.split('.') as [string, string, string];
    // Flip one character of the signature, leaving a well formed JWT that does
    // not verify. A shape check would pass this; only the signature catches it.
    const flipped = signature.slice(0, -1) + (signature.endsWith('A') ? 'B' : 'A');
    const error = await refusal(`${header}.${payload}.${flipped}`);
    expect(error.status).toBe(401);
    expect(error.code).toBe('credential_invalid');
  });

  it('refuses one whose payload has been edited to name another wallet', async () => {
    const token = await mint();
    const [header, , signature] = token.split('.') as [string, string, string];
    const forged = Buffer.from(
      JSON.stringify({ ...CLAIMS, wallet: '0.0.9999999' }),
      'utf8',
    ).toString('base64url');
    const error = await refusal(`${header}.${forged}.${signature}`);
    expect(error.status).toBe(401);
    expect(error.code).toBe('credential_invalid');
  });

  it('refuses one minted by a different API', async () => {
    const token = await mint({ issuer: 'https://not-us.example/' });
    const error = await refusal(token);
    expect(error.status).toBe(401);
    expect(error.code).toBe('credential_invalid');
  });

  it('refuses one that is not a token at all', async () => {
    const error = await refusal('not.a.token');
    expect(error.status).toBe(401);
    expect(error.code).toBe('credential_invalid');
  });

  it('refuses a signed token that is missing the claims a bind needs', async () => {
    // The signature is ours, so only the shape check can catch this.
    const token = await mint({ claims: { wallet_evm: undefined, wallet: undefined } });
    const error = await refusal(token);
    expect(error.status).toBe(401);
    expect(error.code).toBe('credential_invalid');
  });

  it('refuses a hex nullifier, because casing would make one person two', () => {
    expect(() => readClaims({ ...CLAIMS, jti: 'elg_1', nullifier: '0xAbC' })).toThrow(AppError);
  });

  it('publishes the public half and never the private scalar', () => {
    const jwks = issuer.jwks();
    expect(jwks.keys).toHaveLength(1);
    expect(JSON.stringify(jwks)).not.toContain('"d"');
    expect(jwks.keys[0]?.kid).toBe('elig-test');
    expect(jwks.keys[0]?.alg).toBe(ALGORITHM);
  });

  it('strips the private scalar from any private JWK it is handed', () => {
    const stripped = publicHalf({ ...signer.jwk }, 'elig-test');
    expect(stripped.d).toBeUndefined();
    expect(stripped.x).toBe(signer.jwk.x);
  });

  it('generates a key when the environment carries none, so a clone still starts', async () => {
    const ephemeral = await CredentialIssuer.create({ issuer: ISSUER, ttlSeconds: 1800 });
    expect(ephemeral.ephemeral).toBe(true);
    const issued = await ephemeral.issue(CLAIMS);
    expect((await ephemeral.verify(issued.token)).jti).toBe(issued.jti);
    // A credential from one key does not verify against another, which is the
    // reason the environment should carry a key once there is more than one
    // instance.
    await expect(issuer.verify(issued.token)).rejects.toBeInstanceOf(AppError);
  });
});
