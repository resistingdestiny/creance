import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { FIXTURE_NOW, packetA, packetB } from '../fixtures/index.js';
import { toRuleInput } from '../src/adapt.js';
import { decide, needsExtraction } from '../src/decide.js';
import { canonicalRecord, decisionHash } from '../src/record.js';

/// The two committed packets, decided end to end with no database, no network
/// and no model key.

const ASSET = { id: '0.0.10366463', decimals: 6 };

function decideFixture(packet: ReturnType<typeof packetA>, extractions = packet.extractions) {
  return decide(toRuleInput(packet.claim, extractions, FIXTURE_NOW), { asset: ASSET });
}

describe('packet A, the clean redundancy', () => {
  const packet = packetA();
  const outcome = decideFixture(packet);

  it('approves without a human', () => {
    expect(outcome.decision).toBe('approve');
    expect(outcome.reasons).toEqual([]);
  });

  it('passes every rule it evaluated', () => {
    const notPassing = outcome.ruleResults.filter((result) => result.status !== 'pass');
    expect(notPassing.map((result) => `${result.rule} ${result.status}`)).toEqual([]);
  });

  it('scores the confidence the rubric says it should, to three decimals', () => {
    // 0.30(0.950) + 0.25(1.000) + 0.25(0.940) + 0.10(0.900) + 0.10(0.800)
    expect(outcome.confidence).toBe('0.940');
    expect(outcome.confidenceComponents).toMatchObject({
      c_employer: '0.950',
      c_date: '1.000',
      c_reason: '0.940',
      c_name: '0.900',
      c_quality: '0.800',
      renormalised: false,
      caps_applied: [],
    });
  });

  it('pays the cover limit exactly, in minor units', () => {
    expect(outcome.amount).toEqual({ amount: '5000000000', asset: ASSET.id, decimals: 6 });
  });

  it('qualifies through the open month after the separation month', () => {
    expect(outcome.record.separation_month).toBe('2026-03');
    expect(outcome.record.qualifying_month).toBe('2026-04');
  });

  it('reads the document, because no cheaper rule declined it', () => {
    expect(needsExtraction(toRuleInput(packet.claim, {}, FIXTURE_NOW))).toBe(true);
  });

  it('commits the document the extraction was recorded from', () => {
    const digest = createHash('sha256').update(packet.document).digest('hex');
    expect(`sha256:${digest}`).toBe(packet.claim.evidence[0]?.sha256);
  });
});

describe('packet B, the resignation', () => {
  const packet = packetB();
  const outcome = decideFixture(packet);

  it('declines, and the reason is the one the person can read', () => {
    expect(outcome.decision).toBe('decline');
    expect(outcome.reasons[0]).toBe('separation_type_not_covered');
    expect(outcome.reasonLines[0]?.line).toBe(
      "Resigning isn't covered. This cover pays when your employer ends your job.",
    );
  });

  it('offers no resubmission, and says why rather than going quiet', () => {
    expect(outcome.resubmit.allowed).toBe(false);
    expect(outcome.resubmit.why).toContain("Resigning isn't covered.");
  });

  it('declines before any document is read', () => {
    expect(needsExtraction(toRuleInput(packet.claim, {}, FIXTURE_NOW))).toBe(false);
    const unread = decideFixture(packet, {});
    expect(unread.decision).toBe('decline');
    expect(unread.confidence).toBeNull();
    expect(unread.record.confidence_components).toBeNull();
  });

  it('records every document rule as unevaluated when no document was read', () => {
    const unread = decideFixture(packet, {});
    const documentRules = unread.ruleResults.filter((result) =>
      ['R18', 'R19', 'R20', 'R21', 'R22'].includes(result.rule),
    );
    expect(documentRules.every((result) => result.status === 'not_evaluated')).toBe(true);
  });

  it('commits the document the extraction was recorded from', () => {
    const digest = createHash('sha256').update(packet.document).digest('hex');
    expect(`sha256:${digest}`).toBe(packet.claim.evidence[0]?.sha256);
  });
});

describe('the decision record', () => {
  it('carries no name, employer, job title or file name', () => {
    for (const packet of [packetA(), packetB()]) {
      const serialised = canonicalRecord(decideFixture(packet).record);
      const attestation = packet.claim.attestation;
      for (const secret of [
        attestation.full_name,
        attestation.employer_name,
        attestation.job_title,
        packet.claim.evidence[0]?.filename,
        packet.claim.nullifier,
      ]) {
        expect(serialised, `${packet.name} leaks ${String(secret)}`).not.toContain(String(secret));
      }
    }
  });

  it('hashes the same whatever order the keys were built in', () => {
    const record = decideFixture(packetA()).record;
    const shuffled = Object.fromEntries(
      Object.entries(record as unknown as Record<string, unknown>).reverse(),
    ) as typeof record;
    expect(decisionHash(shuffled)).toBe(decisionHash(record));
  });

  it('is the hash the Adjuster publishes', () => {
    const outcome = decideFixture(packetA());
    expect(outcome.decisionHash).toBe(decisionHash(outcome.record));
    expect(outcome.decisionHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});
