/**
 * The review queue's endpoints, and the one read the claimant's own screen
 * borrows from them.
 *
 * Two callers, one token. The admin review queue at /admin/claims is the
 * reviewer's screen and reads the queue as itself. Screen C9 is the claimant's
 * and reads exactly one field: `reason_lines`, the sentences a decline is
 * printed from.
 *
 * Why C9 has to come through here. The decline sentences carry dates and
 * sometimes an employer name, so `GET /v1/claims/:id` deliberately does not
 * carry them and `GET /v1/admin/claims/:id` does (docs/CLAIMS.md, "The
 * claimant's own read"). The web server already holds the API origin as a
 * private variable, so it holds the admin token the same way, and it reads the
 * admin payload only for a claim id in this browser's own server side session:
 * the session is what proves this browser submitted that claim. Nothing but
 * the sentences crosses to the client. Recorded in docs/DECISIONS.md.
 *
 * ADMIN_TOKEN is a private server variable and never a NEXT_PUBLIC one. The
 * web image inlines NEXT_PUBLIC values at build time, so a token there would
 * be in the bundle a judge can read.
 */

import { getJson, postJson, type Money } from './api';
import { serverVar } from './server-env';

/** One row of the queue. It carries nothing about a person, by design. */
export interface AdminClaimSummary {
  readonly claim_id: string;
  readonly policy_id: string;
  readonly series_id: string;
  readonly status: string;
  readonly submitted_at: string | null;
  readonly decision: string | null;
  readonly confidence: string | null;
  readonly reasons: readonly string[];
  /** Waiting for a person for more than a working day. Flagged, never decided. */
  readonly overdue: boolean;
}

export interface AdminQueue {
  readonly status: string;
  readonly count: number;
  readonly claims: readonly AdminClaimSummary[];
}

/** The review screen in one request. The only payload that names a person. */
export interface AdminClaimDetail {
  readonly claim_id: string;
  readonly policy_id: string;
  readonly series_id: string;
  readonly status: string;
  readonly submitted_at: string;
  readonly packet_hash: string | null;
  readonly attestation: {
    readonly full_name: string | null;
    readonly employer_name: string;
    readonly job_title: string;
    readonly group: string;
    readonly last_day_of_work: string;
    readonly separation_type: string;
    readonly statement_accepted: boolean;
    readonly method: string | null;
    readonly signature_verified: boolean;
  };
  readonly evidence: readonly {
    readonly evidence_id: string;
    readonly kind: string;
    readonly filename: string;
    readonly content_type: string;
    readonly size: number;
    readonly sha256: string;
    readonly sha256_seen_in_other_claims: boolean;
  }[];
  readonly policy: Record<string, unknown>;
  readonly decision: string | null;
  readonly reasons: readonly string[];
  /** The sentences the person reads. Here and in no free response. */
  readonly reason_lines: readonly { readonly code: string; readonly line: string }[];
  readonly resubmit: { readonly allowed: boolean; readonly why: string } | null;
  readonly decision_record: Record<string, unknown> | null;
}

export interface DecideResult {
  readonly claim_id: string;
  readonly status: string;
  readonly decision: string | null;
  readonly decision_hash: string | null;
  readonly idempotent: boolean;
  /**
   * The payout runs inside an approval and can refuse without failing the
   * decision, the realistic reason on Hedera being a wallet that has not
   * associated the settlement token. The screen shows what happened either way.
   */
  readonly payout?: {
    readonly paid: boolean;
    readonly reason?: string;
    readonly transactionHash?: string;
    readonly amount?: Money;
  };
}

/**
 * The reviewer's token, from the process environment or from the repository's
 * own environment file.
 *
 * The same loader src/lib/payer.ts uses and for the same reason: the framework
 * reads environment files from the application directory and the one file in
 * this repository sits at the root. Loading does not overwrite a variable
 * already set, so a deployment that puts the token in the process environment
 * is unaffected, and a clone with no file at all simply has no queue.
 */
export function adminToken(): string | null {
  return serverVar('ADMIN_TOKEN');
}

/** This deployment can read the queue. The screen says so when it cannot. */
export function hasAdminToken(): boolean {
  return adminToken() !== null;
}

function bearer(): string {
  const token = adminToken();
  if (token === null) {
    throw new Error('this deployment holds no admin token, so it cannot read the review queue');
  }
  return token;
}

export function fetchAdminQueue(status = 'under_review', limit = 20): Promise<AdminQueue> {
  return getJson<AdminQueue>(
    `/v1/admin/claims?status=${encodeURIComponent(status)}&limit=${String(limit)}`,
    { bearer: bearer() },
  );
}

export function fetchAdminClaim(claimId: string): Promise<AdminClaimDetail> {
  return getJson<AdminClaimDetail>(`/v1/admin/claims/${encodeURIComponent(claimId)}`, {
    bearer: bearer(),
  });
}

/**
 * A decision and the one plain sentence the person will read.
 *
 * The sentence is not optional on a decline: the API refuses a refer or a
 * decline with no reason, because a decision nobody can act on is not a
 * decision. The approval branch runs the payout in the same request.
 */
export function decideClaim(
  claimId: string,
  decision: 'approve' | 'decline' | 'refer',
  reason: string,
): Promise<DecideResult> {
  return postJson<DecideResult>(
    `/v1/admin/claims/${encodeURIComponent(claimId)}/decide`,
    { decision, reason },
    { bearer: bearer() },
  );
}

/**
 * The sentences behind one decision, for the claimant's own screen.
 *
 * Empty when this deployment holds no token or the payload cannot be read, so
 * C9 falls back to the reason codes rather than failing. The caller must
 * already have proved the claim belongs to this browser.
 */
export async function decisionSentences(claimId: string): Promise<string[]> {
  if (adminToken() === null) return [];
  try {
    const detail = await fetchAdminClaim(claimId);
    return detail.reason_lines.map((entry) => entry.line);
  } catch {
    return [];
  }
}
