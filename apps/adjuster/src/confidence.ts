import type { Extraction } from './extraction.js';
import { compareEmployer, compareName, daysApart } from './normalise.js';
import type { Attestation, RuleResult } from './rules.js';

/// Confidence is the probability that a human reviewer would reach the same
/// decision from the same packet.
///
/// It is not the model's certainty about a sentence and it is not a fraud
/// score. It is the number that decides whether a human looks, so it is a
/// property of the packet's evidential quality as a whole. It is computed in
/// code from the extraction and the rule results by a pure function with no
/// model call, so it is reproducible from a fixture and explicable in the
/// decision record, which stores every component.
///
/// Stored as numeric(4,3), so three decimals, rounded half up at the end and
/// only at the end.

export interface ConfidenceComponents {
  c_employer: string;
  c_date: string;
  c_reason: string;
  /** Null when the statement carried no name and the weights were renormalised. */
  c_name: string | null;
  c_quality: string;
  renormalised: boolean;
  caps_applied: string[];
}

export interface ConfidenceOutcome {
  /** Three decimals as a string, the form `claims.confidence` stores. */
  confidence: string;
  components: ConfidenceComponents;
}

/**
 * The weights.
 *
 * Stated rather than tuned. Employer and date are the two facts a forger has to
 * get right and a genuine claimant gets right by accident; the reason is the
 * fact that decides coverage; quality is a tie-breaker rather than a driver.
 * They are deliberately not fitted to the demo packets: a rubric fitted to two
 * fixtures stops making marginal claims refer, which is its only job.
 */
export const WEIGHTS = {
  employer: 0.3,
  date: 0.25,
  reason: 0.25,
  name: 0.1,
  quality: 0.1,
} as const;

export interface ConfidenceInput {
  attestation: Attestation;
  /** The document the decision rests on, or null when none could be read. */
  deciding: Extraction | null;
  decidingClaimedKind: string | null;
  /** Whether any other readable document states a reason for the separation. */
  anotherDocumentStatesReason: boolean;
  results: RuleResult[];
}

export function computeConfidence(input: ConfidenceInput): ConfidenceOutcome {
  const e = input.deciding;
  if (e === null) {
    // Nothing was assessed, so there is nothing to be confident about. A zero
    // is not a low opinion of the packet; it is the absence of one, and every
    // gate reads it the same way.
    return {
      confidence: '0.000',
      components: {
        c_employer: '0.000',
        c_date: '0.000',
        c_reason: '0.000',
        c_name: null,
        c_quality: '0.000',
        renormalised: true,
        caps_applied: [],
      },
    };
  }

  const a = input.attestation;
  const employerMatch = compareEmployer(e.employer_name, a.employerName);
  const cEmployer =
    employerMatch === 'match'
      ? e.employer_name_confidence
      : employerMatch === 'near_match'
        ? 0.6 * e.employer_name_confidence
        : 0;

  const documentDate = e.last_day_of_work ?? e.leaving_date_field ?? e.pay_period_end;
  const cDate =
    documentDate === null
      ? 0
      : documentDate === a.lastDayOfWork
        ? 1
        : daysApart(documentDate, a.lastDayOfWork) <= 3
          ? 0.6
          : 0;

  const contradicted = input.results.some(
    (result) => result.rule === 'R21' && result.status === 'fail_hard',
  );
  const cReason =
    e.separation_initiated_by === 'employer' && !contradicted
      ? e.separation_initiated_by_confidence
      : e.separation_initiated_by === 'employee' || contradicted
        ? 0
        : 0.5;

  // Weighted by the model's own reading confidence for the name, the same way
  // the employer term is, because a name transcribed off a blurred signature
  // block is weaker evidence than one printed in the address line and the two
  // fields have no reason to be treated differently.
  const nameMatch = a.fullName === null ? null : compareName(e.employee_name, a.fullName);
  const cName =
    nameMatch === null
      ? null
      : nameMatch === 'match'
        ? e.employee_name_confidence
        : nameMatch === 'near_match'
          ? 0.5 * e.employee_name_confidence
          : 0;

  let cQuality = e.legibility;
  if (!e.document_complete) cQuality -= 0.2;
  if (!e.dates_internally_consistent) cQuality -= 0.2;
  cQuality = Math.max(0, cQuality);

  let raw =
    WEIGHTS.employer * cEmployer +
    WEIGHTS.date * cDate +
    WEIGHTS.reason * cReason +
    WEIGHTS.quality * cQuality;
  const renormalised = cName === null;
  if (cName === null) {
    // The four remaining terms are divided by the weight that is left, so a
    // packet is never penalised for a field this build did not collect.
    raw /= 1 - WEIGHTS.name;
  } else {
    raw += WEIGHTS.name * cName;
  }

  // The caps. Each one is a statement that a packet is not auto-approvable,
  // expressed in the same number the threshold reads, so there is one gate and
  // not two. Every cap sits below the default threshold of 0.900.
  const caps: string[] = [];
  // Recorded whenever the condition holds, whether or not the arithmetic was
  // already below the ceiling, so a reviewer reading the record sees why a
  // packet could not have auto-approved rather than only that it did not.
  const applyCap = (name: string, ceiling: number): void => {
    caps.push(name);
    raw = Math.min(raw, ceiling);
  };

  if (e.contains_instruction_like_text) applyCap('instruction_like_text', 0.5);
  if (a.method === 'unsigned_accepted') applyCap('unsigned_attestation', 0.85);
  if (e.document_type === 'other') applyCap('deciding_document_is_other', 0.7);
  if (
    (e.document_type === 'final_pay_statement' || e.document_type === 'p45') &&
    !input.anotherDocumentStatesReason
  ) {
    applyCap('no_document_states_a_reason', 0.7);
  }
  if (input.results.some((result) => result.status === 'fail_soft')) applyCap('a_rule_referred', 0.85);
  if (input.results.some((result) => result.status === 'not_evaluated' && result.required)) {
    applyCap('a_required_rule_was_not_evaluated', 0.85);
  }

  return {
    confidence: round3(raw),
    components: {
      c_employer: round3(cEmployer),
      c_date: round3(cDate),
      c_reason: round3(cReason),
      c_name: cName === null ? null : round3(cName),
      c_quality: round3(cQuality),
      renormalised,
      caps_applied: caps,
    },
  };
}

/**
 * Three decimals, rounded half up.
 *
 * `toFixed` rounds half to even on some values because of the binary
 * representation, and a threshold comparison at 0.900 is not the place to find
 * that out. The scaling here is done on an integer.
 */
export function round3(value: number): string {
  const scaled = Math.round(value * 1000 + Number.EPSILON * 1000);
  const clamped = Math.min(1000, Math.max(0, scaled));
  return (clamped / 1000).toFixed(3);
}

/** The band the admin queue prints. Display only: the gate is the number. */
export function band(confidence: string): 'high' | 'medium' | 'low' {
  const value = Number(confidence);
  if (value >= 0.9) return 'high';
  return value >= 0.7 ? 'medium' : 'low';
}
