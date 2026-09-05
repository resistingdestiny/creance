import { issueEligibility } from './worker-api';
import type { WalletAccount } from './wallet';

/**
 * How the purchase flow earns an eligibility credential, behind one interface.
 *
 * DESIGN.md 3.6 is the real thing: IDKit with the selfieCheckLegacy preset, the
 * signal set to the wallet id, an rp_context signed by the backend, the whole
 * IDKit result forwarded to World's verify endpoint, and a thirty minute JWT
 * back. That is T11's ticket.
 *
 * There is no World app id in this environment (WORLD_APP_ID is blank in
 * .env.example), so what ships today is the interim issuer the API already
 * carries, POST /v1/demo/eligibility, which mints the same credential without a
 * Selfie Check. The screen says so plainly rather than imitating the IDKit
 * widget, and everything else in the flow is unchanged: the credential is single
 * use, it carries the nullifier, the group and the wallet, and /v1/bind checks
 * it the same way whichever issuer minted it.
 *
 * T11 replaces this file's `demoIssuer` with a World-backed implementation of
 * the same interface. Nothing else in the web app knows which one it got.
 *
 * https://docs.world.org/world-id/id/cloud
 */

export interface EligibilityRequest {
  readonly group: string;
  /** The signal a check is bound to is the wallet's account id (DESIGN.md 3.6). */
  readonly wallet: WalletAccount;
  /** A decimal integer string. The World ID nullifier hash, in the real flow. */
  readonly nullifier: string;
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

/** The interim issuer. Labelled everywhere it shows, as the demo wallet is. */
export const demoIssuer: EligibilityIssuer = {
  kind: 'demo',
  async issue(request) {
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
 * The issuer in use. There is one today; the World path needs an app id in the
 * environment before it can be built, so asking for it now would fail loudly
 * rather than quietly minting a credential nobody checked a face for.
 */
export function activeIssuer(): EligibilityIssuer {
  return demoIssuer;
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
