/**
 * The audit endpoint, as the web app sees it.
 *
 * `GET /v1/audit/:policyId` in apps/api answers from the Hedera Consensus
 * Service topics: the database holds the sequence numbers and the mirror node
 * holds the messages, so what arrives here is what a judge can look up for
 * themselves on HashScan. The receipt screen shows it and adds nothing.
 *
 * The fetch happens on the server, in the route's own render, exactly as the
 * investor screens do (see src/lib/investor-api.ts and docs/DECISIONS.md): the
 * origin is a private variable, not a NEXT_PUBLIC one, so it never reaches the
 * bundle and the API needs no CORS plugin.
 *
 * Amounts are the money envelope, an integer string in the settlement asset's
 * minor units with its scale beside it. `display` is never parsed; the screen
 * formats `amount` through src/lib/format.ts.
 */

import { apiBaseUrl } from './investor-api';

export interface Money {
  readonly amount: string;
  readonly asset: string;
  readonly decimals: number;
  readonly display: string;
}

/** Where an entry came from. `topic` is a message read back off the topic. */
export type AuditSource = 'topic' | 'awaiting_mirror' | 'not_yet_on_topic' | 'mirror_unavailable';

export interface AuditLink {
  readonly id: string;
  readonly hashscan: string;
}

export interface AuditEntry {
  readonly kind: string;
  readonly source: AuditSource;
  readonly at: string | null;
  readonly amount: Money | null;
  readonly hcs: {
    readonly topic_id: string;
    readonly sequence_number: number | null;
    readonly consensus_at: string | null;
    readonly hashscan: string;
  } | null;
  readonly tx: AuditLink | null;
  readonly detail: Record<string, unknown>;
}

export interface AuditTrail {
  readonly policy_id: string;
  readonly series_id: string;
  readonly group: string;
  readonly status: string;
  readonly summary: {
    readonly payments_topic: AuditLink | null;
    readonly claims_topic: AuditLink | null;
    readonly policy_nft: {
      readonly token_id: string | null;
      readonly serial: number | null;
      readonly hashscan: string | null;
    };
    readonly bind_transaction: AuditLink | null;
    readonly cover_pool: AuditLink;
    readonly entries: number;
    readonly entries_on_topic: number;
  };
  readonly entries: readonly AuditEntry[];
}

/** The API answered with a problem document, or could not be reached. */
export class AuditApiError extends Error {
  constructor(
    readonly url: string,
    readonly status: number | null,
    message: string,
  ) {
    super(message);
    this.name = 'AuditApiError';
  }
}

export async function fetchAuditTrail(policyId: string): Promise<AuditTrail> {
  const url = `${apiBaseUrl()}/v1/audit/${encodeURIComponent(policyId)}`;
  let response: Response;
  try {
    // No cache. A payment that has just reached the topic has to show, and a
    // receipt that is one refresh out of date is worse than one that says the
    // API cannot be reached.
    response = await fetch(url, { cache: 'no-store', headers: { accept: 'application/json' } });
  } catch (cause) {
    throw new AuditApiError(url, null, cause instanceof Error ? cause.message : 'no response');
  }
  if (!response.ok) {
    throw new AuditApiError(url, response.status, `the API answered ${response.status}`);
  }
  return (await response.json()) as AuditTrail;
}

/**
 * The payout on a cover, or null when there has not been one.
 *
 * Home's Paid state needs an amount and a date, and the claim behind them
 * belongs to whichever browser submitted it. A cover reopened later, or opened
 * from a link, has no claim session, so the payout is read from the audit trail
 * instead: it is the same payment, read back off the payments topic, and it is
 * free.
 */
export async function fetchPayout(policyId: string): Promise<AuditEntry | null> {
  try {
    const trail = await fetchAuditTrail(policyId);
    return trail.entries.find((entry) => entry.kind === 'payout') ?? null;
  } catch {
    return null;
  }
}
