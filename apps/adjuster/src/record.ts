import { createHash } from 'node:crypto';

import { canonicalize, type JsonValue } from '@creance/index-model';

import type { ConfidenceComponents } from './confidence.js';
import { EXTRACTION_SCHEMA_VERSION } from './extraction.js';
import { PROMPT_VERSION } from './prompt.js';
import { RULES_VERSION, type RuleResult } from './rules.js';

/// The decision record: one per decision, and safe to publish in full.
///
/// No name, no employer, no job title, no file name, no nullifier, no wallet.
/// That is a design rule and not an accident: the hash of this record is on a
/// public topic forever, a judge may reasonably ask to see the thing behind the
/// hash, and the answer should be "here it is" rather than a redaction
/// exercise. The identifying material stays in Postgres, encrypted, and the
/// admin screen reads it from there.
///
/// The canonical form is JCS (RFC 8785): sorted keys, no whitespace, UTF-8,
/// the same convention apps/oracle/src/message.ts signs over. `decision_hash`
/// is sha256 of exactly those bytes. It has to be reproducible because the
/// CLAIMS role signs over it (docs/HEDERA.md, ABI conventions), so a second
/// implementation given this record must arrive at the same hex.

export const DECISION_RECORD_VERSION = 1;

export interface DecisionAmount {
  /** Minor units, a decimal string, never a JavaScript number. */
  amount: string;
  asset: string;
  decimals: number;
}

export interface DecisionEngine {
  rules_version: string;
  extraction_schema: string;
  prompt_version: string;
  /** Null on a human decision: a reviewer ran no model. */
  model: string | null;
  effort: string | null;
}

export interface DecisionHuman {
  reviewed_at: string;
  /** The rule ids a reviewer decided against. */
  overrode: string[];
  /**
   * The hash of the reviewer's note, never the note. The record proves a note
   * existed without publishing one person's words about another.
   */
  note_hash: string;
}

export interface DecisionRecord {
  v: number;
  type: 'adjuster_decision';
  claim_id: string;
  policy_id: string;
  series_id: string;
  packet_hash: string | null;
  actor: string;
  decided_at: string;
  engine: DecisionEngine;
  decision: 'approve' | 'refer' | 'decline';
  reasons: string[];
  amount: DecisionAmount | null;
  separation_month: string;
  qualifying_month: string | null;
  open_months_considered: string[];
  claim_deadline: string | null;
  confidence: string | null;
  confidence_components: ConfidenceComponents | null;
  evidence: {
    sha256: string;
    kind_claimed: string;
    kind_extracted: string | null;
    deciding: boolean;
  }[];
  rule_results: RuleResult[];
  human: DecisionHuman | null;
  /** The hash of the record this one replaces, when a claim was resubmitted. */
  supersedes?: string;
}

export const ENGINE_MODEL_ID = 'claude-opus-5';
export const ENGINE_EFFORT = 'medium';

/** The engine block the Adjuster stamps on every record it writes. */
export function adjusterEngine(model: string = ENGINE_MODEL_ID, effort = ENGINE_EFFORT): DecisionEngine {
  return {
    rules_version: RULES_VERSION,
    extraction_schema: EXTRACTION_SCHEMA_VERSION,
    prompt_version: PROMPT_VERSION,
    model,
    effort,
  };
}

/** The engine block on a human decision. A reviewer ran no model. */
export function reviewerEngine(): DecisionEngine {
  return {
    rules_version: RULES_VERSION,
    extraction_schema: EXTRACTION_SCHEMA_VERSION,
    prompt_version: PROMPT_VERSION,
    model: null,
    effort: null,
  };
}

/** The exact bytes the hash covers: the JCS form of the record, UTF-8. */
export function canonicalRecord(record: DecisionRecord): string {
  return canonicalize(record as unknown as JsonValue);
}

/** `sha256:<hex>` over the canonical form, the value that reaches the topic. */
export function decisionHash(record: DecisionRecord): string {
  return `sha256:${createHash('sha256').update(canonicalRecord(record), 'utf8').digest('hex')}`;
}

/** The same prefixed form for any other hash the record or a message carries. */
export function sha256Prefixed(data: Buffer | string): string {
  return `sha256:${createHash('sha256').update(data).digest('hex')}`;
}
