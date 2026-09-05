import { timingSafeEqual } from 'node:crypto';

import type { FastifyRequest } from 'fastify';

import { AppError } from '../errors.js';

/// The admin gate.
///
/// One bearer token per actor, compared in constant time. Two actors hold one
/// each: the Adjuster, which reads the queue and posts a machine decision, and
/// the human reviewer, whose decisions are recorded under their own name. That
/// is the whole of the access control here, and it is enough for a testnet
/// prototype provided the README says so plainly rather than implying a role
/// model that does not exist.
///
/// The logger already redacts `req.headers.authorization`, so a token cannot
/// reach a log line through the request serialiser.

export interface AdminActor {
  /** `adjuster` or `reviewer:<name>`, which is what the decision record carries. */
  name: string;
  /** False for the Adjuster: it decides claims and closes nothing. */
  canOverride: boolean;
}

export interface AdminTokens {
  /** The reviewer's token. Set it and the queue is reachable. */
  admin: string | undefined;
  /**
   * The Adjuster's own token, when the deployment gave it one. Left unset, the
   * Adjuster authenticates with ADMIN_TOKEN and the two actors share one
   * credential, which is said plainly in the README rather than dressed up as a
   * role model that does not exist.
   */
  adjuster: string | undefined;
  reviewerName: string;
}

export function loadAdminTokens(env: NodeJS.ProcessEnv = process.env): AdminTokens {
  const value = (name: string): string | undefined => {
    const raw = env[name];
    return raw === undefined || raw.trim() === '' ? undefined : raw.trim();
  };
  return {
    admin: value('ADMIN_TOKEN'),
    adjuster: value('ADJUSTER_ADMIN_TOKEN'),
    reviewerName: value('ADMIN_REVIEWER') ?? 'root',
  };
}

/** Compare two secrets without leaking their common prefix through timing. */
export function tokenMatches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  // timingSafeEqual throws on a length mismatch, which is itself a signal, so
  // both sides are padded to the same length before the comparison and the
  // length difference is folded into the result.
  const length = Math.max(a.byteLength, b.byteLength);
  const left = Buffer.alloc(length);
  const right = Buffer.alloc(length);
  a.copy(left);
  b.copy(right);
  return timingSafeEqual(left, right) && a.byteLength === b.byteLength;
}

/** The actor behind this request, or a refusal. */
export function requireAdmin(request: FastifyRequest, tokens: AdminTokens): AdminActor {
  const header = request.headers.authorization;
  const presented =
    typeof header === 'string' && header.toLowerCase().startsWith('bearer ')
      ? header.slice(7).trim()
      : '';

  if (tokens.admin === undefined && tokens.adjuster === undefined) {
    throw new AppError(
      503,
      'admin_not_configured',
      'Admin is not configured',
      'This deployment has no admin token set, so the review queue is closed.',
    );
  }
  if (presented === '') {
    throw new AppError(
      401,
      'admin_token_required',
      'Admin token required',
      'Send the admin token as a bearer token in the Authorization header.',
    );
  }
  if (tokens.adjuster !== undefined && tokenMatches(presented, tokens.adjuster)) {
    return { name: 'adjuster', canOverride: false };
  }
  if (tokens.admin !== undefined && tokenMatches(presented, tokens.admin)) {
    return { name: `reviewer:${tokens.reviewerName}`, canOverride: true };
  }
  throw new AppError(
    401,
    'admin_token_invalid',
    'Admin token invalid',
    'That token does not open the review queue.',
  );
}
