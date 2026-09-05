import { randomBytes } from 'node:crypto';

import { cookies } from 'next/headers';

/**
 * The claim in progress, held on the server.
 *
 * The same pattern as src/lib/purchase-session.ts and for the same reasons.
 * The claim credential is a bearer token that submits a packet in the holder's
 * name, so it is not something to put in a cookie, in local storage or in a
 * client component's props; the browser holds one opaque id and nothing else.
 *
 * Two things live here that a purchase has no equivalent of.
 *
 * The evidence. Files are gathered on C3 and submitted on C5, so their bytes
 * have to survive two screens. They stay in the web process's memory, capped
 * the way the API caps them, and they are dropped the moment the packet is
 * accepted. Nothing is written to disk: a document a person uploaded is the
 * most private thing this app ever holds, and the API is where it is sealed.
 *
 * The claim id. It is what proves this browser submitted this claim, which is
 * what lets the web server read the decision sentences for screen C9 (see
 * src/lib/admin-api.ts). It outlives the credential, so the session's life is
 * counted from the last write rather than from the credential's issue.
 */

const COOKIE = 'creance_claim';

/** Long enough to read a decision and short enough not to outlive a demo. */
const TTL_MS = 2 * 60 * 60 * 1000;

/** The API's own caps, so a file is refused on the screen it was chosen on. */
export const MAX_EVIDENCE_FILES = 4;
export const MAX_EVIDENCE_BYTES = 4 * 1024 * 1024;

export interface ClaimEvidence {
  readonly filename: string;
  readonly kind: string;
  readonly bytes: number;
  /** The file itself, as the packet takes it. Server side only. */
  readonly contentBase64: string;
}

export interface ClaimSession {
  /** The cover being claimed on. Every screen after C1 needs it. */
  policyId: string | null;
  fullName: string | null;
  employer: string | null;
  jobTitle: string | null;
  /** YYYY-MM-DD, as the form's date input and the API both write it. */
  lastDayOfWork: string | null;
  /** One of SEPARATION_TYPES, mapped from the C2 select. */
  separationType: string | null;
  evidence: ClaimEvidence[];
  /** The claim credential the live person check earned. Never sent to a browser. */
  credential: string | null;
  credentialExpiresAt: string | null;
  /** Which issuer minted it, so C4 can label a demo one the way Verify does. */
  credentialIssuer: string | null;
  /** Set once the packet is accepted. C6 polls the claim behind it. */
  claimId: string | null;
}

interface Entry {
  expiresAt: number;
  value: ClaimSession;
}

const sessions = new Map<string, Entry>();

function prune(now: number): void {
  for (const [id, entry] of sessions) {
    if (entry.expiresAt <= now) sessions.delete(id);
  }
}

function emptySession(policyId: string | null): ClaimSession {
  return {
    policyId,
    fullName: null,
    employer: null,
    jobTitle: null,
    lastDayOfWork: null,
    separationType: null,
    evidence: [],
    credential: null,
    credentialExpiresAt: null,
    credentialIssuer: null,
    claimId: null,
  };
}

/** The session behind the request's cookie, or null. Safe to call while rendering. */
export async function readClaim(): Promise<ClaimSession | null> {
  const id = (await cookies()).get(COOKIE)?.value;
  if (id === undefined) return null;
  const now = Date.now();
  prune(now);
  return sessions.get(id)?.value ?? null;
}

/**
 * Starts a claim on one cover and returns its empty session. Sets a cookie, so
 * it may only be called from a server action or a route handler.
 */
export async function startClaim(policyId: string): Promise<ClaimSession> {
  const id = randomBytes(24).toString('base64url');
  const value = emptySession(policyId);
  const now = Date.now();
  prune(now);
  sessions.set(id, { expiresAt: now + TTL_MS, value });
  (await cookies()).set(COOKIE, id, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: TTL_MS / 1000,
    secure: process.env.NODE_ENV === 'production',
  });
  return value;
}

/**
 * Applies a patch to the session behind the request's cookie, or null when
 * there is none. Null rather than a fresh session: a claim belongs to one
 * cover, and a step that arrives without one has to go back to the start
 * rather than guess which cover it was about.
 */
export async function updateClaim(patch: Partial<ClaimSession>): Promise<ClaimSession | null> {
  const id = (await cookies()).get(COOKIE)?.value;
  const existing = id === undefined ? undefined : sessions.get(id);
  if (existing === undefined) return null;
  Object.assign(existing.value, patch);
  existing.expiresAt = Date.now() + TTL_MS;
  return existing.value;
}

/** Forgets the claim, its credential and every file it was holding. */
export async function endClaim(): Promise<void> {
  const store = await cookies();
  const id = store.get(COOKIE)?.value;
  if (id !== undefined) sessions.delete(id);
  store.delete(COOKIE);
}

/** Test seam. Nothing in the app calls this. */
export function clearAllClaims(): void {
  sessions.clear();
}
