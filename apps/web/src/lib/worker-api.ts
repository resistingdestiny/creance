/**
 * The worker endpoints, as the web app sees them.
 *
 * Four calls make the purchase flow, and all four are the API as it stands on
 * main (recipes/bazantic/openapi.yaml, apps/api/src/routes):
 *
 *   POST /v1/world/rp-context  a signed context for one IDKit request
 *   POST /v1/world/verify      the completed Selfie Check, and the credential
 *   POST /v1/demo/eligibility  the interim issuer, for a clone with no World app
 *   POST /v1/quote             the binding price, no capacity hold, 15 minutes
 *   POST /v1/bind              the policy, the NFT receipt and the HCS receipt
 *   GET  /v1/policy/:id        free, and what the app polls for the NFT serial
 *   GET  /v1/index/:group      the latest reading, 24 months and the trigger
 *
 * All of them are called on the server. The eligibility credential is a bearer
 * token that binds a policy, so it never reaches the browser: it is held in the
 * purchase session and attached here. See src/lib/purchase-session.ts.
 *
 * DESIGN.md 3.7 makes the index feed, the quote and the bind paid calls. T08
 * puts the x402 gate in front of them and nothing in this module changes then,
 * because the gate is satisfied by the caller and the caller is the server.
 */

import { getJson, postJson, type Money } from './api';

export interface EligibilityView {
  readonly eligibility: string;
  readonly jti: string;
  readonly series_id: string;
  readonly group: string;
  readonly wallet: string;
  readonly expires_at: string;
  readonly issuer: string;
  readonly warning?: string;
}

/**
 * Everything one IDKit request needs, signed by the API.
 *
 * The web app holds no World configuration of its own: the app id, the action,
 * the preset and the environment come back with the signature, so there is one
 * source for all of them and a rung change is an API restart. The signing key
 * never leaves the API, which is what the World docs require.
 */
export interface WorldRequestContextView {
  readonly app_id: string;
  readonly action: string;
  readonly environment: string;
  readonly preset: string;
  readonly signal: string;
  readonly require_user_presence: boolean;
  readonly rp_id: string;
  readonly nonce: string;
  readonly created_at: number;
  readonly expires_at: number;
  readonly signature: string;
}

export interface QuoteView {
  readonly quote_id: string;
  readonly series_id: string;
  readonly group: string;
  readonly wallet: string;
  readonly limit: Money;
  readonly premium: Money;
  readonly annual_rate_bps: number;
  readonly term_months: number;
  readonly waiting_period_days: number;
  readonly cover_starts: string;
  readonly cover_ends: string;
  readonly claims_payable_from: string;
  readonly first_payment_due: string;
  /** A Hedera account id, not an EVM address. See docs/DECISIONS.md. */
  readonly pays_from: string;
  readonly attachment_shock: string;
  readonly level_line: string;
  readonly payout_mode: string;
  readonly capacity: {
    readonly free_before: string;
    readonly free_after: string;
    readonly used_pct: number;
  };
  readonly expires_at: string;
}

/**
 * Whether a claim can be started, and the sentences to print when it cannot.
 *
 * Present only where `GET /v1/policy/:id` read the chain for it. It is on the
 * free view because "Claims aren't open." is a screen a person sees before
 * they have identified themselves, and the reading behind it is the published
 * index, which is public. The sentences are printed verbatim: they are
 * composed server side so that two screens cannot say the reading differently
 * (docs/CLAIMS.md, "Claims aren't open").
 */
export interface PolicyClaimsBlock {
  readonly open: boolean;
  readonly code: 'claims_open' | 'claims_not_open' | 'policy_not_claimable' | 'already_claimed';
  readonly title: string;
  readonly reason_lines: readonly string[];
  readonly reading: {
    readonly form: 'level' | 'shock';
    readonly distance: string;
    readonly period: string | null;
    readonly attachment_shock: string;
    readonly level_line: string;
    readonly open: boolean;
  } | null;
}

export interface PolicyView {
  readonly policy_id: string;
  readonly series_id: string;
  readonly group: string;
  readonly status: string;
  readonly limit: Money;
  readonly premium: Money;
  readonly cover_starts: string;
  readonly cover_ends: string;
  readonly claims_payable_from: string;
  readonly next_payment_due: string | null;
  readonly paid_through: string;
  readonly holder_account: string;
  readonly nft: { readonly token_id: string | null; readonly serial: number | null };
  readonly hcs_receipt: {
    readonly topic_id: string | null;
    readonly sequence_number: number | null;
  };
  readonly chain: {
    readonly cover_pool: string;
    readonly bind_transaction: string | null;
    readonly hashscan: string | null;
  };
  readonly claims?: PolicyClaimsBlock;
}

export interface IndexReading {
  readonly period: string;
  readonly u_g: string | null;
  readonly u_all: string | null;
  readonly e: string | null;
  readonly ebar: string | null;
  readonly odi: string | null;
}

export interface IndexHistoryPoint extends IndexReading {
  readonly open: boolean;
  readonly open_reason: string | null;
}

export interface IndexView {
  readonly group: string;
  readonly group_label: string;
  readonly series_id: string | null;
  readonly as_of: string;
  readonly reading: IndexReading;
  readonly trigger: {
    readonly attachment_shock: string;
    readonly level_line: string;
    readonly open: boolean;
    readonly open_reason: string | null;
    readonly shock_margin: string | null;
    readonly level_margin: string | null;
  };
  /**
   * Which form is nearer its line, chosen server side so that two screens
   * cannot choose differently. `distance` is the points to a payout: positive
   * is short of the line, negative is past it. See docs/DECISIONS.md, "The
   * headline index figure is whichever form is nearer its line".
   */
  readonly headline: {
    readonly form: 'level' | 'shock';
    readonly distance: string;
    readonly on_the_line: boolean;
    readonly open: boolean;
  } | null;
  readonly history: readonly IndexHistoryPoint[];
  readonly source: {
    readonly series: string | null;
    readonly hash: string | null;
    readonly model_version: string | null;
    readonly replay: boolean;
  };
}

/**
 * The slider is in whole cover amounts and the API is in the settlement
 * asset's minor units, which have six decimals. 5,000 is "5000000000". The
 * conversion is here rather than in a screen because it is the one place a
 * factor of a million can be got wrong.
 */
export function toMinorUnits(amount: number, decimals = 6): string {
  if (!Number.isInteger(amount)) throw new RangeError(`Not a whole cover amount: ${amount}`);
  return (BigInt(amount) * 10n ** BigInt(decimals)).toString();
}

export function issueEligibility(body: {
  group: string;
  wallet: string;
  wallet_evm: string;
  /** A decimal integer string, never hex. The API refuses anything else. */
  nullifier: string;
}): Promise<EligibilityView> {
  return postJson<EligibilityView>('/v1/demo/eligibility', body);
}

/** A fresh context per widget opening. Never cached: World refuses a reused nonce. */
export function requestWorldContext(wallet: string): Promise<WorldRequestContextView> {
  return postJson<WorldRequestContextView>('/v1/world/rp-context', { wallet });
}

/** The completed IDKit result, forwarded whole. The API checks it and World verifies it. */
export function verifyWorldCheck(body: {
  group: string;
  wallet: string;
  wallet_evm: string;
  result: unknown;
}): Promise<EligibilityView> {
  return postJson<EligibilityView>('/v1/world/verify', body);
}

export function requestQuote(body: {
  group: string;
  /** Minor units, as an integer string. Use toMinorUnits. */
  limit: string;
  wallet: string;
}): Promise<QuoteView> {
  return postJson<QuoteView>('/v1/quote', body);
}

export function bindPolicy(quoteId: string, eligibility: string): Promise<PolicyView> {
  return postJson<PolicyView>('/v1/bind', { quote_id: quoteId }, { bearer: eligibility });
}

export function fetchPolicy(id: string): Promise<PolicyView> {
  return getJson<PolicyView>(`/v1/policy/${encodeURIComponent(id)}`);
}

export function fetchIndex(group: string): Promise<IndexView> {
  return getJson<IndexView>(`/v1/index/${encodeURIComponent(group)}`);
}

/**
 * The free index catalogue, `GET /v1/index`.
 *
 * It carries the group keys, the frozen trigger lines and which groups have a
 * reading, and no index values, which is why it costs nothing. The landing page
 * reads it only when the metered reading could not be had: the trigger lines
 * are frozen at issuance and published on the topic, so a page that cannot show
 * this month's reading can still say truthfully what the level is that opens
 * claims. Every other screen takes both from the reading itself.
 */
export interface IndexCatalogueGroup {
  readonly group: string;
  readonly label: string;
  readonly series_id: string | null;
  readonly attachment_shock: string | null;
  readonly level_line: string | null;
  readonly latest_period: string | null;
}

export interface IndexCatalogueView {
  readonly groups: readonly IndexCatalogueGroup[];
}

export function fetchIndexCatalogue(): Promise<IndexCatalogueView> {
  return getJson<IndexCatalogueView>('/v1/index');
}

/**
 * The NFT is minted after `CoverPool.bind` has returned, so a 201 from
 * /v1/bind can carry a null serial and the serial appears a moment later. The
 * API's own comment says the web app polls this endpoint for it, so this is
 * that poll: it never fails the purchase, because the cover is already real by
 * the time the bind responded, and it gives up with whatever the last read
 * said.
 */
export async function waitForSerial(
  policy: PolicyView,
  { attempts = 8, delayMs = 1_500 } = {},
): Promise<PolicyView> {
  let latest = policy;
  for (let attempt = 0; attempt < attempts && latest.nft.serial === null; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    try {
      latest = await fetchPolicy(latest.policy_id);
    } catch {
      return latest;
    }
  }
  return latest;
}
