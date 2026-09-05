/**
 * The arithmetic and the wording behind the claim screens.
 *
 * The same rule src/lib/worker-model.ts follows: every figure and every
 * sentence has one definition here, and the screens hold none of it, so two
 * screens cannot disagree about what the cover pays or when it pays it.
 *
 * The copy is docs/DESIGN-TOKENS-ADDENDUM.md, verbatim, with the amounts, the
 * dates and the occupation interpolated from the policy and the series as its
 * closing line requires. Its house style rules the strings here: sentence
 * case, no em or en dashes, and none of the words "policy", "bind", "settle",
 * "parametric" or "nullifier" anywhere a worker can read them.
 */

import { formatDay, formatDayWithYear, formatPeriodShort } from './format';
import type { Surface } from './surface';
import type { ClaimStatusView, ReplayView } from './claim-api';
import type { PolicyView } from './worker-api';
import type { StatusState } from '../components/status-pill';
import { coverAmount, premiumAmount } from './worker-model';

/**
 * The five choices on C2, and the separation type each one means.
 *
 * The addendum fixes five labels and packages/client carries eight types, so
 * two pairs collapse: "laid off or made redundant" is stored as `redundancy`
 * and "position eliminated or workplace closed" as `position_eliminated`. Both
 * pairs are treated identically by every rule in docs/CLAIMS.md, so nothing
 * downstream can tell the difference, and asking a person to split a hair the
 * adjudication does not split would be a worse screen. Recorded in
 * docs/DECISIONS.md.
 */
export interface SeparationOption {
  readonly value: string;
  readonly label: string;
  /** Not covered in v1 (DESIGN.md 3.9). C2 says so under the field. */
  readonly excluded: boolean;
}

export const SEPARATION_OPTIONS: readonly SeparationOption[] = [
  { value: 'redundancy', label: 'Laid off or made redundant', excluded: false },
  { value: 'position_eliminated', label: 'Position eliminated or workplace closed', excluded: false },
  { value: 'dismissal_for_cause', label: 'Dismissed', excluded: true },
  { value: 'resignation', label: 'I resigned', excluded: true },
  { value: 'fixed_term_end', label: 'My contract ended', excluded: true },
];

/** The inline line under the field, in `triggered`, when the choice is excluded. */
export const EXCLUDED_NOTE =
  "Cover doesn't pay for this. You can still submit and a person will look at it.";

export function separationOption(value: string | null): SeparationOption | null {
  return SEPARATION_OPTIONS.find((option) => option.value === value) ?? null;
}

export function isExcludedSeparation(value: string | null): boolean {
  return separationOption(value)?.excluded === true;
}

/** How C5 says the choice back, and how the review queue reads it. */
export function separationLabel(value: string | null): string {
  return separationOption(value)?.label ?? (value ?? '');
}

/**
 * The evidence kind a file is submitted under.
 *
 * The API takes one of five kinds and the addendum's C3 offers four documents
 * without asking which is which. Asking would be a field nobody can answer
 * wrongly in a way that matters: the Adjuster reads the document itself and
 * every rule works from what it says, not from the label the uploader chose.
 * So every file goes up as `other` unless its own name says otherwise.
 */
export function evidenceKind(filename: string): string {
  const name = filename.toLowerCase();
  if (/p45|record.?of.?employment|\broe\b/.test(name)) return 'p45';
  // "benefit-determination" ends in "termination", so the benefit test runs
  // first rather than relying on a boundary that a hyphen does not give.
  if (/benefit|determination|unemploy/.test(name)) return 'benefit_determination';
  if (/termination|redundan|dismiss|layoff|notice/.test(name)) return 'termination_letter';
  if (/pay.?(slip|statement|stub)|final.?pay/.test(name)) return 'final_pay_statement';
  return 'other';
}

/** The states Home can be in. The tab bar stays on Home and Index only. */
export type HomeState = 'covered' | 'claims_open' | 'claim_in_progress' | 'paid' | 'lapsed';

export interface HomeStatus {
  readonly state: HomeState;
  /** The card's status pill: `watch` is amber, `triggered` is red. */
  readonly pill: StatusState;
  readonly label: string;
}

const HOME_STATUS: Record<HomeState, HomeStatus> = {
  covered: { state: 'covered', pill: 'covered', label: 'Covered' },
  claims_open: { state: 'claims_open', pill: 'watch', label: 'Claims open' },
  claim_in_progress: { state: 'claim_in_progress', pill: 'watch', label: 'Claim in progress' },
  paid: { state: 'paid', pill: 'triggered', label: 'Paid out' },
  lapsed: { state: 'lapsed', pill: 'triggered', label: 'Payment due' },
};

export function homeStatus(state: HomeState): HomeStatus {
  return HOME_STATUS[state];
}

/**
 * Which state Home is in, from the cover and the claim behind it.
 *
 * The order is the order the states supersede each other. A paid claim is the
 * end of this cover's life, so it wins over everything; a claim in flight wins
 * over the invitation to start one; the amber "Claims open" pill needs both
 * the chain's answer and no claim of this browser's own.
 */
export function homeStateOf(policy: PolicyView, claim: ClaimStatusView | null): HomeState {
  if (policy.status === 'paid' || claim?.status === 'paid') return 'paid';
  if (claim !== null && claim.status !== 'declined') return 'claim_in_progress';
  if (policy.status === 'lapsed') return 'lapsed';
  if (policy.claims?.open === true) return 'claims_open';
  return 'covered';
}

/**
 * "If you lost your job on or after 4 June, you can claim 5,000."
 *
 * The date is `claims_payable_from`, which is the start plus the waiting
 * period and the first day a separation can qualify, and the amount is the
 * cover limit. Neither is ever hard coded in the copy.
 */
export function claimsOpenLine(policy: PolicyView): string {
  return `If you lost your job on or after ${formatDay(policy.claims_payable_from)}, you can claim ${coverAmount(policy.limit)}.`;
}

/**
 * The Index row on Home, which has to agree with the pill above it.
 *
 * A series stays ClaimsOpen for the whole claim window, and the index can fall
 * back under its line while it is open: on the demo series April 2026 opened
 * claims and July 2026 reads 0.69 points short of the line, with the window
 * running to October. So the reading is printed as it stands, because it is
 * true, and the caption is the cover's own answer rather than the latest
 * month's, because an amber "Claims open" pill over the words "Points from
 * opening claims" is a screen contradicting itself. Recorded in
 * docs/harness-notes.md.
 */
export function indexRow(
  reading: { value: string; caption: string; open: boolean } | null,
  claimsOpen: boolean,
  occupation: string,
): { value: string; caption: string } | null {
  if (reading === null) return null;
  if (claimsOpen && !reading.open) {
    return { value: reading.value, caption: `Claims are open for ${occupation}.` };
  }
  return { value: reading.value, caption: reading.caption };
}

/** Everything Home renders, in one object, decided on the server. */
export interface HomeView {
  readonly policyId: string;
  readonly occupation: string;
  /** Whole cover amounts, which is what the card's display number takes. */
  readonly cover: number;
  readonly status: HomeStatus;
  readonly nextPayment: string;
  readonly index: { readonly value: string; readonly caption: string } | null;
  /** The Claims open state's one line under the group. */
  readonly claimsOpen: string | null;
  /** The Paid state's row: the amount received and the day it arrived. */
  readonly paid: { readonly amount: string; readonly day: string | null } | null;
  readonly lapsed: LapsedCopy | null;
  /** "Replay: Jul 2026", or null when the clock is live. */
  readonly replayBadge: string | null;
}

/**
 * The waiting period, in days, from the cover's own dates.
 *
 * C1 says "in the first 60 days of cover" and the addendum's closing line makes
 * the waiting period an interpolated figure, not a constant. It is the gap
 * between the cover starting and the first day a separation can qualify, which
 * is what `claims_payable_from` means.
 */
export function waitingPeriodDays(policy: PolicyView): number {
  const start = Date.parse(`${policy.cover_starts}T00:00:00Z`);
  const payable = Date.parse(`${policy.claims_payable_from}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(payable)) return 0;
  return Math.max(0, Math.round((payable - start) / 86_400_000));
}

/** The Lapsed state, docs/DESIGN-TOKENS.md section 8, with the real date. */
export interface LapsedCopy {
  readonly heading: string;
  readonly line: string;
  readonly action: string;
}

export function lapsedCopy(policy: PolicyView): LapsedCopy {
  const premium = premiumAmount(policy.premium);
  const due = policy.next_payment_due;
  return {
    heading: 'Payment due',
    line:
      due === null
        ? 'Pay to stay covered.'
        : `Pay by ${formatDay(due)} to stay covered.`,
    action: `Pay ${premium}`,
  };
}

/**
 * The Payment failed state, with the amount and the date interpolated.
 *
 * The deck's sentence is written for a payment that keeps existing cover
 * alive, which is the lapsed case: "Your cover is unchanged until 19 October."
 * There is no cover to be unchanged during a purchase, so the purchase screen
 * gets the same title and a second sentence that is true of it. Recorded in
 * docs/DECISIONS.md.
 */
export interface FailureCopy {
  readonly title: string;
  readonly body: string;
  readonly action: string;
}

export function paymentFailedCopy(policy: PolicyView): FailureCopy {
  const premium = premiumAmount(policy.premium);
  const due = policy.next_payment_due;
  return {
    title: "Your payment didn't go through.",
    body:
      due === null
        ? `Check that your wallet has at least ${premium}, then try again.`
        : `Check that your wallet has at least ${premium}, then try again. Your cover is unchanged until ${formatDay(due)}.`,
    action: `Pay ${premium}`,
  };
}

export function purchaseFailedCopy(premium: string, detail: string): FailureCopy {
  return { title: "Your payment didn't go through.", body: detail, action: `Pay ${premium}` };
}

/** The states C4 can be in, which are the Verify screen's own. */
export type ClaimCheckState = 'idle' | 'waiting' | 'verified' | 'failed';

export interface ClaimCheckCopy {
  readonly heading: string;
  readonly line: string;
  readonly button: string;
}

/**
 * C4's copy, per state, from docs/DESIGN-TOKENS-ADDENDUM.md and only from it.
 *
 * The failed state is the purchase Verify screen's, word for word, because the
 * addendum gives C4 the same two sentences for it. What changes between the two
 * screens is the reason a check is being asked for, which is the second line.
 *
 * It drops the offer of a second device inside World App for the reason
 * src/lib/worker-model.ts gives: there is no second device to move to.
 */
export function claimCheckCopy(
  state: ClaimCheckState,
  surface: Surface = 'browser',
): ClaimCheckCopy {
  if (state === 'failed') {
    return {
      heading: "We couldn't verify you.",
      line: surface === 'world-app' ? 'Try again.' : 'Try again, or use a different device.',
      button: 'Try again',
    };
  }
  return {
    heading: "Confirm it's you.",
    line: 'The same person who bought the cover has to claim it.',
    button: state === 'verified' ? 'Continue' : 'Verify with World ID',
  };
}

/** Which of C6 to C9 a claim is on. The decision replaces C6 when it arrives. */
export type ClaimScreen = 'received' | 'under_review' | 'approved' | 'declined';

export function claimScreenOf(claim: ClaimStatusView): ClaimScreen {
  if (claim.status === 'approved' || claim.status === 'paid') return 'approved';
  if (claim.status === 'declined') return 'declined';
  if (claim.status === 'under_review') return 'under_review';
  return 'received';
}

/** A decision has arrived, so the screen stops polling. */
export function claimIsDecided(claim: ClaimStatusView): boolean {
  return claim.status !== 'submitted';
}

/**
 * A timestamp as a day, en-GB and in UTC.
 *
 * The claim endpoints answer in RFC 3339 and src/lib/format.ts takes calendar
 * dates, deliberately: a date built from a local timezone is how a screen ends
 * up a day out from the contract. The day is the part of a timestamp a claim
 * screen ever shows, so it is taken off the front rather than parsed.
 */
export function claimDay(timestamp: string): string {
  return formatDayWithYear(timestamp.slice(0, 10));
}

/** The short reference C8 shows. A claim id is public; its tail is enough to say. */
export function claimReference(claimId: string): string {
  const body = claimId.replace(/^clm_/, '');
  return body.slice(-6).toUpperCase();
}

/**
 * The sentences a decline is printed from, when the composed ones cannot be
 * read.
 *
 * The Adjuster composes the real sentences and the web app prints them
 * verbatim (docs/CLAIMS.md, "What the person reads"). This is the fallback for
 * a deployment with no admin token: the codes are on the free read, and these
 * are the same sentences with every slot that needs a date left out, so a
 * person still learns why rather than reading a code.
 */
const FALLBACK_LINES: Record<string, string> = {
  separation_type_not_covered:
    "Resigning isn't covered. This cover pays when your employer ends your job.",
  group_does_not_match_policy: 'This cover is for a different occupation from the one on your claim.',
  separation_in_waiting_period: 'Your last day of work is before your cover started paying out.',
  separation_after_term: 'Your last day of work falls after your cover ended.',
  outside_loss_window:
    'The index for your occupation did not rise in the months around your last day of work.',
  claim_window_closed: 'The time to claim for this has ended.',
  evidence_contradicts_separation_type:
    'Your document says you left by choice, but your statement says your employer ended your job.',
  'evidence_does_not_match_attestation:employer':
    'The document names a different employer from your statement.',
  'evidence_does_not_match_attestation:date':
    'The document gives a different last day of work from your statement.',
  'evidence_does_not_match_attestation:name':
    'The document is in a different name from the one on your statement.',
  evidence_missing: 'Add a document that shows your employer ended your job.',
  evidence_unreadable: 'We could not read that document. Send a clearer photo or a PDF.',
  already_claimed: 'You have already claimed on this cover.',
  nullifier_mismatch: 'The person who bought this cover has to be the person who claims it.',
};

/** The order a reader should meet several reasons in, docs/CLAIMS.md. */
const REASON_PRIORITY: readonly string[] = [
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

export function fallbackReasonLines(codes: readonly string[]): string[] {
  const rank = (code: string): number => {
    const at = REASON_PRIORITY.indexOf(code);
    return at === -1 ? REASON_PRIORITY.length : at;
  };
  return [...codes]
    .sort((a, b) => rank(a) - rank(b))
    .map((code) => FALLBACK_LINES[code])
    .filter((line): line is string => line !== undefined);
}

/**
 * The badge, "Replay: Jul 2026".
 *
 * The endpoint's own `badge.label` is the word REPLAY, and the deck's string
 * names the month the clock is standing on, so the month is put back here from
 * `current_period`. In scenario mode the endpoint's label is the scenario's
 * own name and is printed as it stands. Null when the clock is live, which is
 * a screen with no badge at all.
 */
export function replayBadgeLabel(replay: ReplayView | null): string | null {
  if (replay === null || replay.badge === null || !replay.badge.show) return null;
  if (replay.mode === 'scenario') return replay.badge.label;
  const period = replay.current_period ?? replay.latest_published;
  return period === null ? 'Replay' : `Replay: ${formatPeriodShort(period)}`;
}
