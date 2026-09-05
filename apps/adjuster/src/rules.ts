import {
  isFailure,
  type Extraction,
  type ExtractionResult,
  type SeparationLanguage,
} from './extraction.js';
import {
  addMonths,
  compareEmployer,
  compareName,
  comparePeriods,
  daysApart,
  periodOf,
  separationAt,
} from './normalise.js';
import type { ReasonCode } from './reasons.js';

/// The rule table of DESIGN.md 3.9, as pure functions.
///
/// Nothing here reads a clock, a database, a network or a model. `now`, the
/// observed window and the extractions all come in as parameters, which is what
/// makes an adjudication reproducible from a fixture and re-checkable by a
/// second implementation given only the decision record.
///
/// Every rule is evaluated, always. The engine does not stop at the first
/// failure, because a decline that lists one problem when there are three sends
/// the person back to fix one thing and fail again.

export const RULES_VERSION = 'adjuster-rules-1';

export type RuleStatus = 'pass' | 'fail_hard' | 'fail_soft' | 'not_evaluated';

export interface RuleResult {
  rule: string;
  name: string;
  status: RuleStatus;
  /** Whether an approval may proceed while this rule is `not_evaluated`. */
  required: boolean;
  /**
   * Machine-plain, never personal. "exact after normalisation", not the
   * employer's name: this string ends up inside a preimage whose hash is
   * public.
   */
  detail: string;
  reason?: ReasonCode;
}

export const COVERED_SEPARATION_TYPES = [
  'layoff',
  'redundancy',
  'position_eliminated',
  'site_closure',
] as const;

export const SEPARATION_TYPES = [
  ...COVERED_SEPARATION_TYPES,
  'resignation',
  'dismissal_for_cause',
  'fixed_term_end',
  'client_loss_self_employed',
] as const;

export type SeparationType = (typeof SEPARATION_TYPES)[number];

/**
 * Which words a document may use for each declared separation type.
 *
 * `contract_end` and `not_stated` appear in neither column: they are silence,
 * and silence is soft. Whether the end of a fixed-term contract counts as an
 * involuntary separation is an open product question (DESIGN.md 9.6), and until
 * it is answered the honest machine behaviour is to refer rather than to settle
 * a policy question inside a rule table.
 */
const LANGUAGE_COMPATIBILITY: Record<
  (typeof COVERED_SEPARATION_TYPES)[number],
  { compatible: SeparationLanguage[]; contradicts: SeparationLanguage[] }
> = {
  layoff: {
    compatible: ['layoff', 'redundancy', 'position_eliminated', 'site_closure'],
    contradicts: ['resignation', 'dismissal', 'retirement'],
  },
  redundancy: {
    compatible: ['redundancy', 'layoff', 'position_eliminated'],
    contradicts: ['resignation', 'dismissal', 'retirement'],
  },
  position_eliminated: {
    compatible: ['position_eliminated', 'redundancy', 'layoff'],
    contradicts: ['resignation', 'dismissal', 'retirement'],
  },
  site_closure: {
    compatible: ['site_closure', 'redundancy', 'layoff'],
    contradicts: ['resignation', 'dismissal', 'retirement'],
  },
};

/** Which document proves the most about a separation. Highest wins. */
const EVIDENCE_RANK: Record<string, number> = {
  termination_letter: 6,
  benefit_determination: 5,
  record_of_employment: 4,
  p45: 3,
  final_pay_statement: 2,
  other: 1,
};

export interface Attestation {
  /** Null when the claim was taken before the attestation carried a name. */
  fullName: string | null;
  employerName: string;
  jobTitle: string;
  group: string;
  /** ISO YYYY-MM-DD. */
  lastDayOfWork: string;
  separationType: SeparationType;
  statementAccepted: boolean;
  method: 'eip191' | 'hedera_sign_message' | 'unsigned_accepted';
  /** Whether the API verified the signature. Ignored for `unsigned_accepted`. */
  signatureVerified: boolean;
}

export interface ClaimFacts {
  claimId: string;
  status: string;
  submittedAt: string;
  packetHash: string | null;
  nullifier: string;
  world: { presence: boolean; action: string };
}

export interface PolicyFacts {
  policyId: string;
  seriesId: string;
  groupKey: string;
  nullifier: string;
  /** Minor units, a decimal string, never a JavaScript number. */
  coverLimit: string;
  startsAt: string;
  endsAt: string;
  claimsPayableFrom: string;
  status: string;
}

export interface SeriesFacts {
  seriesId: string;
  payoutMode: 'full' | 'indexed';
  lookbackMonths: number;
  /** Three decimals, as `claims.confidence` stores it. */
  autoApprovalConfidence: number;
  /** Minor units, a decimal string. */
  autoApprovalLimit: string;
}

export interface WindowFacts {
  /** Every month the series has ever opened, YYYY-MM, read off the chain. */
  openMonths: string[];
  /** The newest month an observation has been submitted for, or null. */
  lastObservedMonth: string | null;
  /** What the API stored on the claim at creation, for the R16 cross-check. */
  qualifyingMonth: string | null;
  /** `CoverPool.claimDeadline`, stored at creation. Never recomputed here. */
  claimDeadline: string | null;
}

export interface EvidenceFacts {
  evidenceId: string;
  /** The claimant's own label. A hint, never the truth. */
  kind: string;
  sha256: string;
  /** Whether this file's hash appears on another claim. */
  seenInOtherClaims: boolean;
}

export interface RuleInput {
  claim: ClaimFacts;
  attestation: Attestation;
  policy: PolicyFacts;
  series: SeriesFacts;
  window: WindowFacts;
  evidence: EvidenceFacts[];
  /** One entry per evidence id. Absent when the cheap rules declined first. */
  extractions: Record<string, ExtractionResult>;
  /** Other non-void claims for this nullifier in this series. */
  priorClaims: number;
  /** The clock, passed in. During a replay this is the replay clock's time. */
  now: string;
}

export interface RuleEvaluation {
  results: RuleResult[];
  /** The document the decision rests on, by evidence rank. */
  decidingEvidenceId: string | null;
  decidingExtraction: Extraction | null;
  /** The earliest open month that qualifies the separation, or null. */
  qualifyingMonth: string | null;
  separationMonth: string;
  /** Per-document rule outcomes, for the review screen. */
  perDocument: Record<string, RuleResult[]>;
}

export function evaluateRules(input: RuleInput): RuleEvaluation {
  const results: RuleResult[] = [];
  const at = separationAt(input.attestation.lastDayOfWork);
  const separationMonth = periodOf(at);

  results.push(...groupA(input));
  results.push(...groupB(input, at));

  const window = groupC(input, at, separationMonth);
  results.push(...window.results);

  const documents = groupD(input);
  results.push(...documents.results);
  results.push(...groupE(input, documents.deciding));

  return {
    results,
    decidingEvidenceId: documents.decidingId,
    decidingExtraction: documents.deciding,
    qualifyingMonth: window.qualifyingMonth,
    separationMonth,
    perDocument: documents.perDocument,
  };
}

// ------------------------------------------------- A: identity and eligibility

/// Enforced by the API before the Adjuster ever sees the claim. Re-asserted
/// here and hard on a mismatch, because a claim that reached the queue with a
/// broken identity leg means something upstream is wrong, and the right
/// response to that is to stop rather than to adjudicate.
function groupA(input: RuleInput): RuleResult[] {
  const { claim, policy } = input;
  return [
    rule('R01', 'presence_checked', claim.world.presence, 'fail_hard', 'presence_not_completed', {
      pass: 'a live person check was completed',
      fail: 'no live person check on the claim',
    }),
    rule(
      'R02',
      'same_person_as_purchase',
      claim.nullifier === policy.nullifier,
      'fail_hard',
      'nullifier_mismatch',
      { pass: 'the claim and the cover name the same person', fail: 'they name different people' },
    ),
    rule(
      'R03',
      'right_action',
      claim.world.action === 'occupation-cover-claim',
      'fail_hard',
      'wrong_action',
      { pass: 'occupation-cover-claim', fail: 'the check was made for another action' },
    ),
    rule(
      'R04',
      'claim_is_decidable',
      claim.status === 'submitted' || claim.status === 'under_review',
      'fail_hard',
      'claim_not_decidable',
      { pass: claim.status, fail: `status ${claim.status} cannot be decided` },
    ),
    rule(
      'R05',
      'policy_is_claimable',
      ['claims_open', 'claimed', 'under_review'].includes(policy.status),
      'fail_hard',
      'policy_not_claimable',
      { pass: policy.status, fail: `cover status ${policy.status}` },
    ),
    rule(
      'R06',
      'one_claim_per_person_per_series',
      input.priorClaims === 0,
      'fail_hard',
      'already_claimed',
      { pass: 'no earlier claim in this series', fail: 'an earlier claim exists in this series' },
    ),
  ];
}

// ------------------------------------ B: the attestation, with no document read

/// These need no model call. Run first, and a decline here costs nothing: a
/// resignation is refused in under a second and no document is ever read.
function groupB(input: RuleInput, at: Date): RuleResult[] {
  const { attestation: a, policy } = input;
  const covered = (COVERED_SEPARATION_TYPES as readonly string[]).includes(a.separationType);
  const payableFrom = Date.parse(`${policy.claimsPayableFrom}T00:00:00Z`);
  const endsAt = Date.parse(policy.endsAt);
  const now = Date.parse(input.now);

  return [
    rule('R07', 'separation_type_covered', covered, 'fail_hard', 'separation_type_not_covered', {
      pass: a.separationType,
      fail: `${a.separationType} is not a covered separation`,
    }),
    rule(
      'R08',
      'group_matches_policy',
      a.group === policy.groupKey,
      'fail_hard',
      'group_does_not_match_policy',
      { pass: 'the same occupation', fail: 'a different occupation from the cover' },
    ),
    rule(
      'R09',
      'statement_accepted',
      a.statementAccepted,
      'fail_hard',
      'attestation_not_accepted',
      { pass: 'accepted', fail: 'not accepted' },
    ),
    // Soft on purpose. A recorded click-through is weaker evidence, not a
    // broken flow, and the confidence cap keeps it out of auto-approval.
    rule(
      'R10',
      'attestation_signed',
      (a.method === 'eip191' || a.method === 'hedera_sign_message') && a.signatureVerified,
      'fail_soft',
      'attestation_unsigned',
      { pass: a.method, fail: `signed as ${a.method}` },
    ),
    rule(
      'R11',
      'after_waiting_period',
      at.getTime() >= payableFrom,
      'fail_hard',
      'separation_in_waiting_period',
      { pass: 'after the waiting period', fail: 'inside the waiting period' },
    ),
    rule('R12', 'inside_term', at.getTime() <= endsAt, 'fail_hard', 'separation_after_term', {
      pass: 'inside the term',
      fail: 'after the term ended',
    }),
    rule('R13', 'not_in_future', at.getTime() <= now, 'fail_hard', 'separation_in_future', {
      pass: 'in the past',
      fail: 'dated in the future',
    }),
  ];
}

// ------------------------------------- C: the loss window and the claim window

interface WindowOutcome {
  results: RuleResult[];
  qualifyingMonth: string | null;
}

/**
 * R14 is the one rule in the table with three outcomes, and it is the one to
 * get right.
 *
 * The predicate is `open(m) || open(m+1) || ... || open(m+lookback)`, evaluated
 * against observed history. A false predicate therefore means two very
 * different things. If some month of the window has not been observed yet, the
 * claim is on hold and will be re-decided when the next observation lands; the
 * claim window is defined so the wait cannot cost the claimant their deadline.
 * Only when every month in the window has been observed and none of them opened
 * is the answer no.
 */
function groupC(input: RuleInput, at: Date, separationMonth: string): WindowOutcome {
  const { window, series } = input;
  const results: RuleResult[] = [];

  const candidates: string[] = [];
  for (let i = 0; i <= series.lookbackMonths; i += 1) candidates.push(addMonths(separationMonth, i));
  const open = candidates.filter((month) => window.openMonths.includes(month));
  const qualifying = open.length === 0 ? null : (open.sort(comparePeriods)[0] as string);
  const latest = window.lastObservedMonth;
  const lastNeeded = candidates[candidates.length - 1] as string;

  if (qualifying !== null) {
    results.push({
      rule: 'R14',
      name: 'loss_window',
      status: 'pass',
      required: true,
      detail: `the separation month qualifies through an open month ${series.lookbackMonths >= 1 ? 'at or within the lookback' : 'itself'}`,
    });
  } else if (latest === null || comparePeriods(lastNeeded, latest) > 0) {
    results.push({
      rule: 'R14',
      name: 'loss_window',
      status: 'fail_soft',
      required: true,
      detail: 'some month of the window has not been observed yet',
      reason: 'loss_window_not_yet_open',
    });
  } else {
    results.push({
      rule: 'R14',
      name: 'loss_window',
      status: 'fail_hard',
      required: true,
      detail: 'every month of the window has been observed and none opened',
      reason: 'outside_loss_window',
    });
  }

  // The deadline is read from what the contract computed and stored on the
  // claim. Two implementations of "60 days from separation or 30 days from the
  // observation, whichever ends later" is how the screen and the chain end up
  // disagreeing while a judge is watching.
  if (window.claimDeadline === null) {
    results.push({
      rule: 'R15',
      name: 'claim_filed_in_time',
      status: 'not_evaluated',
      required: false,
      detail: 'no deadline is stored yet, because no month qualifies yet',
    });
  } else {
    const inTime = Date.parse(input.claim.submittedAt) <= Date.parse(window.claimDeadline);
    results.push(
      rule('R15', 'claim_filed_in_time', inTime, 'fail_hard', 'claim_window_closed', {
        pass: 'filed before the stored deadline',
        fail: 'filed after the stored deadline',
      }),
    );
  }

  if (window.qualifyingMonth === null || qualifying === null) {
    results.push({
      rule: 'R16',
      name: 'qualifying_month_agreed',
      status: 'not_evaluated',
      required: false,
      detail: 'no qualifying month on both sides to compare',
    });
  } else {
    results.push(
      rule(
        'R16',
        'qualifying_month_agreed',
        qualifying === window.qualifyingMonth,
        'fail_soft',
        'qualifying_month_disagreement',
        {
          pass: 'the stored qualifying month and the recomputed one agree',
          fail: 'the stored qualifying month and the recomputed one differ',
        },
      ),
    );
  }

  void at;
  return { results, qualifyingMonth: qualifying };
}

// --------------------------------- D: the documents against the attestation

interface DocumentOutcome {
  results: RuleResult[];
  decidingId: string | null;
  deciding: Extraction | null;
  perDocument: Record<string, RuleResult[]>;
}

/**
 * Every rule is evaluated per document and then reduced across the packet: the
 * packet passes a rule if at least one document passes it, and the per-document
 * results are all kept. One matching letter beside one unrelated payslip is a
 * valid packet.
 */
function groupD(input: RuleInput): DocumentOutcome {
  const perDocument: Record<string, RuleResult[]> = {};
  const readable: { id: string; extraction: Extraction; kind: string }[] = [];
  const failures: ReasonCode[] = [];

  for (const file of input.evidence) {
    const result = input.extractions[file.evidenceId];
    if (result === undefined) continue;
    if (isFailure(result)) {
      failures.push(result.reason);
      continue;
    }
    readable.push({ id: file.evidenceId, extraction: result, kind: file.kind });
  }

  if (input.evidence.length === 0) {
    return {
      results: [
        {
          rule: 'R17',
          name: 'readable_document',
          status: 'fail_hard',
          required: true,
          detail: 'the packet carries no document',
          reason: 'evidence_missing',
        },
        ...notEvaluated(['R18', 'R19', 'R20', 'R21', 'R22', 'R23', 'R24'], 'no document to read'),
      ],
      decidingId: null,
      deciding: null,
      perDocument,
    };
  }

  if (readable.length === 0) {
    // No model or transport failure ever declines a claim. Every extraction
    // failure is a refer, and this is the one place that is enforced.
    const anyAttempted = Object.keys(input.extractions).length > 0;
    return {
      results: [
        {
          rule: 'R17',
          name: 'readable_document',
          status: anyAttempted ? 'fail_soft' : 'not_evaluated',
          required: true,
          detail: anyAttempted
            ? 'no document could be read'
            : 'the documents were not read, because a cheaper rule already decided',
          ...(anyAttempted ? { reason: failures[0] ?? ('evidence_unreadable' as ReasonCode) } : {}),
        },
        ...notEvaluated(
          ['R18', 'R19', 'R20', 'R21', 'R22', 'R23', 'R24'],
          anyAttempted ? 'no document could be read' : 'no document was read',
        ),
      ],
      decidingId: null,
      deciding: null,
      perDocument,
    };
  }

  const ranked = [...readable].sort(
    (a, b) =>
      (EVIDENCE_RANK[b.extraction.document_type] ?? 0) -
      (EVIDENCE_RANK[a.extraction.document_type] ?? 0),
  );
  const deciding = ranked[0] as { id: string; extraction: Extraction; kind: string };

  for (const file of readable) {
    perDocument[file.id] = documentRules(input, file.extraction, file.kind);
  }

  const reduced = reduceAcross(readable.map((file) => perDocument[file.id] as RuleResult[]));
  reduced.unshift({
    rule: 'R17',
    name: 'readable_document',
    status: 'pass',
    required: true,
    detail: `${readable.length} of ${input.evidence.length} documents read`,
  });

  return { results: reduced, decidingId: deciding.id, deciding: deciding.extraction, perDocument };
}

function documentRules(input: RuleInput, e: Extraction, claimedKind: string): RuleResult[] {
  const a = input.attestation;
  const results: RuleResult[] = [];

  const employer = compareEmployer(e.employer_name, a.employerName);
  results.push({
    rule: 'R18',
    name: 'employer_matches',
    required: true,
    ...(employer === 'match'
      ? { status: 'pass' as const, detail: 'exact after normalisation' }
      : employer === 'near_match'
        ? {
            status: 'fail_soft' as const,
            detail: 'a near match after normalisation',
            reason: 'evidence_does_not_match_attestation:employer' as ReasonCode,
          }
        : employer === 'absent'
          ? {
              status: 'fail_soft' as const,
              detail: 'the document names no employer',
              reason: 'evidence_does_not_match_attestation:employer' as ReasonCode,
            }
          : {
              status: 'fail_hard' as const,
              detail: 'a different employer after normalisation',
              reason: 'evidence_does_not_match_attestation:employer' as ReasonCode,
            }),
  });

  const documentDate = e.last_day_of_work ?? e.leaving_date_field ?? e.pay_period_end;
  results.push({
    rule: 'R19',
    name: 'date_matches',
    required: true,
    ...(documentDate === null
      ? {
          status: 'fail_soft' as const,
          detail: 'the document gives no unambiguous date',
          reason: 'evidence_does_not_match_attestation:date' as ReasonCode,
        }
      : documentDate === a.lastDayOfWork
        ? { status: 'pass' as const, detail: 'exact' }
        : daysApart(documentDate, a.lastDayOfWork) <= 3
          ? {
              status: 'fail_soft' as const,
              detail: 'within three days of the statement',
              reason: 'evidence_does_not_match_attestation:date' as ReasonCode,
            }
          : {
              status: 'fail_hard' as const,
              detail: 'more than three days from the statement',
              reason: 'evidence_does_not_match_attestation:date' as ReasonCode,
            }),
  });

  results.push({
    rule: 'R20',
    name: 'employer_initiated',
    required: true,
    ...(e.separation_initiated_by === 'employer'
      ? { status: 'pass' as const, detail: 'employer' }
      : e.separation_initiated_by === 'employee'
        ? {
            status: 'fail_hard' as const,
            detail: 'the document says the worker ended it',
            reason: 'evidence_contradicts_separation_type' as ReasonCode,
          }
        : {
            status: 'fail_soft' as const,
            detail: `the document says ${e.separation_initiated_by}`,
            reason: 'separation_reason_not_stated' as ReasonCode,
          }),
  });

  const compatibility =
    LANGUAGE_COMPATIBILITY[a.separationType as (typeof COVERED_SEPARATION_TYPES)[number]];
  results.push({
    rule: 'R21',
    name: 'language_agrees_with_declared_type',
    required: true,
    ...(compatibility === undefined
      ? {
          status: 'not_evaluated' as const,
          detail: 'the declared separation is not a covered type',
        }
      : compatibility.compatible.includes(e.separation_language)
        ? { status: 'pass' as const, detail: 'the wording agrees with the declared type' }
        : compatibility.contradicts.includes(e.separation_language)
          ? {
              status: 'fail_hard' as const,
              detail: 'the wording contradicts the declared type',
              reason: 'evidence_contradicts_separation_type' as ReasonCode,
            }
          : {
              status: 'fail_soft' as const,
              detail: 'the document is silent on the reason',
              reason: 'separation_reason_not_stated' as ReasonCode,
            }),
  });

  const name = compareName(e.employee_name, a.fullName);
  results.push({
    rule: 'R22',
    name: 'name_matches',
    required: true,
    ...(a.fullName === null
      ? {
          status: 'not_evaluated' as const,
          detail: 'the statement carries no name to compare',
        }
      : name === 'match'
        ? { status: 'pass' as const, detail: 'exact after normalisation' }
        : name === 'near_match'
          ? {
              status: 'fail_soft' as const,
              detail: 'a partial match after normalisation',
              reason: 'evidence_does_not_match_attestation:name' as ReasonCode,
            }
          : name === 'absent'
            ? {
                status: 'fail_soft' as const,
                detail: 'the document names no person',
                reason: 'evidence_does_not_match_attestation:name' as ReasonCode,
              }
            : {
                status: 'fail_hard' as const,
                detail: 'a different name after normalisation',
                reason: 'evidence_does_not_match_attestation:name' as ReasonCode,
              }),
  });

  results.push(
    rule(
      'R23',
      'claimed_kind_is_honest',
      claimedKind === 'other' || e.document_type === claimedKind,
      'fail_soft',
      'evidence_type_mismatch',
      {
        pass: 'the label and the classification agree',
        fail: 'the label and the classification differ',
      },
      false,
    ),
  );

  // Soft and staying soft: occupation is self-declared in v1 (DESIGN.md 3.6)
  // and a rule table is not the place to relitigate that.
  results.push({
    rule: 'R24',
    name: 'job_title_consistent_with_group',
    required: false,
    ...(e.job_title === null
      ? { status: 'not_evaluated' as const, detail: 'the document gives no job title' }
      : compareName(e.job_title, a.jobTitle) === 'mismatch'
        ? {
            status: 'fail_soft' as const,
            detail: 'the document gives a different job title from the statement',
            reason: 'occupation_not_consistent_with_group' as ReasonCode,
          }
        : { status: 'pass' as const, detail: 'the job title agrees with the statement' }),
  });

  return results;
}

/** The packet passes a rule when at least one document passes it. */
function reduceAcross(perDocument: RuleResult[][]): RuleResult[] {
  const order: Record<RuleStatus, number> = {
    pass: 0,
    fail_soft: 1,
    not_evaluated: 2,
    fail_hard: 3,
  };
  const byRule = new Map<string, RuleResult>();
  for (const results of perDocument) {
    for (const result of results) {
      const best = byRule.get(result.rule);
      if (best === undefined || order[result.status] < order[best.status]) {
        byRule.set(result.rule, result);
      }
    }
  }
  return [...byRule.values()].sort((a, b) => a.rule.localeCompare(b.rule));
}

// ------------------------------------------ E: quality and integrity signals

function groupE(input: RuleInput, deciding: Extraction | null): RuleResult[] {
  const hashes = input.evidence.map((file) => file.sha256);
  const distinct = new Set(hashes).size === hashes.length;
  const seenBefore = input.evidence.some((file) => file.seenInOtherClaims);

  const quality: RuleResult[] =
    deciding === null
      ? notEvaluated(['R25', 'R26', 'R27', 'R28'], 'no document was read')
      : [
          rule(
            'R25',
            'legible_enough',
            deciding.legibility >= 0.5,
            'fail_soft',
            'evidence_unreadable',
            { pass: 'legible', fail: 'below the legibility floor' },
            false,
          ),
          rule(
            'R26',
            'not_truncated',
            deciding.document_complete,
            'fail_soft',
            'evidence_incomplete',
            { pass: 'complete', fail: 'the page is cut off' },
            false,
          ),
          rule(
            'R27',
            'dates_internally_consistent',
            deciding.dates_internally_consistent,
            'fail_soft',
            'evidence_dates_inconsistent',
            { pass: 'consistent', fail: 'the dates on the page disagree' },
            false,
          ),
          // Soft on principle, not on caution. Text that looks like an
          // instruction is either an attack or a coincidence, and a machine
          // cannot tell which. Declining punishes the coincidence, approving
          // rewards the attack. Referring does neither.
          rule(
            'R28',
            'no_instruction_text',
            !deciding.contains_instruction_like_text,
            'fail_soft',
            'evidence_needs_human_check',
            { pass: 'none found', fail: 'the document addresses a reader of documents' },
            true,
          ),
        ];

  return [
    ...quality,
    rule('R29', 'evidence_not_seen_before', !seenBefore, 'fail_soft', 'evidence_seen_before', {
      pass: 'no file appears on another claim',
      fail: 'a file appears on another claim',
    }),
    rule('R30', 'distinct_documents', distinct, 'fail_soft', 'duplicate_evidence', {
      pass: 'every file is distinct',
      fail: 'the packet repeats a file',
    }),
    // The indexed payout mode is defined against the shock form only and the
    // demo series is full payout, so an indexed series is referred rather than
    // paid from an amount this build does not compute.
    rule(
      'R31',
      'payout_computable',
      input.series.payoutMode === 'full',
      'fail_soft',
      'payout_mode_not_supported',
      { pass: 'full payout', fail: 'the indexed payout mode is not computed here' },
    ),
  ];
}

// ------------------------------------------------------------------- helpers

function rule(
  id: string,
  name: string,
  held: boolean,
  onFail: 'fail_hard' | 'fail_soft',
  reason: ReasonCode,
  detail: { pass: string; fail: string },
  required = true,
): RuleResult {
  return held
    ? { rule: id, name, status: 'pass', required, detail: detail.pass }
    : { rule: id, name, status: onFail, required, detail: detail.fail, reason };
}

function notEvaluated(ids: string[], detail: string): RuleResult[] {
  return ids.map((id) => ({
    rule: id,
    name: RULE_NAMES[id]?.name ?? id,
    status: 'not_evaluated' as const,
    required: RULE_NAMES[id]?.required ?? true,
    detail,
  }));
}

/// The name and the approval requirement of every rule that can be reported
/// unevaluated. `required` is what the auto-approval predicate and the API's
/// decision handler read: an unevaluable rule reported as a pass is the failure
/// mode that turns a missing check into an approval, so the four-value status
/// carries the requirement beside it.
const RULE_NAMES: Record<string, { name: string; required: boolean }> = {
  R18: { name: 'employer_matches', required: true },
  R19: { name: 'date_matches', required: true },
  R20: { name: 'employer_initiated', required: true },
  R21: { name: 'language_agrees_with_declared_type', required: true },
  R22: { name: 'name_matches', required: true },
  R23: { name: 'claimed_kind_is_honest', required: false },
  R24: { name: 'job_title_consistent_with_group', required: false },
  R25: { name: 'legible_enough', required: false },
  R26: { name: 'not_truncated', required: false },
  R27: { name: 'dates_internally_consistent', required: false },
  R28: { name: 'no_instruction_text', required: true },
};
