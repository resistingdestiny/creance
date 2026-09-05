import { headline } from '@creance/index-model';

import type { SeriesChainState } from '../chain/cover-pool.js';
import type { ObservationRow, PolicyRow, SeriesRow } from '../db/types.js';
import { AppError } from '../errors.js';
import { periodString } from './view.js';

/// Whether this cover can be claimed on, and the sentence that says it cannot.
///
/// Two keys open a claim and only one of them is here. The index key is the
/// series being ClaimsOpen, which is the chain's own answer and is read from it
/// at every claim rather than from the `policies.status` cache: on chain only
/// the series changes status when a month opens, the policies stay Active until
/// one is paid, and a second source of truth for "are claims open" is how the
/// screen and the contract end up disagreeing while somebody is watching. The
/// loss key is the packet, and that is the rest of this module's directory.
///
/// The refusal copy is verbatim from docs/DESIGN-TOKENS-ADDENDUM.md with the
/// real reading filled in: "Claims aren't open." and "The index for your
/// occupation is 1.1. Claims open above 2.0. We'll tell you here if that
/// changes." Which figure is quoted follows docs/DECISIONS.md, "The headline
/// index figure is whichever form is nearer its line, chosen server side", and
/// a level line is said as a distance from average rather than as a signed
/// number, which is the same decision the chart's band label took.

export interface ClaimsReading {
  /** `level` or `shock`, whichever form is nearer its line. */
  form: 'level' | 'shock';
  /** Points still to travel before that form opens. Negative once it is open. */
  distance: string;
  /** The published month the reading comes from. */
  period: string | null;
  attachment_shock: string;
  level_line: string;
  open: boolean;
}

export interface ClaimsOpenness {
  open: boolean;
  /** The machine code, the way the Adjuster returns `reasons[]`. */
  code: 'claims_open' | 'claims_not_open' | 'policy_not_claimable' | 'already_claimed';
  title: string;
  /** The sentences a screen prints verbatim, in order. */
  reason_lines: string[];
  reading: ClaimsReading | null;
}

/** The policy statuses a claim may be started from. */
const CLAIMABLE: PolicyRow['status'][] = ['active', 'bound', 'claims_open'];

export interface OpennessInput {
  policy: PolicyRow;
  series: SeriesRow;
  state: SeriesChainState;
  /** The newest published observation for the group, or null when there is none. */
  observation: ObservationRow | null;
}

export function claimsOpenness(input: OpennessInput): ClaimsOpenness {
  const reading = readingOf(input);

  if (input.policy.status === 'paid' || input.policy.status === 'declined') {
    return {
      open: false,
      code: 'already_claimed',
      title: "You've already claimed on this cover.",
      reason_lines: ['One claim per person per series, and this cover has had its claim.'],
      reading,
    };
  }
  if (!CLAIMABLE.includes(input.policy.status)) {
    return {
      open: false,
      code: 'policy_not_claimable',
      title: 'This cover cannot be claimed on.',
      reason_lines: [notClaimableLine(input.policy.status)],
      reading,
    };
  }
  if (input.state.status !== 'claims_open') {
    return {
      open: false,
      code: 'claims_not_open',
      title: "Claims aren't open.",
      reason_lines: [closedLine(input, reading)],
      reading,
    };
  }
  return { open: true, code: 'claims_open', title: 'Claims open', reason_lines: [], reading };
}

/** The same state as a refusal, for the endpoints that must not proceed. */
export function refuseClosed(state: ClaimsOpenness): AppError {
  return new AppError(
    409,
    state.code,
    state.title,
    state.reason_lines.join(' '),
    state.reason_lines.map((line) => ({ path: 'claims', message: line })),
  );
}

function readingOf(input: OpennessInput): ClaimsReading | null {
  const observation = input.observation;
  if (observation === null) return null;
  const reading = headline({
    groupKey: observation.groupKey,
    seriesId: input.series.seriesId,
    period: periodString(observation.period),
    uG: observation.uG,
    uAll: observation.uAll,
    e: observation.e,
    ebar: observation.ebar,
    ebarBase: null,
    odi: observation.odi,
    attachmentShock: input.series.attachmentShock,
    levelLine: input.series.levelLine,
    forms: [],
    levelOpen: observation.openReason === 'level' || observation.openReason === 'both',
    shockOpen: observation.openReason === 'shock' || observation.openReason === 'both',
    open: observation.open,
    openReason: observation.openReason ?? 'none',
    status: 'final',
  });
  if (reading === null) return null;
  return {
    form: reading.form,
    distance: reading.distance.toFixed(2),
    period: periodString(observation.period),
    attachment_shock: input.series.attachmentShock.toFixed(2),
    level_line: input.series.levelLine.toFixed(2),
    open: reading.open,
  };
}

/**
 * "The index for your occupation is 1.1. Claims open above 2.0. We'll tell you
 * here if that changes.", with the real numbers and in the form that is nearer.
 *
 * A consumer is never shown a signed index value, so the level form is said as
 * a distance from average in both directions. For the demo series the line is
 * -0.68, and "claims open above -0.68" is both the signed number that decision
 * forbids and, read plainly, wrong.
 */
function closedLine(input: OpennessInput, reading: ClaimsReading | null): string {
  const tail = "We'll tell you here if that changes.";
  if (reading === null) {
    return `No index has been published for your occupation yet. ${tail}`;
  }
  if (reading.form === 'shock') {
    const odi = input.observation?.odi ?? 0;
    return `The index for your occupation is ${odi.toFixed(2)}. Claims open above ${reading.attachment_shock}. ${tail}`;
  }
  const ebar = input.observation?.ebar ?? 0;
  return `Your occupation is ${againstAverage(ebar)}. Claims open ${lineAgainstAverage(input.series.levelLine)}. ${tail}`;
}

/** A signed excess said as a distance, which is how every screen says it. */
export function againstAverage(ebar: number): string {
  if (Math.abs(ebar) < 0.005) return 'the same as average';
  return ebar > 0
    ? `${ebar.toFixed(2)} worse than average`
    : `${Math.abs(ebar).toFixed(2)} better than average`;
}

/** The level line, said the same way. */
export function lineAgainstAverage(levelLine: number): string {
  return levelLine < 0
    ? `within ${Math.abs(levelLine).toFixed(2)} of average`
    : `above ${levelLine.toFixed(2)} worse than average`;
}

function notClaimableLine(status: PolicyRow['status']): string {
  switch (status) {
    case 'lapsed':
      return 'This cover lapsed after a missed payment, so there is nothing to claim on.';
    case 'expired':
      return 'This cover has ended.';
    case 'claimed':
    case 'under_review':
    case 'approved':
      return 'A claim on this cover is already being decided.';
    default:
      return 'This cover is not active yet.';
  }
}
