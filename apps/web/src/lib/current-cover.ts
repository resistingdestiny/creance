import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { cookies } from 'next/headers';

import { endClaim, readClaim } from './claim-session';
import { endPurchase, readPurchase } from './purchase-session';
import { serverVar } from './server-env';

/**
 * Which cover the screen in front of the person is about, and how they get back
 * to it tomorrow.
 *
 * Three sources, in the order they win. The claim session names the cover a
 * claim in progress belongs to; the cover session is the durable one, opened by
 * a cover key or by a World ID sign in; the purchase session names the one this
 * browser has just bought.
 *
 * The cover session replaces `?policy=`, which was the old way to reopen a
 * cover after the session behind it had gone. An id in the address is in the
 * history, in a screenshot and in whatever the next request sends as a
 * referrer, and anyone who read it once could reopen the cover for ever. This
 * holds the same id in an httpOnly cookie instead, and the only two ways to
 * fill that cookie are the two the ticket names.
 *
 * Nothing here is held in the process's memory, deliberately, and that is the
 * one place this departs from the purchase session in T15. The whole complaint
 * is that a module level Map does not survive a restart or a browser being
 * closed. So the cover session is the cookie: a policy id, its own expiry and a
 * signature over both.
 *
 * What does not become durable with it is the eligibility credential. That
 * still lives and dies inside one process, in src/lib/purchase-session.ts, for
 * the reason docs/DECISIONS.md gives in T15: it is a bearer token that binds a
 * policy in the holder's name and it must not outlive the process that minted
 * it. A cover key opens a dashboard. It does not buy anything.
 */

const COOKIE = 'creance_cover';

/** Long enough to come back the next day, short enough to be a session. */
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The key that signs the cookie.
 *
 * A signature rather than a bare id, because an unsigned cookie is the same
 * hole `?policy=` was: anybody could type another cover's id into their own
 * browser and read it. Signed, the only ways in are a cover key and a World ID
 * check.
 *
 * `COVER_SESSION_SECRET` from the environment when it is set. A clone with
 * none gets a random one per process, so it still works and a restart signs
 * everyone out, which is the safe direction to fail in.
 */
let processSecret: Buffer | null = null;

function secret(): Buffer {
  const configured = serverVar('COVER_SESSION_SECRET');
  if (configured !== null) return Buffer.from(configured, 'utf8');
  processSecret ??= randomBytes(32);
  return processSecret;
}

function sign(body: string): string {
  return createHmac('sha256', secret()).update(body, 'utf8').digest('base64url');
}

function signatureHolds(body: string, given: string): boolean {
  const expected = Buffer.from(sign(body), 'utf8');
  const offered = Buffer.from(given, 'utf8');
  if (expected.length !== offered.length) return false;
  return timingSafeEqual(expected, offered);
}

export interface CoverSession {
  readonly policyId: string;
  /**
   * The cover key this session was opened with, when it was opened with one.
   *
   * It rides in the cookie rather than in the process's memory so that the
   * dashboard can show it back to the person for the session's whole life. The
   * cookie is httpOnly and is already a bearer session to this cover, so the
   * key adds no reach that the cookie did not already have. Empty for a session
   * opened by a World ID check, which produces no key.
   */
  readonly coverKey: string;
  readonly expiresAt: number;
}

/** The cover session behind the request's cookie, or null. Only reads. */
export async function readCoverSession(): Promise<CoverSession | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (raw === undefined) return null;
  const at = raw.lastIndexOf('.');
  if (at === -1) return null;
  const body = raw.slice(0, at);
  if (!signatureHolds(body, raw.slice(at + 1))) return null;

  const [version, policyId, coverKey, expiry] = body.split('.');
  if (version !== 'v1' || policyId === undefined || expiry === undefined) return null;
  const expiresAt = Number(expiry);
  // The expiry is inside the signed body, not only in the cookie's max-age,
  // because max-age is the browser's to ignore.
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
  return { policyId, coverKey: coverKey ?? '', expiresAt };
}

/**
 * Opens a cover session on one policy. Sets a cookie, so it may only be called
 * from a server action or a route handler.
 *
 * Signing in creates a session; it never extends one. Every call writes a fresh
 * expiry counted from now, and nothing anywhere reads a session and pushes its
 * expiry out.
 */
export async function openCoverSession(policyId: string, coverKey = ''): Promise<void> {
  const expiresAt = Date.now() + TTL_MS;
  const body = `v1.${policyId}.${canonicalCoverKey(coverKey)}.${String(expiresAt)}`;
  (await cookies()).set(COOKIE, `${body}.${sign(body)}`, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: TTL_MS / 1000,
    secure: process.env.NODE_ENV === 'production',
  });
}

/**
 * A cover key in the form the dashboard prints it back in.
 *
 * A key arrives at the bind response already canonical, and arrives from a
 * person's keyboard with whatever separators and lookalike characters they
 * typed. The API is the authority on what opens a cover
 * (apps/api/src/cover-key.ts): these are the same rules, applied here only so
 * that what is stored in the session is what was issued rather than what was
 * typed, because a key redisplayed in the form somebody typed it would be a
 * different string from the one on their piece of paper.
 */
export function canonicalCoverKey(key: string): string {
  return key
    .replace(/[\s\-_]/g, '')
    .toUpperCase()
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
}

/** Drops the cover session cookie and nothing else. */
export async function closeCoverSession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

/**
 * Signing out: every session on this browser that resolves to a cover, gone.
 *
 * Three of them, because `currentPolicyId` reads three. Dropping only the cover
 * cookie leaves the purchase session naming the same cover for the rest of its
 * thirty minutes and the claim session naming it for two hours, so /claim would
 * still open a cover the person had just signed out of. A claim in progress
 * goes with it, evidence and all, which is what signing out has to mean: those
 * files are the most private thing this app ever holds.
 */
export async function forgetCover(): Promise<void> {
  await closeCoverSession();
  await endClaim();
  await endPurchase();
}

/**
 * Which cover a screen is about.
 *
 * Home reads it and so do the claim screens, so the read lives here rather than
 * in five routes.
 */
export async function currentPolicyId(): Promise<string | null> {
  const claim = await readClaim();
  if (claim?.policyId != null) return claim.policyId;
  const cover = await readCoverSession();
  if (cover !== null) return cover.policyId;
  const purchase = await readPurchase();
  return purchase?.policyId ?? null;
}
