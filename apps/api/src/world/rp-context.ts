import { signRequest } from '@worldcoin/idkit-core/signing';
import { getBytes, keccak256, toBeHex, toUtf8Bytes, verifyMessage, zeroPadValue } from 'ethers';

import type { WorldConfig } from './config.js';

/// The signed request context every IDKit request carries.
///
/// The client passes `rp_context` to IDKit, but the signature inside it is
/// produced here, with the Portal's signing key. The World App checks it before
/// it shows the person anything, and when it is wrong the widget reports
/// `invalid_rp_signature`, which names none of the four inputs.
///
/// Two shapes, one mapping. The SDK helper returns camelCase (`sig`,
/// `createdAt`, `expiresAt`); `rp_context` takes snake_case (`signature`,
/// `created_at`, `expires_at`) and adds `rp_id`, which is not part of the
/// signed message. The mapping happens once, here, because doing it by hand at
/// each call site is what produces `malformed_request`.
///
/// The signed message is a fixed 81-byte layout for a named action: a version
/// byte, the 32-byte nonce, two big-endian uint64 timestamps and the action
/// hashed to a field element, then EIP-191 personal-sign over keccak256. None
/// of that is implemented here. It is described because a failing signature is
/// diagnosed by knowing which of the four inputs went into it.
///
/// https://docs.world.org/world-id/idkit/signatures

/** The object IDKit takes, field for field. */
export interface RpContext {
  rp_id: string;
  nonce: string;
  created_at: number;
  expires_at: number;
  signature: string;
}

/** Everything the widget needs for one request, from one call. */
export interface WorldRequestContext extends RpContext {
  app_id: string;
  action: string;
  environment: string;
  preset: string;
  /** The value the signal is bound to, so the API can check it back. */
  signal: string;
  require_user_presence: boolean;
}

export class WorldNotConfigured extends Error {
  constructor() {
    super('this deployment has no World ID app id and RP signing key');
    this.name = 'WorldNotConfigured';
  }
}

/**
 * A fresh nonce and a fresh signature, every time.
 *
 * Never cached and never memoised across two attempts: reusing one returns
 * `duplicate_nonce`, and a retry after the person cancelled needs a new one.
 */
export function signRpContext(world: WorldConfig, action: string): RpContext {
  if (world.signingKey === undefined || world.appId === '') throw new WorldNotConfigured();
  const signed = signRequest({
    signingKeyHex: world.signingKey,
    action,
    ttl: world.rpContextTtlSeconds,
  });
  return {
    rp_id: world.rpId === '' ? world.appId : world.rpId,
    nonce: signed.nonce,
    created_at: signed.createdAt,
    expires_at: signed.expiresAt,
    signature: signed.sig,
  };
}

/** The purchase check and the claim check differ in the action, the signal and presence. */
export type WorldPurpose = 'purchase' | 'claim';

export function actionFor(world: WorldConfig, purpose: WorldPurpose): string {
  return purpose === 'claim' ? world.actionClaim : world.actionEligibility;
}

/**
 * One request context.
 *
 * `require_user_presence` is true only at claim: DESIGN.md 3.9 item 1 asks for
 * a fresh liveness check when someone collects, and asking for one at purchase
 * would put a camera in front of a person who has just enrolled.
 */
export function requestContext(
  world: WorldConfig,
  purpose: WorldPurpose,
  signal: string,
): WorldRequestContext {
  const action = actionFor(world, purpose);
  return {
    ...signRpContext(world, action),
    app_id: world.appId,
    action,
    environment: world.environment,
    preset: world.preset,
    signal,
    require_user_presence: purpose === 'claim',
  };
}

/**
 * Whether the configured signing key is the one the Portal registered.
 *
 * A wrong key produces `invalid_rp_signature` in the World App, which names
 * none of its four inputs and is the worst error in this integration to debug
 * live. Recovering the address from a throwaway signature turns that into a
 * boot-time yes or no, which is the whole reason `WORLD_RP_SIGNER_ADDRESS` is
 * in the environment. Null when there is nothing to compare against.
 *
 * The message is rebuilt here rather than taken from the SDK because the point
 * is to check the SDK's output, not to trust it.
 */
export function signerMatches(world: WorldConfig): boolean | null {
  if (world.signerAddress === '' || world.signingKey === undefined) return null;
  try {
    const context = signRpContext(world, world.actionEligibility);
    const message = new Uint8Array(81);
    message[0] = 1;
    message.set(getBytes(context.nonce), 1);
    const view = new DataView(message.buffer);
    view.setBigUint64(33, BigInt(context.created_at), false);
    view.setBigUint64(41, BigInt(context.expires_at), false);
    const actionField = BigInt(keccak256(toUtf8Bytes(world.actionEligibility))) >> 8n;
    message.set(getBytes(zeroPadValue(toBeHex(actionField), 32)), 49);
    const recovered = verifyMessage(message, context.signature);
    return recovered.toLowerCase() === world.signerAddress.toLowerCase();
  } catch {
    return false;
  }
}
