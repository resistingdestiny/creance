import { describe, expect, it } from 'vitest';

import { FIXTURE_NOW, packetA } from '../fixtures/index.js';
import { toRuleInput } from '../src/adapt.js';
import { band, computeConfidence, round3, WEIGHTS } from '../src/confidence.js';
import { decide } from '../src/decide.js';
import type { Extraction } from '../src/extraction.js';
import type { RuleInput } from '../src/rules.js';

/// The rubric, checked to the third decimal, because that is the precision the
/// column stores and the precision the auto-approval gate compares at.

const ASSET = { id: '0.0.10366463', decimals: 6 };
const base = packetA();
const EVIDENCE_ID = base.claim.evidence[0]?.evidence_id as string;

function input(patch: (draft: RuleInput) => void = () => undefined): RuleInput {
  const draft = toRuleInput(
    structuredClone(base.claim),
    structuredClone(base.extractions),
    FIXTURE_NOW,
  );
  patch(draft);
  return draft;
}

function extraction(draft: RuleInput): Extraction {
  return draft.extractions[EVIDENCE_ID] as Extraction;
}

function score(draft: RuleInput) {
  return decide(draft, { asset: ASSET });
}

describe('the weights', () => {
  it('sum to one, so the arithmetic is a weighted mean and not a scale', () => {
    const total = Object.values(WEIGHTS).reduce((sum, weight) => sum + weight, 0);
    expect(round3(total)).toBe('1.000');
  });
});

describe('the arithmetic', () => {
  it('produces packet A exactly', () => {
    expect(score(input()).confidence).toBe('0.940');
  });

  it('produces the near miss exactly', () => {
    // A subsidiary employer name and a three-day date difference: two soft
    // rules, a medium band, a referral.
    const draft = input((d) => {
      const e = extraction(d);
      e.employer_name = 'Northgate Systems (UK) Ltd';
      e.employer_name_confidence = 0.93;
      e.last_day_of_work = '2026-03-16';
      e.separation_initiated_by_confidence = 0.95;
      e.employee_name_confidence = 1;
      e.legibility = 0.85;
    });
    const outcome = score(draft);
    // 0.30(0.558) + 0.25(0.600) + 0.25(0.950) + 0.10(1.000) + 0.10(0.850)
    expect(outcome.confidenceComponents).toMatchObject({
      c_employer: '0.558',
      c_date: '0.600',
      c_reason: '0.950',
      c_name: '1.000',
      c_quality: '0.850',
    });
    expect(outcome.confidence).toBe('0.740');
    expect(outcome.decision).toBe('refer');
    expect(band(outcome.confidence as string)).toBe('medium');
  });

  it('renormalises over 0.90 when the statement carries no name', () => {
    const draft = input((d) => (d.attestation.fullName = null));
    const outcome = score(draft);
    // The four remaining terms of packet A come to 0.850, over 0.90, then the
    // unevaluated-required-rule cap takes it to 0.850 as well.
    const expected = (0.3 * 0.95 + 0.25 * 1 + 0.25 * 0.94 + 0.1 * 0.8) / (1 - WEIGHTS.name);
    expect(outcome.confidence).toBe(round3(Math.min(expected, 0.85)));
    expect(outcome.confidenceComponents?.renormalised).toBe(true);
    expect(outcome.confidenceComponents?.c_name).toBeNull();
  });
});

describe('the caps', () => {
  it('binds at 0.50 on instruction-shaped text', () => {
    const draft = input((d) => (extraction(d).contains_instruction_like_text = true));
    const outcome = score(draft);
    expect(Number(outcome.confidence)).toBeLessThanOrEqual(0.5);
    expect(outcome.confidenceComponents?.caps_applied).toContain('instruction_like_text');
  });

  it('binds at 0.85 on a recorded click-through', () => {
    const draft = input((d) => {
      d.attestation.method = 'unsigned_accepted';
      d.attestation.signatureVerified = false;
    });
    const outcome = score(draft);
    expect(Number(outcome.confidence)).toBeLessThanOrEqual(0.85);
    expect(outcome.confidenceComponents?.caps_applied).toContain('unsigned_attestation');
  });

  it('binds at 0.70 when the deciding document is of no named kind', () => {
    const draft = input((d) => (extraction(d).document_type = 'other'));
    const outcome = score(draft);
    expect(Number(outcome.confidence)).toBeLessThanOrEqual(0.7);
    expect(outcome.confidenceComponents?.caps_applied).toContain('deciding_document_is_other');
  });

  it('binds at 0.70 on a payslip that no other document gives a reason for', () => {
    const draft = input((d) => {
      const e = extraction(d);
      e.document_type = 'final_pay_statement';
      e.separation_language = 'not_stated';
      e.separation_initiated_by = 'not_stated';
    });
    const outcome = score(draft);
    expect(Number(outcome.confidence)).toBeLessThanOrEqual(0.7);
    expect(outcome.confidenceComponents?.caps_applied).toContain('no_document_states_a_reason');
  });

  it('does not bind when its condition does not hold', () => {
    expect(score(input()).confidenceComponents?.caps_applied).toEqual([]);
  });

  it('never lets a capped score rise when a component improves', () => {
    const capped = (legibility: number): number => {
      const draft = input((d) => {
        extraction(d).contains_instruction_like_text = true;
        extraction(d).legibility = legibility;
      });
      return Number(score(draft).confidence);
    };
    expect(capped(1)).toBeLessThanOrEqual(0.5);
    expect(capped(1)).toBe(capped(0.8));
  });
});

describe('rounding', () => {
  it('rounds half up, at the end and only at the end', () => {
    expect(round3(0.9)).toBe('0.900');
    expect(round3(0.8995)).toBe('0.900');
    expect(round3(0.8994)).toBe('0.899');
    expect(round3(0.0005)).toBe('0.001');
  });

  it('clamps outside the unit interval rather than reporting a nonsense score', () => {
    expect(round3(1.4)).toBe('1.000');
    expect(round3(-0.2)).toBe('0.000');
  });
});

describe('a packet with nothing read', () => {
  it('has no confidence rather than a low one', () => {
    const outcome = computeConfidence({
      attestation: toRuleInput(base.claim, {}, FIXTURE_NOW).attestation,
      deciding: null,
      decidingClaimedKind: null,
      anotherDocumentStatesReason: false,
      results: [],
    });
    expect(outcome.confidence).toBe('0.000');
    expect(outcome.components.c_name).toBeNull();
  });
});

describe('the bands', () => {
  it('are display only, and split at the threshold and at 0.700', () => {
    expect(band('0.900')).toBe('high');
    expect(band('0.899')).toBe('medium');
    expect(band('0.700')).toBe('medium');
    expect(band('0.699')).toBe('low');
  });
});
