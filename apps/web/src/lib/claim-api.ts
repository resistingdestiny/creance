/**
 * The claim endpoints, as the web app sees them.
 *
 * Six calls make the claim flow, and all six are the API as it stands
 * (apps/api/src/claims, apps/api/src/world/routes.ts, apps/api/src/replay):
 *
 *   POST /v1/world/rp-context   a signed context for the claim action
 *   POST /v1/world/verify       the completed check, and the claim credential
 *   POST /v1/demo/claim-presence  the labelled demo path, for a host with no camera
 *   POST /v1/claims             the packet: credential, attestation, evidence
 *   GET  /v1/claims/:id         free and pollable, and what C6 waits on
 *   GET  /v1/replay             the demo clock, for the replay badge
 *
 * All of them are called on the server, like every other read in this app. The
 * claim credential is a bearer token that submits a packet in the holder's
 * name, so it never reaches the browser: it is held in the claim session and
 * attached here. See src/lib/claim-session.ts.
 *
 * The free read deliberately carries no `reason_lines`. They hold dates and
 * sometimes an employer name, so they are served only from the admin payload
 * (docs/CLAIMS.md, "The claimant's own read"). src/lib/admin-api.ts is how C9
 * gets them for a claim this browser submitted.
 */

import { getJson, postJson, type Money } from './api';

/** The identity leg's credential, from either issuer. */
export interface ClaimCredentialView {
  readonly claim_credential: string;
  readonly jti: string;
  readonly policy_id: string;
  readonly series_id: string;
  readonly group: string;
  readonly expires_at: string;
  readonly issuer: string;
  /** Present on the demo path, and printed on screen when it is. */
  readonly warning?: string;
}

/** POST /v1/claims, on success. The screen only reads the id and the hash. */
export interface ClaimReceiptView {
  readonly claim_id: string;
  readonly policy_id: string;
  readonly status: string;
  readonly packet_hash: string | null;
  readonly submitted_at: string;
  readonly evidence: readonly {
    readonly evidence_id: string;
    readonly kind: string;
    readonly filename: string;
    readonly sha256: string;
    readonly size: number;
  }[];
  readonly window: {
    readonly qualifying_month: string | null;
    readonly claim_deadline: string | null;
  };
}

/** GET /v1/claims/:id. Free, pollable, and carries nothing about a person. */
export interface ClaimStatusView {
  readonly claim_id: string;
  readonly policy_id: string;
  readonly series_id: string;
  readonly status: 'submitted' | 'under_review' | 'approved' | 'declined' | 'paid';
  readonly decision: 'approve' | 'refer' | 'decline' | null;
  /** Codes, not sentences. The sentences come with the decision, from admin-api. */
  readonly reasons: readonly string[];
  readonly resubmit: { readonly allowed: boolean } | null;
  readonly amount: Money | null;
  readonly packet_hash: string | null;
  readonly decision_hash: string | null;
  readonly claim_deadline: string | null;
  readonly submitted_at: string | null;
  readonly decided_at: string | null;
  readonly paid_at: string | null;
  readonly hcs: {
    readonly topic_id: string | null;
    readonly packet_sequence_number: number | null;
    readonly decision_sequence_number: number | null;
  };
  readonly payout: { readonly transaction: string; readonly hashscan: string } | null;
}

/** GET /v1/replay. The demo clock, and the label a screen prints. */
export interface ReplayView {
  readonly mode: 'live' | 'replay' | 'scenario';
  readonly running: boolean;
  readonly series: string | null;
  readonly from: string | null;
  readonly to: string | null;
  readonly current_period: string | null;
  readonly latest_published: string | null;
  readonly scenario_label: string | null;
  readonly badge: { readonly show: boolean; readonly label: string } | null;
}

/** One evidence file, as the packet takes it: base64 inside the JSON body. */
export interface ClaimEvidenceBody {
  readonly kind: string;
  readonly filename: string;
  readonly content_base64: string;
}

export interface ClaimAttestationBody {
  readonly full_name: string;
  readonly employer_name: string;
  readonly job_title: string;
  readonly group: string;
  /** YYYY-MM-DD, the calendar date the API and the signed message both read. */
  readonly last_day_of_work: string;
  readonly separation_type: string;
  readonly statement_accepted: true;
  readonly method: 'eip191' | 'unsigned_accepted';
  readonly signature: string;
}

/**
 * A fresh context per widget opening. Never cached: World refuses a reused
 * nonce. The signal at claim is the policy id, not the wallet, so the body
 * carries the policy and the purpose.
 */
export function requestClaimContext(policyId: string): Promise<Record<string, unknown>> {
  return postJson<Record<string, unknown>>('/v1/world/rp-context', {
    purpose: 'claim',
    policy_id: policyId,
  });
}

/** The completed IDKit result, forwarded whole, with the claim purpose. */
export function verifyClaimCheck(body: {
  policy_id: string;
  result: unknown;
}): Promise<ClaimCredentialView> {
  return postJson<ClaimCredentialView>('/v1/world/verify', { purpose: 'claim', ...body });
}

/**
 * The labelled demo presence path.
 *
 * It exists because a camera cannot be automated and the Sandbox App has no
 * Selfie Check (docs/FEEDBACK-WORLD.md section 3). The API answers with a
 * warning saying so, and the screen prints it the way the purchase Verify
 * screen prints its own.
 */
export function demoClaimPresence(policyId: string): Promise<ClaimCredentialView> {
  return postJson<ClaimCredentialView>('/v1/demo/claim-presence', { policy_id: policyId });
}

/** POST /v1/claims, with the claim credential as a bearer token. */
export function submitClaim(
  credential: string,
  body: {
    policy_id: string;
    attestation: ClaimAttestationBody;
    evidence: readonly ClaimEvidenceBody[];
  },
): Promise<ClaimReceiptView> {
  return postJson<ClaimReceiptView>('/v1/claims', body, { bearer: credential });
}

/** GET /v1/claims/:id. Free, so no credential is attached. */
export function fetchClaim(claimId: string): Promise<ClaimStatusView> {
  return getJson<ClaimStatusView>(`/v1/claims/${encodeURIComponent(claimId)}`);
}

/**
 * The demo clock's state, or null when it cannot be read.
 *
 * Null rather than a throw: the badge is decoration and the topic is the
 * record, so a screen that cannot reach the endpoint renders without it rather
 * than failing.
 */
export async function fetchReplay(): Promise<ReplayView | null> {
  try {
    return await getJson<ReplayView>('/v1/replay');
  } catch {
    return null;
  }
}
