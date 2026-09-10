import { randomBytes } from 'node:crypto';

import { cookies } from 'next/headers';

import type { WalletAccount } from './wallet';

/**
 * The purchase in progress, held on the server.
 *
 * The eligibility credential is a bearer token that binds a policy in the
 * holder's name, so it is not something to put in a cookie, in local storage or
 * in a client component's props. DESIGN.md 3.6 makes it single use and thirty
 * minutes long; this module gives it the same lifetime and keeps it in the
 * server's own memory. The browser holds one opaque id and nothing else.
 *
 * Memory rather than a store, deliberately: the credential must not outlive the
 * process that minted it, and a purchase that survives a restart would present
 * a quote whose capacity check is long gone. One web process serves the demo.
 * Recorded in docs/DECISIONS.md.
 */

const COOKIE = 'creance_purchase';

/** The credential's own life, CREDENTIAL_TTL_SECONDS in .env.example. */
const TTL_MS = 30 * 60 * 1000;

export interface PurchaseSession {
  /** The occupation group key chosen on the picker. */
  group: string | null;
  /** The cover amount in whole units, as the slider carries it. */
  limit: number | null;
  /** The quote the Pay sheet is about to bind. */
  quoteId: string | null;
  /** That quote's premium, so a re-price can tell whether the price moved. */
  premiumMinorUnits: string | null;
  /** The eligibility credential. Server side only, never sent to a browser. */
  credential: string | null;
  credentialExpiresAt: string | null;
  /**
   * The nullifier the interim issuer is asked for, fresh per purchase. Unused
   * on the World path, where it comes out of the proof inside the API and the
   * web app never sees it.
   */
  nullifier: string;
  /** Set once the bind returns. Home reads the policy from it. */
  policyId: string | null;
  /**
   * The wallet the cover binds to, or null for the demo wallet.
   *
   * Set when somebody connects their own wallet at the payment step, and read
   * by every call that names a wallet: the quote, the eligibility credential
   * and, through the credential, the account the policy NFT is minted to. Null
   * is the whole of the unchanged path, so a person who never opens the chooser
   * gets exactly what they got before.
   *
   * It is here and not in a cookie for the same reason the credential is: the
   * account a cover is bound to decides where a payout lands, and a value the
   * browser holds is a value the browser can change.
   */
  wallet: WalletAccount | null;
  /**
   * Whether that wallet will accept the policy NFT without associating the
   * collection by hand. Read at connect time, said on the pay sheet. Always
   * true for the demo wallet, which has unlimited automatic association.
   */
  walletHoldsReceipt: boolean;
}

interface Entry {
  expiresAt: number;
  value: PurchaseSession;
}

const sessions = new Map<string, Entry>();

function prune(now: number): void {
  for (const [id, entry] of sessions) {
    if (entry.expiresAt <= now) sessions.delete(id);
  }
}

/**
 * A decimal integer string, which is what the interim issuer takes and what a
 * World ID nullifier hash is. Never hex: the API refuses hex outright rather
 * than parsing it as decimal and binding the wrong person.
 *
 * A fresh one per purchase, because one active policy per nullifier per series
 * is enforced at bind and every repeated run of the flow would otherwise be
 * refused as already covered. A real World ID does not get that courtesy, which
 * is the point of the rule.
 */
export function freshNullifier(): string {
  return BigInt(`0x${randomBytes(31).toString('hex')}`).toString();
}

function emptySession(): PurchaseSession {
  return {
    group: null,
    limit: null,
    quoteId: null,
    premiumMinorUnits: null,
    credential: null,
    credentialExpiresAt: null,
    nullifier: freshNullifier(),
    policyId: null,
    wallet: null,
    walletHoldsReceipt: true,
  };
}

/**
 * The session behind the request's cookie, or null. Safe to call while
 * rendering: it only reads.
 */
export async function readPurchase(): Promise<PurchaseSession | null> {
  const id = (await cookies()).get(COOKIE)?.value;
  if (id === undefined) return null;
  const now = Date.now();
  prune(now);
  return sessions.get(id)?.value ?? null;
}

/**
 * Starts a purchase and returns its empty session. Sets a cookie, so it may
 * only be called from a server action or a route handler.
 */
export async function startPurchase(): Promise<PurchaseSession> {
  const id = randomBytes(24).toString('base64url');
  const value = emptySession();
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
 * Applies a patch to the session behind the request's cookie, starting one when
 * there is none, so a step of the flow never fails on a session that quietly
 * expired between two screens.
 */
export async function updatePurchase(
  patch: Partial<PurchaseSession>,
): Promise<PurchaseSession> {
  const id = (await cookies()).get(COOKIE)?.value;
  const existing = id === undefined ? undefined : sessions.get(id);
  if (id === undefined || existing === undefined) {
    const started = await startPurchase();
    Object.assign(started, patch);
    return started;
  }
  Object.assign(existing.value, patch);
  existing.expiresAt = Date.now() + TTL_MS;
  return existing.value;
}

/** Forgets the purchase and its credential. */
export async function endPurchase(): Promise<void> {
  const store = await cookies();
  const id = store.get(COOKIE)?.value;
  if (id !== undefined) sessions.delete(id);
  store.delete(COOKIE);
}

/** Test seam. Nothing in the app calls this. */
export function clearAllPurchases(): void {
  sessions.clear();
}
