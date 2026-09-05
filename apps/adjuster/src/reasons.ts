/// Reason codes, their order, and the one line the person reads.
///
/// Two prep decisions meet here and both are kept, in parallel arrays.
///
/// `reasons[]` is canonical. It is what goes into the decision record whose
/// hash is public, what the admin queue sorts on, and what the web app switches
/// on for the resubmission affordance. A copy change must never need a schema
/// change.
///
/// `reason_lines[]` is presentation. Several of these lines only mean anything
/// with the dates filled in, and templating them in the web app would put half
/// a sentence in the Adjuster and half in the app. So the Adjuster composes
/// them and the app prints them verbatim. They carry dates and sometimes an
/// employer name, so they never reach the topic.
///
/// The voice is docs/DESIGN-TOKENS.md section 8 and the addendum's C9: sentence
/// case, plain verbs, say what happened and what to do next, no apology, no em
/// or en dashes, and none of the words "policy", "bind", "settle",
/// "parametric", "nullifier" or "proof".

export const REASON_CODES = [
  'presence_not_completed',
  'nullifier_mismatch',
  'wrong_action',
  'claim_not_decidable',
  'policy_not_claimable',
  'already_claimed',
  'separation_type_not_covered',
  'group_does_not_match_policy',
  'attestation_not_accepted',
  'attestation_unsigned',
  'separation_in_waiting_period',
  'separation_after_term',
  'separation_in_future',
  'outside_loss_window',
  'loss_window_not_yet_open',
  'claim_window_closed',
  'qualifying_month_disagreement',
  'evidence_missing',
  'evidence_unreadable',
  'evidence_does_not_match_attestation:employer',
  'evidence_does_not_match_attestation:date',
  'evidence_does_not_match_attestation:name',
  'evidence_contradicts_separation_type',
  'separation_reason_not_stated',
  'evidence_type_mismatch',
  'occupation_not_consistent_with_group',
  'evidence_incomplete',
  'evidence_dates_inconsistent',
  'evidence_needs_human_check',
  'evidence_seen_before',
  'duplicate_evidence',
  'payout_mode_not_supported',
  'amount_disagreement',
  'adjuster_unavailable',
  'adjuster_refused',
  'extraction_truncated',
  'extraction_invalid',
] as const;

export type ReasonCode = (typeof REASON_CODES)[number];

/**
 * The order the web app renders when several rules failed.
 *
 * Ordered by what the person can act on, most actionable first, with the
 * immovable product rules at the top so that "you resigned" is never buried
 * under "your scan is blurry".
 */
export const REASON_PRIORITY: readonly ReasonCode[] = [
  'separation_type_not_covered',
  'group_does_not_match_policy',
  'separation_in_waiting_period',
  'separation_after_term',
  'outside_loss_window',
  'claim_window_closed',
  'evidence_contradicts_separation_type',
  'evidence_does_not_match_attestation:employer',
  'evidence_does_not_match_attestation:name',
  'evidence_does_not_match_attestation:date',
  'evidence_missing',
  'evidence_unreadable',
];

/** Sort a reason list into the order a reader should meet it. */
export function byPriority(reasons: readonly ReasonCode[]): ReasonCode[] {
  const rank = (code: ReasonCode): number => {
    const at = REASON_PRIORITY.indexOf(code);
    return at === -1 ? REASON_PRIORITY.length : at;
  };
  return [...reasons].sort((a, b) => rank(a) - rank(b) || REASON_CODES.indexOf(a) - REASON_CODES.indexOf(b));
}

/** The slots a template fills. Every one is supplied by the Adjuster. */
export interface ReasonSlots {
  last_day_of_work?: string;
  claims_payable_from?: string;
  cover_ends?: string;
  claim_deadline?: string;
  employer_on_document?: string;
  date_on_document?: string;
  name_on_document?: string;
  waiting_period_days?: number;
}

interface ReasonCopy {
  line: (slots: ReasonSlots) => string;
  /** Whether a fresh document could change the answer. */
  resubmit: boolean;
}

const REFERRED = 'Someone will look at your claim.';

const COPY: Record<ReasonCode, ReasonCopy> = {
  separation_type_not_covered: {
    line: () => "Resigning isn't covered. This cover pays when your employer ends your job.",
    resubmit: false,
  },
  group_does_not_match_policy: {
    line: () => 'This cover is for a different occupation from the one on your claim.',
    resubmit: false,
  },
  separation_in_waiting_period: {
    line: (s) =>
      `Your last day of work, ${s.last_day_of_work ?? 'as you gave it'}, is before your cover started paying out on ${s.claims_payable_from ?? 'its start date'}.`,
    resubmit: false,
  },
  separation_after_term: {
    line: (s) =>
      `Your last day of work, ${s.last_day_of_work ?? 'as you gave it'}, falls after your cover ended on ${s.cover_ends ?? 'its end date'}.`,
    resubmit: false,
  },
  separation_in_future: {
    line: (s) => `Your last day of work, ${s.last_day_of_work ?? 'as you gave it'}, is in the future.`,
    resubmit: true,
  },
  outside_loss_window: {
    line: () =>
      'The index for your occupation did not rise in the months around your last day of work.',
    resubmit: false,
  },
  loss_window_not_yet_open: {
    line: () =>
      'We are waiting for the next reading of the index. We will decide your claim when it is published, and your time to claim will not run out while you wait.',
    resubmit: false,
  },
  claim_window_closed: {
    line: (s) =>
      `The time to claim for this ended on ${s.claim_deadline ?? 'the claim deadline'}.`,
    resubmit: false,
  },
  qualifying_month_disagreement: { line: () => REFERRED, resubmit: false },
  evidence_contradicts_separation_type: {
    line: () =>
      'Your document says you left by choice, but your statement says your employer ended your job.',
    resubmit: true,
  },
  'evidence_does_not_match_attestation:employer': {
    line: (s) =>
      s.employer_on_document === undefined
        ? 'The document names a different employer from your statement.'
        : `The document names ${s.employer_on_document}, which is a different employer from the one on your statement.`,
    resubmit: true,
  },
  'evidence_does_not_match_attestation:date': {
    line: (s) =>
      s.date_on_document === undefined
        ? 'The document gives a different last day of work from your statement.'
        : `The document gives your last day of work as ${s.date_on_document}, which is not the date on your statement.`,
    resubmit: true,
  },
  'evidence_does_not_match_attestation:name': {
    line: () => 'The document is in a different name from the one on your statement.',
    resubmit: true,
  },
  evidence_missing: {
    line: () => 'Add a document that shows your employer ended your job.',
    resubmit: true,
  },
  evidence_unreadable: {
    line: () => 'We could not read that document. Send a clearer photo or a PDF.',
    resubmit: true,
  },
  evidence_incomplete: {
    line: () => 'Part of that document is missing. Send the whole page.',
    resubmit: true,
  },
  evidence_dates_inconsistent: { line: () => REFERRED, resubmit: false },
  separation_reason_not_stated: {
    line: () => `Your document does not say why the job ended. ${REFERRED}`,
    resubmit: false,
  },
  evidence_type_mismatch: { line: () => REFERRED, resubmit: false },
  occupation_not_consistent_with_group: { line: () => REFERRED, resubmit: false },
  evidence_needs_human_check: { line: () => REFERRED, resubmit: false },
  evidence_seen_before: { line: () => REFERRED, resubmit: false },
  duplicate_evidence: { line: () => REFERRED, resubmit: false },
  payout_mode_not_supported: { line: () => REFERRED, resubmit: false },
  amount_disagreement: { line: () => REFERRED, resubmit: false },
  attestation_unsigned: { line: () => REFERRED, resubmit: false },
  adjuster_unavailable: { line: () => REFERRED, resubmit: false },
  adjuster_refused: { line: () => REFERRED, resubmit: false },
  extraction_truncated: { line: () => REFERRED, resubmit: false },
  extraction_invalid: { line: () => REFERRED, resubmit: false },
  already_claimed: { line: () => 'You have already claimed on this cover.', resubmit: false },
  presence_not_completed: {
    line: () => "We couldn't verify you. Try again, or use a different device.",
    resubmit: true,
  },
  nullifier_mismatch: {
    line: () => 'The person who bought this cover has to be the person who claims it.',
    resubmit: true,
  },
  wrong_action: {
    line: () => "We couldn't verify you. Try again, or use a different device.",
    resubmit: true,
  },
  claim_not_decidable: { line: () => REFERRED, resubmit: false },
  policy_not_claimable: {
    line: () => 'This cover is not open for claims.',
    resubmit: false,
  },
  attestation_not_accepted: {
    line: () => 'Tick the box to say everything on your claim is true, then submit again.',
    resubmit: true,
  },
};

export interface ReasonLine {
  code: ReasonCode;
  line: string;
}

/** The sentence for one code, with its slots filled. */
export function reasonLine(code: ReasonCode, slots: ReasonSlots = {}): string {
  return COPY[code].line(slots);
}

export function reasonLines(codes: readonly ReasonCode[], slots: ReasonSlots = {}): ReasonLine[] {
  return byPriority(codes).map((code) => ({ code, line: reasonLine(code, slots) }));
}

export interface Resubmit {
  allowed: boolean;
  why: string;
}

/**
 * What to tell the person about trying again. Never empty on a decline: the
 * claim screen either says what would change the answer or why nothing would.
 */
export function resubmitFor(codes: readonly ReasonCode[], slots: ReasonSlots = {}): Resubmit {
  const ordered = byPriority(codes);
  const first = ordered[0];
  if (first === undefined) return { allowed: false, why: 'There is nothing to change.' };
  const blocking = ordered.find((code) => !COPY[code].resubmit);
  if (blocking !== undefined) {
    return { allowed: false, why: reasonLine(blocking, slots) };
  }
  return {
    allowed: true,
    why: 'If you have a document that shows a different end date, add it and submit again.',
  };
}
