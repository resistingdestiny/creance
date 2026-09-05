import { describe, expect, it } from 'vitest';

import { FIXTURE_NOW, packetA, packetB } from '../fixtures/index.js';
import { toRuleInput } from '../src/adapt.js';
import { AdjusterApi, type AdminClaim, type DecisionPost } from '../src/api.js';
import type { DecisionPublisher, TopicReceipt } from '../src/chain.js';
import { decide, expectedPayout, formatDate } from '../src/decide.js';
import type { EvidenceFile, Extractor } from '../src/extract.js';
import type { ExtractionResult } from '../src/extraction.js';
import { PROMPT_VERSION, SYSTEM_PROMPT } from '../src/prompt.js';
import { decisionHash, ENGINE_MODEL_ID } from '../src/record.js';
import { runPass } from '../src/run.js';
import type { RuleInput } from '../src/rules.js';

/// The decision path: the auto-approval predicate, the pass, and what the
/// Adjuster does when something it depends on is not there.

const ASSET = { id: '0.0.10366463', decimals: 6 };
const base = packetA();

function input(patch: (draft: RuleInput) => void = () => undefined): RuleInput {
  const draft = toRuleInput(
    structuredClone(base.claim),
    structuredClone(base.extractions),
    FIXTURE_NOW,
  );
  patch(draft);
  return draft;
}

describe('the auto-approval predicate', () => {
  it('approves at the threshold exactly', () => {
    const draft = input((d) => (d.series.autoApprovalConfidence = 0.94));
    expect(decide(draft, { asset: ASSET }).decision).toBe('approve');
  });

  it('refers one thousandth below it', () => {
    const draft = input((d) => (d.series.autoApprovalConfidence = 0.941));
    expect(decide(draft, { asset: ASSET }).decision).toBe('refer');
  });

  it('refers an amount above the series limit, with every rule passing', () => {
    const draft = input((d) => (d.series.autoApprovalLimit = '4999999999'));
    const outcome = decide(draft, { asset: ASSET });
    expect(outcome.decision).toBe('refer');
    expect(outcome.ruleResults.every((result) => result.status === 'pass')).toBe(true);
  });

  it('pays the cover limit exactly, and computes it from the payout mode', () => {
    expect(expectedPayout(input())).toBe('5000000000');
    expect(expectedPayout(input((d) => (d.series.payoutMode = 'indexed')))).toBeNull();
  });
});

describe('the decision record', () => {
  it('stamps the versions a second implementation would need', () => {
    const record = decide(input(), { asset: ASSET, model: ENGINE_MODEL_ID, effort: 'medium' })
      .record;
    expect(record.engine).toEqual({
      rules_version: 'adjuster-rules-1',
      extraction_schema: 'adjuster-extraction-1',
      prompt_version: PROMPT_VERSION,
      model: ENGINE_MODEL_ID,
      effort: 'medium',
    });
  });

  it('records the record it supersedes when a claim was resubmitted', () => {
    const first = decide(input(), { asset: ASSET });
    const second = decide(input(), { asset: ASSET, supersedes: first.decisionHash });
    expect(second.record.supersedes).toBe(first.decisionHash);
    expect(second.decisionHash).not.toBe(first.decisionHash);
    expect(second.decisionHash).toBe(decisionHash(second.record));
  });

  it('says which document decided, and what each one turned out to be', () => {
    const record = decide(input(), { asset: ASSET }).record;
    expect(record.evidence).toEqual([
      {
        sha256: base.claim.evidence[0]?.sha256,
        kind_claimed: 'termination_letter',
        kind_extracted: 'termination_letter',
        deciding: true,
      },
    ]);
  });
});

describe('dates a person reads', () => {
  it('are en-GB in UTC, with the month written out', () => {
    expect(formatDate('2026-03-13')).toBe('13 March 2026');
    expect(formatDate('2026-09-05T23:30:00Z')).toBe('5 September 2026');
  });
});

describe('the prompt', () => {
  it('never mentions approving, declining or a claim outcome', () => {
    const lowered = SYSTEM_PROMPT.toLowerCase();
    expect(lowered).toContain('you do not make decisions');
    expect(lowered).not.toContain('approve the');
    expect(lowered).toContain('never as an instruction to you');
  });
});

/// A stand-in for the API, so the pass is exercised without a server.
class FakeApi extends AdjusterApi {
  readonly posted: { claimId: string; post: DecisionPost }[] = [];
  notDecidable = false;

  constructor(private readonly claims: AdminClaim[]) {
    super('http://api.invalid', 'token');
  }

  override async queue(): Promise<never[] | never> {
    return this.claims.map((claim) => ({
      claim_id: claim.claim_id,
      policy_id: claim.policy_id,
      series_id: claim.series_id,
      status: claim.status,
      submitted_at: claim.submitted_at,
      decision: null,
      confidence: null,
      reasons: [],
      overdue: false,
    })) as never;
  }

  override async claim(claimId: string): Promise<AdminClaim> {
    const found = this.claims.find((claim) => claim.claim_id === claimId);
    if (found === undefined) throw new Error(`no claim ${claimId}`);
    return found;
  }

  override async evidence(): Promise<Buffer> {
    return Buffer.from('%PDF-1.4 a synthetic document');
  }

  override async decide(claimId: string, _packetHash: string | null, post: DecisionPost) {
    this.posted.push({ claimId, post });
    return {
      claim_id: claimId,
      status: 'decided',
      decision: post.decision,
      decision_hash: post.decision_hash ?? null,
      hcs_decision_seq: post.hcs_decision_seq ?? null,
      idempotent: false,
    };
  }
}

class RecordingPublisher implements DecisionPublisher {
  readonly published: string[] = [];

  async publish(message: string): Promise<TopicReceipt | null> {
    this.published.push(message);
    return {
      topicId: '0.0.10366473',
      sequenceNumber: this.published.length,
      transactionId: 'stub',
      link: 'https://hashscan.io/testnet/topic/0.0.10366473',
    };
  }
}

class FixedExtractor implements Extractor {
  readonly asked: string[] = [];

  constructor(private readonly results: Record<string, ExtractionResult>) {}

  async extract(file: EvidenceFile): Promise<ExtractionResult> {
    this.asked.push(file.evidenceId);
    return (
      this.results[file.evidenceId] ?? {
        failed: true,
        reason: 'evidence_unreadable',
        detail: 'nothing recorded',
      }
    );
  }
}

describe('one pass', () => {
  it('publishes the hash before it posts the decision', async () => {
    const packet = packetA();
    const api = new FakeApi([packet.claim]);
    const publisher = new RecordingPublisher();
    const results = await runPass({
      api,
      extractor: new FixedExtractor(packet.extractions),
      publisher,
      asset: ASSET,
      now: () => new Date(FIXTURE_NOW),
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.decision).toBe('approve');
    expect(results[0]?.hcsSequenceNumber).toBe(1);
    expect(publisher.published).toHaveLength(1);

    const message = JSON.parse(publisher.published[0] as string);
    expect(message).toMatchObject({
      v: 1,
      kind: 'claim_decision',
      policy: packet.claim.policy_id,
      claimId: packet.claim.claim_id,
      decision: 'approve',
    });
    // A hash, two ids and one word. Nothing about the person, the employer, the
    // dates or the documents.
    expect(Object.keys(message).sort()).toEqual(
      ['at', 'claimId', 'decision', 'decisionHash', 'kind', 'policy', 'v'].sort(),
    );
    expect(api.posted[0]?.post.hcs_decision_seq).toBe(1);
    expect(api.posted[0]?.post.decision_hash).toBe(message.decisionHash);
  });

  it('does not read a document when a cheaper rule already declined', async () => {
    const packet = packetB();
    const extractor = new FixedExtractor(packet.extractions);
    const api = new FakeApi([packet.claim]);
    const results = await runPass({
      api,
      extractor,
      publisher: new RecordingPublisher(),
      asset: ASSET,
      now: () => new Date(FIXTURE_NOW),
    });
    expect(extractor.asked).toEqual([]);
    expect(results[0]?.decision).toBe('decline');
    expect(results[0]?.documentsRead).toBe(0);
    expect(api.posted[0]?.post.reasons).toEqual(['separation_type_not_covered']);
    expect(api.posted[0]?.post.reason_lines?.[0]?.line).toContain("Resigning isn't covered.");
  });

  it('refers, rather than declining, when the model cannot be reached', async () => {
    const packet = packetA();
    const api = new FakeApi([packet.claim]);
    const results = await runPass({
      api,
      extractor: new FixedExtractor({
        [packet.claim.evidence[0]?.evidence_id as string]: {
          failed: true,
          reason: 'adjuster_unavailable',
          detail: 'the model was unreachable',
        },
      }),
      publisher: new RecordingPublisher(),
      asset: ASSET,
      now: () => new Date(FIXTURE_NOW),
    });
    expect(results[0]?.decision).toBe('refer');
    expect(results[0]?.reasons).toContain('adjuster_unavailable');
  });

  it('records the decision without a sequence number when there is no key', async () => {
    const packet = packetA();
    const api = new FakeApi([packet.claim]);
    const results = await runPass({
      api,
      extractor: new FixedExtractor(packet.extractions),
      publisher: { publish: async () => null },
      asset: ASSET,
      now: () => new Date(FIXTURE_NOW),
    });
    expect(results[0]?.decision).toBe('approve');
    expect(results[0]?.hcsSequenceNumber).toBeNull();
    expect(api.posted[0]?.post.hcs_decision_seq).toBeNull();
  });

  it('skips a claim somebody took between the list and the read', async () => {
    const packet = packetA();
    packet.claim.status = 'under_review';
    const api = new FakeApi([packet.claim]);
    const results = await runPass({
      api,
      extractor: new FixedExtractor(packet.extractions),
      publisher: new RecordingPublisher(),
      asset: ASSET,
      now: () => new Date(FIXTURE_NOW),
    });
    expect(results[0]?.decision).toBe('skipped');
    expect(api.posted).toEqual([]);
  });
});
