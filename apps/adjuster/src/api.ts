import type { ExtractionResult } from './extraction.js';
import type { DecisionRecord } from './record.js';
import type { RuleResult } from './rules.js';

/// The Adjuster is an admin client.
///
/// It authenticates with its own admin token, reads the queue over HTTP, and
/// posts its decision to the same endpoint a human posts to. It does not touch
/// Postgres, does not hold the CLAIMS key and does not sign the authorisation.
/// If it did any of those, the human review path would be a second
/// implementation of the same flow and would be untested at the moment it is
/// needed.
///
/// The API is the only writer of the database, which is what the schema's own
/// comments say. The one thing the Adjuster does hold is the claims topic's
/// submit key, because that topic's submit key is the adjuster account's and
/// the API cannot write it at all.

/** The admin payload, snake_case, exactly as `GET /v1/admin/claims/:id` returns it. */
export interface AdminClaim {
  claim_id: string;
  policy_id: string;
  series_id: string;
  status: string;
  submitted_at: string;
  packet_hash: string | null;
  /** A decimal string. Never leaves the API in any other response. */
  nullifier: string;
  attestation: {
    full_name: string | null;
    employer_name: string;
    job_title: string;
    group: string;
    last_day_of_work: string;
    separation_type: string;
    statement_accepted: boolean;
    method: 'eip191' | 'hedera_sign_message' | 'unsigned_accepted' | null;
    signature_verified: boolean;
  };
  world: { presence: boolean; verified_at: string | null; action: string };
  evidence: {
    evidence_id: string;
    kind: string;
    filename: string;
    content_type: string;
    size: number;
    sha256: string;
    sha256_seen_in_other_claims: boolean;
    href: string;
  }[];
  policy: {
    policy_id: string;
    series_id: string;
    group: string;
    limit: string;
    asset: string;
    asset_decimals: number;
    starts_at: string;
    ends_at: string;
    claims_payable_from: string;
    status: string;
    nullifier: string;
  };
  series: {
    series_id: string;
    payout_mode: 'full' | 'indexed';
    lookback_months: number;
    waiting_period_days: number;
    claim_window_obs_days: number;
    claim_window_sep_days: number;
    auto_approval_limit: string;
    auto_approval_confidence: number;
  };
  window: {
    open_months: string[];
    last_observed_month: string | null;
    qualifying_month: string | null;
    claim_deadline: string | null;
  };
  /** Other non-void claims for this person in this series. */
  prior_claims: number;
  decision: string | null;
  decision_record: DecisionRecord | null;
}

export interface AdminClaimSummary {
  claim_id: string;
  policy_id: string;
  series_id: string;
  status: string;
  submitted_at: string;
  decision: string | null;
  confidence: string | null;
  reasons: string[];
  /** True when the claim has been waiting for a human for more than a day. */
  overdue: boolean;
}

export interface DecisionPost {
  decision: 'approve' | 'refer' | 'decline';
  /** One sentence, shown to the person. Required on a human decision. */
  reason?: string;
  reasons?: string[];
  reason_lines?: { code: string; line: string }[];
  resubmit?: { allowed: boolean; why: string };
  confidence?: string | null;
  record?: DecisionRecord;
  decision_hash?: string;
  hcs_decision_seq?: number | null;
  rule_results?: RuleResult[];
}

export interface DecisionAccepted {
  claim_id: string;
  status: string;
  decision: string;
  decision_hash: string | null;
  hcs_decision_seq: number | null;
  /** True when a decision for this claim already existed and was kept. */
  idempotent: boolean;
}

/** A refusal from the API, carrying the problem document's own code. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function readBody<T>(response: Response, what: string, expected: number[]): Promise<T> {
  const text = await response.text();
  if (!expected.includes(response.status)) {
    let problem: { code?: string; title?: string; detail?: string } = {};
    try {
      problem = JSON.parse(text) as typeof problem;
    } catch {
      problem = {};
    }
    const code = problem.code ?? String(response.status);
    throw new ApiError(
      response.status,
      code,
      `${what} answered ${response.status} ${code}: ${problem.detail ?? text.slice(0, 200)}`,
    );
  }
  return JSON.parse(text) as T;
}

export class AdjusterApi {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { authorization: `Bearer ${this.token}`, accept: 'application/json', ...extra };
  }

  async queue(status: string, limit = 20): Promise<AdminClaimSummary[]> {
    const url = `${this.baseUrl}/v1/admin/claims?status=${encodeURIComponent(status)}&limit=${limit}`;
    const response = await this.fetchImpl(url, { headers: this.headers() });
    const body = await readBody<{ claims: AdminClaimSummary[] }>(response, 'the claim queue', [200]);
    return body.claims;
  }

  async claim(claimId: string): Promise<AdminClaim> {
    const response = await this.fetchImpl(`${this.baseUrl}/v1/admin/claims/${claimId}`, {
      headers: this.headers(),
    });
    return await readBody<AdminClaim>(response, `the claim ${claimId}`, [200]);
  }

  /** The decrypted file. The API holds the key; the Adjuster never sees one. */
  async evidence(claimId: string, evidenceId: string): Promise<Buffer> {
    const response = await this.fetchImpl(
      `${this.baseUrl}/v1/admin/claims/${claimId}/evidence/${evidenceId}`,
      { headers: this.headers({ accept: '*/*' }) },
    );
    if (response.status !== 200) {
      throw new ApiError(response.status, 'evidence_unavailable', `evidence ${evidenceId} answered ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  /**
   * The decision.
   *
   * The idempotency key is the claim id and the packet hash, so two Adjuster
   * instances, or one instance run twice by a nervous operator during a demo,
   * produce one decision. A 409 saying the claim is no longer decidable is not
   * an error: it means a human decided it first, which is allowed and expected.
   */
  async decide(claimId: string, packetHash: string | null, post: DecisionPost): Promise<DecisionAccepted> {
    const response = await this.fetchImpl(`${this.baseUrl}/v1/admin/claims/${claimId}/decide`, {
      method: 'POST',
      headers: this.headers({
        'content-type': 'application/json',
        'idempotency-key': `adj:${claimId}:${packetHash ?? 'none'}`,
      }),
      body: JSON.stringify(post),
    });
    return await readBody<DecisionAccepted>(response, `the decision on ${claimId}`, [200, 201]);
  }

  /**
   * The decisions whose hash has not reached the claims topic yet.
   *
   * A reviewer's decision is stored with its record and its hash, and the API
   * cannot publish it because the topic's submit key is the adjuster account's.
   * So the Adjuster sweeps this at the end of a pass, which keeps "every
   * decision is on a public topic" true for the human half of the queue as well
   * as the machine half.
   */
  async unpublished(limit = 20): Promise<UnpublishedDecision[]> {
    return (await this.pending(limit)).claims;
  }

  /** The packets whose hash has not reached the topic. Published first in a pass. */
  async unpublishedPackets(limit = 20): Promise<UnpublishedPacket[]> {
    return (await this.pending(limit)).packets;
  }

  private async pending(
    limit: number,
  ): Promise<{ claims: UnpublishedDecision[]; packets: UnpublishedPacket[] }> {
    const response = await this.fetchImpl(
      `${this.baseUrl}/v1/admin/claims/unpublished?limit=${limit}`,
      { headers: this.headers() },
    );
    const body = await readBody<{
      claims: UnpublishedDecision[];
      packets?: UnpublishedPacket[];
    }>(response, 'the unpublished decisions', [200]);
    return { claims: body.claims, packets: body.packets ?? [] };
  }

  /** Where a decision reached the topic. Touches no other column. */
  async published(claimId: string, sequenceNumber: number): Promise<void> {
    const response = await this.fetchImpl(`${this.baseUrl}/v1/admin/claims/${claimId}/published`, {
      method: 'POST',
      headers: this.headers({ 'content-type': 'application/json' }),
      body: JSON.stringify({ hcs_decision_seq: sequenceNumber }),
    });
    await readBody(response, `the sequence number for ${claimId}`, [200]);
  }

  /** Where a packet hash reached the topic. The same endpoint, the other column. */
  async publishedPacket(claimId: string, sequenceNumber: number): Promise<void> {
    const response = await this.fetchImpl(`${this.baseUrl}/v1/admin/claims/${claimId}/published`, {
      method: 'POST',
      headers: this.headers({ 'content-type': 'application/json' }),
      body: JSON.stringify({ hcs_submitted_seq: sequenceNumber }),
    });
    await readBody(response, `the packet sequence number for ${claimId}`, [200]);
  }
}

/** One decision waiting for a sequence number. */
export interface UnpublishedDecision {
  claim_id: string;
  policy_id: string;
  decision: 'approve' | 'refer' | 'decline';
  decision_hash: string;
}

/**
 * One packet waiting for the topic.
 *
 * The API writes the packet hash into the claim row when the packet arrives and
 * cannot publish it: the claims topic's submit key is this account's. So the
 * pass publishes it, at the start rather than the end, which is what keeps the
 * packet hash public before the decision hash that answers it.
 */
export interface UnpublishedPacket {
  claim_id: string;
  policy_id: string;
  packet_hash: string;
  /** One SHA-256 per evidence file, in the order the packet lists them. */
  evidence: string[];
}

/** The recorded extractions a fixture or a dry run replays. */
export type RecordedExtractions = Record<string, ExtractionResult>;
