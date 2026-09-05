import { money, type Money } from '@creance/client';

import type { Decision } from './rule.js';

/// The agent journal.
///
/// DESIGN.md 3.7 ends the Steward's loop at "write a journal entry to the
/// agent-journal topic", and 3.1 makes the journal the agent's public record.
/// The topic (0.0.10366475 in docs/HEDERA.md) has no submit key and is public
/// by design, so the Steward writes to it directly and anybody can read it back
/// without asking us.
///
/// One message per cycle, whatever the cycle decided. A run that holds is as
/// much of an audit record as a run that buys, and an agent that only journals
/// its purchases is advertising rather than reporting.
///
/// Conventions, following the payments topic: a `v`, a `kind`, every amount as
/// an integer string in the asset's minor units with the scale beside it, RFC
/// 3339 UTC for the instant, and nothing derived from a person. There is no
/// nullifier and no credential here: the topic is public and the eligibility
/// credential belongs to the principal, not to the agent.
///
/// Field names are snake_case throughout, which is the convention the API's own
/// payloads use. The message is one JSON object, serialised with the keys in
/// the order below and no whitespace, and it is refused rather than chunked if
/// it goes over the 1 KB an HCS message carries.

export const JOURNAL_MESSAGE_VERSION = 1;

/** The HCS message cap is roughly 1 KB. The same number apps/api refuses at. */
export const MAX_JOURNAL_MESSAGE_BYTES = 1024;

/** One created premium schedule, as a reader needs it to find the schedule. */
export interface JournalSchedule {
  id: string;
  period: number;
}

/** The three x402 settlements of one buying cycle, by the call each paid for. */
export interface JournalSettlements {
  index: string;
  quote?: string;
  premium?: string;
}

export interface JournalMessage {
  v: number;
  kind: 'journal';
  at: string;
  agent: string;
  principal: { wallet: string; group: string };
  /** Where the eligibility credential came from. Never the credential itself. */
  eligibility: string;
  rule: {
    as_of: string;
    periods: string[];
    odi: string[];
    rising: boolean;
    cover_in_force: boolean;
    at_renewal: boolean;
    decision: 'buy' | 'hold';
    reason: string;
    /** True when the rule stood in an earlier month than the newest reading. */
    replay: boolean;
  };
  settlements: JournalSettlements;
  quote_id?: string;
  policy_id?: string;
  nft?: { token_id: string | null; serial: number | null };
  premium?: Money;
  cadence?: string;
  schedules?: JournalSchedule[];
  /** Periods the 62 day cap left for the watcher, so a reader can see the gap. */
  deferred?: number[];
}

export interface BoundCycle {
  quoteId: string;
  policyId: string;
  nft: { tokenId: string | null; serial: number | null };
  premium: { amount: string; asset: string; decimals: number };
  cadence: string;
  schedules: JournalSchedule[];
  deferred: number[];
}

export interface JournalInput {
  agent: string;
  principal: { wallet: string; group: string };
  eligibility: string;
  decision: Decision;
  replay: boolean;
  settlements: JournalSettlements;
  bound?: BoundCycle | undefined;
  at?: Date | undefined;
}

/** Build the message. Pure, so its shape and its size are tested chain-free. */
export function journalMessage(input: JournalInput): JournalMessage {
  const { decision } = input;
  const message: JournalMessage = {
    v: JOURNAL_MESSAGE_VERSION,
    kind: 'journal',
    at: (input.at ?? new Date()).toISOString(),
    agent: input.agent,
    principal: input.principal,
    eligibility: input.eligibility,
    rule: {
      as_of: decision.trend.asOf,
      periods: decision.trend.periods,
      odi: decision.trend.odi,
      rising: decision.trend.rising,
      cover_in_force: decision.coverInForce,
      at_renewal: decision.atRenewal,
      decision: decision.buy ? 'buy' : 'hold',
      reason: decision.reason,
      replay: input.replay,
    },
    settlements: input.settlements,
  };
  const bound = input.bound;
  if (bound !== undefined) {
    message.quote_id = bound.quoteId;
    message.policy_id = bound.policyId;
    message.nft = { token_id: bound.nft.tokenId, serial: bound.nft.serial };
    message.premium = money(bound.premium.amount, bound.premium.asset, bound.premium.decimals);
    message.cadence = bound.cadence;
    message.schedules = bound.schedules;
    message.deferred = bound.deferred;
  }
  return message;
}

/** The bytes that go on the topic, refused rather than chunked when too long. */
export function encodeJournalMessage(message: JournalMessage): string {
  const text = JSON.stringify(message);
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes > MAX_JOURNAL_MESSAGE_BYTES) {
    throw new Error(
      `the journal entry is ${bytes} bytes, over the ${MAX_JOURNAL_MESSAGE_BYTES} cap`,
    );
  }
  return text;
}
