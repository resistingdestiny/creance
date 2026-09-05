import { hashSignal } from '@worldcoin/idkit-core/hashing';

import { AppError } from '../errors.js';
import type { WorldConfig } from './config.js';
import { actionFor, type WorldPurpose } from './rp-context.js';

/// Server side verification of an IDKit result.
///
/// World's endpoint confirms that a proof is cryptographically valid and
/// nothing else. The integration guide says so outright: "your backend must
/// check that the nullifier hasn't been used before". So the checks below are
/// not belt and braces, they are the security model. A proof issued for
/// somebody else's wallet is a genuinely valid proof; only the signal check
/// says it was not meant for this purchase.
///
/// The order is fixed and each step has its own test:
///
///   1  exactly one response item, rather than silently taking the first
///   2  forward the result to World untouched and require HTTP 200
///   3  require `success` on the body
///   4  the action is the one we asked for
///   5  the environment is the one this deployment is configured against
///   6  the signal hash is the hash of the value we bound the request to
///   7  the credential identifier is one the configured preset can return
///   8  at claim, the presence check actually completed
///
/// Success is decided from the HTTP status and not from `body.success`: the
/// live 400 bodies for a malformed request carry no `success` field at all, so
/// `if (body.success === false)` would let one through as a verification.
///
/// https://docs.world.org/world-id/idkit/integrate
/// https://docs.world.org/world-id/id/verify-proofs

/** One credential's answer inside an IDKit result. Forwarded, never rebuilt. */
export interface IdKitResponseItem {
  identifier?: unknown;
  signal_hash?: unknown;
  proof?: unknown;
  merkle_root?: unknown;
  nullifier?: unknown;
  [key: string]: unknown;
}

/** What IDKit hands the browser. Passed to World byte for byte. */
export interface IdKitResult {
  protocol_version?: unknown;
  nonce?: unknown;
  action?: unknown;
  environment?: unknown;
  responses?: unknown;
  user_presence_completed?: unknown;
  [key: string]: unknown;
}

/** World's answer, as much of it as we read. */
export interface WorldVerifyBody {
  success?: unknown;
  action?: unknown;
  nullifier?: unknown;
  created_at?: unknown;
  environment?: unknown;
  code?: unknown;
  detail?: unknown;
  attribute?: unknown;
  results?: unknown;
}

export interface WorldVerification {
  /** The nullifier as a decimal integer string, which is how it is stored. */
  nullifier: string;
  /** What World says the environment was, not what we asked for. */
  environment: string;
  /** The credential identifier the proof carried, `selfie` for Selfie Check. */
  credential: string;
  /** True only when World App completed a fresh liveness check. */
  presence: boolean;
  action: string;
  verifiedAt: number;
  protocolVersion: string;
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface VerifyInput {
  world: WorldConfig;
  purpose: WorldPurpose;
  /** The wallet id at purchase, the policy id at claim. */
  signal: string;
  result: IdKitResult;
  fetchImpl?: FetchLike;
  /** Somewhere to log World's own error fields, which name the bad attribute. */
  onWorldError?: (body: WorldVerifyBody, status: number) => void;
}

/** The one message a person sees for every rejection on this path. */
const FAILED = "We couldn't verify you.";

export async function verifySelfieCheck(input: VerifyInput): Promise<WorldVerification> {
  const { world, purpose, signal, result } = input;
  const responses = onlyResponse(result);
  const expectedAction = actionFor(world, purpose);

  const { body, status } = await postToWorld(world, result, input.fetchImpl);
  if (status !== 200) {
    input.onWorldError?.(body, status);
    throw rejected(worldReason(body, status));
  }
  if (body.success !== true) {
    input.onWorldError?.(body, status);
    throw rejected('World answered 200 without confirming the proof.');
  }

  if (text(result.action) !== expectedAction) {
    throw rejected(`The check was made for a different action than ${expectedAction}.`);
  }
  const environment = text(result.environment);
  if (environment !== world.environment) {
    throw rejected(
      `The check ran in the ${environment ?? 'unnamed'} environment and this deployment expects ${world.environment}.`,
    );
  }

  const signalHash = text(responses.signal_hash);
  if (signalHash === null || !sameHex(signalHash, hashSignal(signal))) {
    throw new AppError(
      403,
      'world_signal_mismatch',
      'Check not for this purchase',
      'That check was bound to something other than this wallet, so it cannot buy this cover.',
    );
  }

  const identifier = (text(responses.identifier) ?? '').toLowerCase();
  if (!world.identifiers.includes(identifier)) {
    throw rejected(
      `The check returned a ${identifier === '' ? 'nameless' : identifier} credential and this deployment accepts ${world.identifiers.join(' or ')}.`,
    );
  }

  // Requesting presence and receiving it are two different facts, and whether
  // World's endpoint enforces the flag it was asked for is not documented. So
  // the claim path reads it off the proof. A missing value is false, as the
  // verify schema instructs.
  const presence = result.user_presence_completed === true;
  if (purpose === 'claim' && !presence) {
    throw new AppError(
      403,
      'world_presence_missing',
      'The camera check did not finish',
      'That check did not complete a fresh liveness check, which a claim needs.',
    );
  }

  return {
    nullifier: decimalNullifier(body.nullifier ?? responses.nullifier),
    environment: text(body.environment) ?? environment ?? world.environment,
    credential: identifier,
    presence,
    action: expectedAction,
    verifiedAt: Math.floor(Date.now() / 1000),
    protocolVersion: text(result.protocol_version) ?? '',
  };
}

/**
 * The forward. No authentication header: the endpoint declares no security and
 * nothing secret goes over it, which is why the API can call it without
 * carrying a World API key.
 */
export async function postToWorld(
  world: WorldConfig,
  result: IdKitResult,
  fetchImpl: FetchLike = globalThis.fetch,
): Promise<{ body: WorldVerifyBody; status: number }> {
  const url = `${world.verifyUrl}/${world.verifyId}`;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(result),
    });
  } catch (error) {
    throw new AppError(
      502,
      'world_unreachable',
      'World did not answer',
      "The check could not be confirmed with World. Try again in a moment.",
      [{ path: 'world', message: String((error as Error)?.message ?? error) }],
    );
  }
  let body: WorldVerifyBody;
  try {
    body = (await response.json()) as WorldVerifyBody;
  } catch {
    body = {};
  }
  return { body, status: response.status };
}

/**
 * The response array has `minItems: 1` and our presets ask for one credential.
 * A result carrying two is refused rather than reduced to its first element:
 * taking `[0]` of something unexpected is how the wrong credential gets
 * accepted.
 */
function onlyResponse(result: IdKitResult): IdKitResponseItem {
  const responses = result.responses;
  if (!Array.isArray(responses) || responses.length !== 1) {
    throw new AppError(
      400,
      'world_result_malformed',
      'Check result malformed',
      'A World ID result carries exactly one credential response.',
    );
  }
  return responses[0] as IdKitResponseItem;
}

/**
 * The nullifier as a decimal integer string.
 *
 * World returns a 0x-prefixed hex string standing for a 256-bit integer, and
 * the integration guide says to convert and store it as a number "to avoid
 * parsing and casing issues that can lead to security vulnerabilities". Two
 * rows differing only by hex casing are two people to a text index, which is
 * one person with two policies.
 */
export function decimalNullifier(value: unknown): string {
  const raw = text(value);
  if (raw === null) throw rejected('The check returned no identifier for the person.');
  try {
    return BigInt(raw).toString();
  } catch {
    throw rejected('The check returned an identifier that is not a number.');
  }
}

/** World's own words, kept for the log and never shown to a person. */
function worldReason(body: WorldVerifyBody, status: number): string {
  const code = text(body.code);
  const detail = text(body.detail);
  const attribute = text(body.attribute);
  const parts = [code ?? `http_${status}`, detail, attribute === null ? null : `(${attribute})`];
  return parts.filter((part) => part !== null).join(' ');
}

function rejected(reason: string): AppError {
  return new AppError(403, 'world_verification_failed', 'Check refused', FAILED, [
    { path: 'world', message: reason },
  ]);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function sameHex(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}
