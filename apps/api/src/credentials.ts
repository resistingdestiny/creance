import { exportJWK, generateKeyPair, importJWK, jwtVerify, SignJWT, type JWK } from 'jose';

import { AppError } from './errors.js';
import { newId } from './ids.js';

/// The eligibility credential, and the interim issuer that mints one.
///
/// DESIGN.md 3.6: a short-lived JWT carrying the nullifier hash, the occupation
/// group, the wallet and a thirty-minute expiry. T11 builds the World Selfie
/// Check that earns one; until then this module both issues and verifies, so
/// that /v1/bind can take a credential today and T11 replaces the issuer rather
/// than discovering it. The interim issuer is recorded in docs/DECISIONS.md.
///
/// EdDSA over Ed25519, not a shared HMAC secret. Three reasons: the Steward and
/// the Bazantic gateway can verify a credential they are carrying without
/// holding a key that could also mint one; a leaked verification key does
/// nothing; and the JWKS endpoint is two lines and makes the whole thing
/// demonstrable.
///
/// https://www.rfc-editor.org/rfc/rfc7519.html

export const ELIGIBILITY_AUDIENCE = 'urn:creance:bind';
export const CLAIM_AUDIENCE = 'urn:creance:claim';
export const ALGORITHM = 'EdDSA';

/** Whatever `jose` hands back for a key, without naming a DOM type. */
type SigningKey = Awaited<ReturnType<typeof importJWK>>;

export interface EligibilityClaims {
  nullifier: string;
  group: string;
  series_id: string;
  wallet: string;
  wallet_evm: string;
  scope: 'bind';
  world: {
    action: string;
    environment: string;
    credential: string;
    verified_at: number;
    presence: boolean;
  };
}

export interface VerifiedCredential extends EligibilityClaims {
  jti: string;
  issuedAt: number;
  expiresAt: number;
}

export interface IssuerOptions {
  issuer: string;
  ttlSeconds: number;
  /** The private JWK, base64 of its JSON. Generated at boot when absent. */
  signingJwk?: string | undefined;
  kid?: string | undefined;
}

/**
 * The signing key. When the environment carries one it is used, so that
 * credentials survive a restart and a second process can verify them; when it
 * does not, one is generated at boot and the fact is logged, because a
 * thirty-minute credential that does not outlive the process is a working demo
 * and a missing key should not stop the API from starting.
 */
export async function loadSigningKey(
  options: IssuerOptions,
): Promise<{ privateKey: SigningKey; publicJwk: JWK; kid: string; ephemeral: boolean }> {
  const kid = options.kid ?? 'elig-1';
  if (options.signingJwk !== undefined && options.signingJwk !== '') {
    const jwk = JSON.parse(Buffer.from(options.signingJwk, 'base64').toString('utf8')) as JWK;
    const privateKey = await importJWK(jwk, ALGORITHM);
    const publicJwk = publicHalf(jwk, kid);
    return { privateKey, publicJwk, kid, ephemeral: false };
  }
  const pair = await generateKeyPair(ALGORITHM, { crv: 'Ed25519', extractable: true });
  const publicJwk = { ...(await exportJWK(pair.publicKey)), kid, alg: ALGORITHM, use: 'sig' };
  return { privateKey: pair.privateKey as SigningKey, publicJwk, kid, ephemeral: true };
}

/**
 * The public half of a private JWK, with `d` removed.
 *
 * `d` is the private scalar. A JWKS that carries it hands the signing key to
 * everyone who reads the endpoint, so it is stripped here rather than at the
 * route, and there is a test that asserts the served document has no `d`.
 */
export function publicHalf(jwk: JWK, kid: string): JWK {
  const rest: JWK = { ...jwk };
  delete rest.d;
  return { ...rest, kid, alg: ALGORITHM, use: 'sig' };
}

export class CredentialIssuer {
  private constructor(
    private readonly privateKey: SigningKey,
    readonly publicJwk: JWK,
    readonly kid: string,
    readonly ephemeral: boolean,
    private readonly options: IssuerOptions,
  ) {}

  static async create(options: IssuerOptions): Promise<CredentialIssuer> {
    const key = await loadSigningKey(options);
    return new CredentialIssuer(key.privateKey, key.publicJwk, key.kid, key.ephemeral, options);
  }

  /** The JWKS document. Public material only. */
  jwks(): { keys: JWK[] } {
    return { keys: [this.publicJwk] };
  }

  async issue(
    claims: EligibilityClaims,
    at: Date = new Date(),
  ): Promise<{ token: string; jti: string; issuedAt: Date; expiresAt: Date }> {
    const jti = newId('credential', at.getTime());
    const issuedAt = Math.floor(at.getTime() / 1000);
    const expiresAt = issuedAt + this.options.ttlSeconds;
    const token = await new SignJWT({ ...claims })
      .setProtectedHeader({ alg: ALGORITHM, kid: this.kid, typ: 'JWT' })
      .setIssuer(this.options.issuer)
      .setAudience(ELIGIBILITY_AUDIENCE)
      .setSubject(`wid:${claims.nullifier}`)
      .setJti(jti)
      .setIssuedAt(issuedAt)
      .setNotBefore(issuedAt)
      .setExpirationTime(expiresAt)
      .sign(this.privateKey);
    return {
      token,
      jti,
      issuedAt: new Date(issuedAt * 1000),
      expiresAt: new Date(expiresAt * 1000),
    };
  }

  /**
   * Verify a bearer credential. The order matters and each step is its own
   * test: a bad signature and an expired token are different answers, and an
   * audience check is what stops a claim credential being replayed at bind.
   */
  async verify(token: string): Promise<VerifiedCredential> {
    let payload;
    try {
      ({ payload } = await jwtVerify(token, this.publicKeyForVerify(), {
        issuer: this.options.issuer,
        audience: ELIGIBILITY_AUDIENCE,
        algorithms: [ALGORITHM],
        clockTolerance: 5,
      }));
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'ERR_JWT_EXPIRED') {
        throw new AppError(
          403,
          'credential_expired',
          'Check expired',
          'That eligibility credential has expired. Verify again.',
        );
      }
      throw new AppError(
        401,
        'credential_invalid',
        'Credential invalid',
        'That eligibility credential did not verify against this API.',
      );
    }
    return readClaims(payload);
  }

  private publicKeyForVerify(): Parameters<typeof jwtVerify>[1] {
    // jose takes a JWK directly for verification, so nothing here ever holds
    // the private half in the verify path.
    return this.publicJwk as never;
  }
}

interface RawPayload {
  jti?: unknown;
  iat?: unknown;
  exp?: unknown;
  scope?: unknown;
  nullifier?: unknown;
  group?: unknown;
  series_id?: unknown;
  wallet?: unknown;
  wallet_evm?: unknown;
  world?: unknown;
}

/** Shape checks the signature cannot do. A signed token can still be wrong. */
export function readClaims(payload: RawPayload): VerifiedCredential {
  const jti = str(payload.jti);
  const nullifier = str(payload.nullifier);
  if (jti === null || nullifier === null || !/^\d+$/.test(nullifier)) throw malformed();
  const group = str(payload.group);
  const seriesId = str(payload.series_id);
  const wallet = str(payload.wallet);
  const walletEvm = str(payload.wallet_evm);
  if (group === null || seriesId === null || wallet === null || walletEvm === null) {
    throw malformed();
  }
  const world = (payload.world ?? {}) as Record<string, unknown>;
  return {
    jti,
    nullifier,
    group,
    series_id: seriesId,
    wallet,
    wallet_evm: walletEvm,
    scope: 'bind',
    issuedAt: Number(payload.iat ?? 0),
    expiresAt: Number(payload.exp ?? 0),
    world: {
      action: str(world['action']) ?? '',
      environment: str(world['environment']) ?? '',
      credential: str(world['credential']) ?? '',
      verified_at: Number(world['verified_at'] ?? 0),
      presence: world['presence'] === true,
    },
  };
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function malformed(): AppError {
  return new AppError(
    401,
    'credential_invalid',
    'Credential invalid',
    'That credential verified but does not carry the claims a bind needs.',
  );
}
