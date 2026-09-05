import { serverVar } from './server-env';
import { issueEligibility, verifyWorldCheck } from './worker-api';
import type { WalletAccount } from './wallet';

/**
 * How the purchase flow earns an eligibility credential, behind one interface.
 *
 * DESIGN.md 3.6 is the real thing and it is what ships: IDKit with the
 * selfieCheckLegacy preset, the signal set to the wallet id, an rp_context
 * signed by the backend, the whole IDKit result forwarded to World's verify
 * endpoint, and a thirty minute JWT back. That is `worldIssuer`, and it holds
 * no World configuration of its own: the API signs the request context and
 * checks the result, so nothing here needs an app id beyond knowing whether
 * one exists.
 *
 * `demoIssuer` stays for a clone with no World app in its environment, and for
 * the testnet bind script and the Steward, neither of which has a camera. It is
 * labelled everywhere it shows.
 *
 * Nothing else in the web app knows which issuer it got. The credential is
 * single use, it carries the nullifier, the group and the wallet, and /v1/bind
 * checks it the same way whichever issuer minted it.
 *
 * https://docs.world.org/world-id/idkit/credentials
 */

export interface EligibilityRequest {
  readonly group: string;
  /** The signal a check is bound to is the wallet's account id (DESIGN.md 3.6). */
  readonly wallet: WalletAccount;
  /**
   * The completed IDKit result, forwarded whole. The World path needs it; the
   * nullifier comes out of the proof inside the API and never reaches here.
   */
  readonly proof?: unknown;
  /** A decimal integer string, the interim issuer's stand-in for a nullifier. */
  readonly nullifier?: string;
}

export interface EligibilityCredential {
  /** The JWT. Server side only. */
  readonly credential: string;
  readonly expiresAt: string;
  readonly seriesId: string;
  /** Which issuer minted it, so a screen can say what a judge is looking at. */
  readonly issuer: string;
}

export interface EligibilityIssuer {
  readonly kind: 'demo' | 'world';
  issue(request: EligibilityRequest): Promise<EligibilityCredential>;
}

/** The Selfie Check. The result goes to the API, which forwards it to World. */
export const worldIssuer: EligibilityIssuer = {
  kind: 'world',
  async issue(request) {
    if (request.proof === undefined) {
      throw new Error('the World issuer needs the IDKit result to forward');
    }
    const issued = await verifyWorldCheck({
      group: request.group,
      wallet: request.wallet.accountId,
      wallet_evm: request.wallet.evmAddress,
      result: request.proof,
    });
    return {
      credential: issued.eligibility,
      expiresAt: issued.expires_at,
      seriesId: issued.series_id,
      issuer: issued.issuer,
    };
  },
};

/** The interim issuer. Labelled everywhere it shows, as the demo wallet is. */
export const demoIssuer: EligibilityIssuer = {
  kind: 'demo',
  async issue(request) {
    if (request.nullifier === undefined) {
      throw new Error('the interim issuer needs a nullifier to mint against');
    }
    const issued = await issueEligibility({
      group: request.group,
      wallet: request.wallet.accountId,
      wallet_evm: request.wallet.evmAddress,
      nullifier: request.nullifier,
    });
    return {
      credential: issued.eligibility,
      expiresAt: issued.expires_at,
      seriesId: issued.series_id,
      issuer: issued.issuer,
    };
  },
};

/**
 * Whether this deployment has a World ID app to run a check against.
 *
 * A private variable, read through src/lib/server-env.ts, and only ever on the
 * server: the browser never learns the app id from here, it gets it with the
 * signed request context.
 */
export function worldAppId(): string | null {
  return serverVar('WORLD_APP_ID');
}

/**
 * The issuer in use. The World path the moment there is an app id to run it
 * against; the interim one otherwise, rather than a screen that offers a check
 * nothing can answer.
 */
export function activeIssuer(): EligibilityIssuer {
  return worldAppId() === null ? demoIssuer : worldIssuer;
}

/** True while the credential comes from the interim issuer. The screen says so. */
export function isInterimIssuer(): boolean {
  return activeIssuer().kind === 'demo';
}

export function issueEligibilityFor(
  request: EligibilityRequest,
): Promise<EligibilityCredential> {
  return activeIssuer().issue(request);
}
