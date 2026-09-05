import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { cookies } from 'next/headers';

import { adminToken } from './admin-api';

/**
 * Who is allowed to spend the server's admin token.
 *
 * The web server holds `ADMIN_TOKEN` so that screen C9 can read the sentences a
 * decline carries and so that the review queue can be a screen at all. Holding
 * it is not the same as being entitled to it: without this module, every
 * request that reaches the app is served the queue and can call the decide
 * action, and an approval moves settlement funds out of the vault. The API
 * gates those endpoints with a constant time bearer comparison, and a screen in
 * front of them that gates nothing undoes that gate.
 *
 * So a reviewer proves who they are once, by entering the same token, and what
 * the browser then holds is an opaque id in an httpOnly cookie, exactly as
 * src/lib/claim-session.ts holds the id of the claim that browser submitted.
 * The token itself never goes back to the browser.
 *
 * Memory rather than a store, for the same reason a purchase is: the session
 * must not outlive the process that minted it, and one web process serves this
 * demo. A restart signs every reviewer out, which is the safe direction.
 *
 * This is a demo's authentication and it is worth saying what it is not: one
 * shared credential, no accounts, no rate limit on the entry screen, and a
 * decision records `reviewer:root` whoever typed it. docs/CLAIMS.md already
 * says per-actor scopes are on the list of things a real deployment needs and
 * this one does not have.
 */

const COOKIE = 'creance_reviewer';

/** A working day at a queue, and no longer. */
const TTL_MS = 8 * 60 * 60 * 1000;

interface Entry {
  expiresAt: number;
}

const sessions = new Map<string, Entry>();

function prune(now: number): void {
  for (const [id, entry] of sessions) {
    if (entry.expiresAt <= now) sessions.delete(id);
  }
}

/**
 * Constant time equality over the digests rather than the strings.
 *
 * `timingSafeEqual` throws on a length mismatch, so comparing the raw values
 * would leak the token's length through the exception. Hashing first makes both
 * sides 32 bytes whatever was typed, which is the same reason the API compares
 * digests.
 */
function sameToken(given: string, expected: string): boolean {
  const a = createHash('sha256').update(given, 'utf8').digest();
  const b = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(a, b);
}

/** Whether a typed token is the one this deployment was configured with. */
export function tokenAccepted(given: string, expected: string | null = adminToken()): boolean {
  if (expected === null || given === '') return false;
  return sameToken(given, expected);
}

/**
 * Signs a reviewer in if the token matches. Sets a cookie, so it may only be
 * called from a server action or a route handler.
 */
export async function startReview(given: string): Promise<boolean> {
  if (!tokenAccepted(given.trim())) return false;
  const id = randomBytes(24).toString('base64url');
  const now = Date.now();
  prune(now);
  sessions.set(id, { expiresAt: now + TTL_MS });
  (await cookies()).set(COOKIE, id, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/admin',
    maxAge: TTL_MS / 1000,
    secure: process.env.NODE_ENV === 'production',
  });
  return true;
}

/**
 * Whether this request carries a reviewer session. Safe to call while
 * rendering: it only reads.
 */
export async function isReviewer(): Promise<boolean> {
  const id = (await cookies()).get(COOKIE)?.value;
  if (id === undefined) return false;
  const now = Date.now();
  prune(now);
  return sessions.has(id);
}

/** Signs a reviewer out and forgets the session behind their cookie. */
export async function endReview(): Promise<void> {
  const store = await cookies();
  const id = store.get(COOKIE)?.value;
  if (id !== undefined) sessions.delete(id);
  store.delete(COOKIE);
}

/** Test seam. Nothing in the app calls this. */
export function clearAllReviewers(): void {
  sessions.clear();
}
