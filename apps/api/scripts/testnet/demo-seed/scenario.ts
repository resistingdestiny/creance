/// The replay scenario: DESIGN.md section 7 as ordered data rather than prose.
///
/// It is here and not in a JSON file under apps/oracle/scenarios because an
/// oracle scenario is a synthetic trigger that writes neither the index topic
/// nor the chain (docs/DECISIONS.md, T12), and nothing in a demonstration path
/// runs against a mock. Every beat below runs against Hedera testnet on real
/// published BLS history.
///
/// `pnpm demo:seed scenario` prints it, docs/DEMO.md carries the same table,
/// and the unit tests check that the beats stay in order, that the cut stays
/// inside the two to four minute gate ETHGlobal enforces, and that the four
/// things the ticket names are all in it.

export type Surface = 'slide' | 'browser' | 'terminal' | 'phone';

export interface Beat {
  /** 1 to 9, the shot number in the take log. */
  shot: number;
  /** Seconds from the start of the cut. */
  from: number;
  to: number;
  title: string;
  /** What is on camera. The phone is mirrored over USB, never filmed. */
  surface: Surface[];
  /** What must already be true, all of it produced by `pnpm demo:seed`. */
  before: string[];
  /** The exact commands, in order. Empty when the shot is only clicking. */
  commands: string[];
  /** What has to be legible on screen for the shot to count. */
  watch: string[];
  /** The beats the acceptance names, so the test can find them. */
  proves?: ('reserve' | 'approved-claim' | 'declined-claim' | 'reserve-release')[];
  /** Kept in the showcase cut, which drops the harness beat. */
  showcase: boolean;
}

export const SCENARIO: Beat[] = [
  {
    shot: 1,
    from: 0,
    to: 18,
    title: 'The problem and the structure',
    surface: ['slide'],
    before: ['one static slide, four lines, no animation'],
    commands: [],
    watch: [
      'workers buy monthly cover against their occupation being displaced',
      'AI long investors fund the payouts and earn the premiums',
      'a public index says when claims open, a proof of loss says who gets paid',
    ],
    showcase: true,
  },
  {
    shot: 2,
    from: 18,
    to: 60,
    title: 'The worker buys cover',
    surface: ['browser', 'phone'],
    before: [
      'a fourth wallet funded, associated with TUSD and holding ten times the premium',
      'the Sandbox App signed in and the eligibility action unused for this occupation',
      'the API and the web app running, X402_ENABLED as it is in production',
    ],
    commands: ['pnpm dev'],
    watch: [
      '/occupation, the row Computer and mathematical',
      '/amount, the premium recomputing when the slider moves and returning to the seeded amount',
      'the Selfie Check running on the mirrored phone and the browser saying You are verified',
      '/home, the pill Covered and the next payment date',
    ],
    showcase: true,
  },
  {
    shot: 3,
    from: 60,
    to: 98,
    title: 'The Steward buys for its principal',
    surface: ['terminal'],
    before: [
      'the API running with the x402 gate on',
      'the Steward profile apps/steward/profiles/policyholder-2.json unchanged',
      'the steward account funded in HBAR and TUSD',
    ],
    commands: ['pnpm steward:run --as-of 2024-07 --cadence demo'],
    watch: [
      '402 PAYMENT-REQUIRED, scheme exact, network hedera-testnet',
      'the settlement transaction id and 200 OK',
      'the written rule firing, then bind with the policy id, the NFT serial and the receipt sequence',
      'one Scheduled Transaction per premium with its schedule id',
    ],
    showcase: true,
  },
  {
    shot: 4,
    from: 98,
    to: 132,
    title: 'The investor and the note',
    surface: ['browser', 'terminal'],
    before: [
      'the note issued and both noteholders KYC granted and minted, which pnpm demo:seed leaves in place',
      'the coupon settled, so there is a distribution to point at',
    ],
    commands: ['pnpm ats:issue status', 'pnpm coupons:pay status'],
    watch: [
      '/invest/ODI-COMP-2026-01, principal, coupon, term and principal at risk',
      'the transfer to a non KYC account failing compliance, in words',
      'the same transfer succeeding after the KYC grant',
      'the coupon distribution executed by a Scheduled Transaction on HashScan',
    ],
    showcase: true,
  },
  {
    shot: 5,
    from: 132,
    to: 164,
    title: 'The replay opens a month and the vault reserves',
    surface: ['browser', 'terminal'],
    before: [
      'the index topic already carries 2025-01 to 2026-04 from the proof run',
      '2026-05 is not yet on the topic and not yet submitted, which pnpm demo:seed checks',
      'the replay started before the shot and recording continuous from the first tick',
    ],
    commands: ['pnpm oracle:preflight', 'pnpm oracle:replay --from 2026-01 --to 2026-05'],
    watch: [
      'the sticky replay bar advancing a month at a time on /index/ODI-COMP-2026-01',
      '2026-05 publishing for the first time and opening on the level form',
      'the reserve rising in the vault, printed by the run and readable on /invest',
      '/home flipping to Claims open with the date a separation has to be on or after',
    ],
    proves: ['reserve'],
    showcase: true,
  },
  {
    shot: 6,
    from: 164,
    to: 194,
    title: 'The claim that pays',
    surface: ['browser', 'phone', 'terminal'],
    before: [
      'the policyholder-1 cover bound by pnpm demo:seed, claims payable from 2026-01-30',
      'packet A staged, the redundancy letter ready to upload',
      'the reserve at or above the cover limit, which the seed verifies',
    ],
    commands: ['pnpm adjuster:run'],
    watch: [
      'C2 pre-filled with Northgate Systems Ltd and the last day of work 13 March 2026',
      'the second Selfie Check, action occupation-cover-claim, with user presence',
      'the packet hash and the decision hash on the claims topic',
      'payClaim on HashScan and /home reading Paid out',
    ],
    proves: ['approved-claim'],
    showcase: true,
  },
  {
    shot: 7,
    from: 194,
    to: 206,
    title: 'The claim that does not pay',
    surface: ['browser'],
    before: [
      'the policyholder-3 cover bound by pnpm demo:seed',
      'packet B staged, the resignation acknowledgement',
      'a second browser profile, so the two claimants are never the same session',
    ],
    commands: ['pnpm adjuster:run'],
    watch: [
      'C9 with the sentence the Adjuster wrote, not a code',
      'the resubmission path underneath it',
      'the same decision hash on the claims topic',
    ],
    proves: ['declined-claim'],
    showcase: true,
  },
  {
    shot: 8,
    from: 206,
    to: 218,
    title: 'The money closes the loop',
    surface: ['browser', 'terminal'],
    before: [
      'the paid claim from shot 6 settled, so the principal has already moved',
      'the release proved on a short window series, run before the take',
    ],
    commands: [
      'pnpm --filter @creance/api claims:close-windows --dry-run',
      'pnpm --filter @creance/contracts demo:release',
    ],
    watch: [
      '/invest, principal at risk down by the paid claim',
      'the demo series refusing to close, with the date it can, said out loud',
      'the Released event on the short window series on HashScan',
    ],
    proves: ['reserve-release'],
    showcase: true,
  },
  {
    shot: 9,
    from: 218,
    to: 230,
    title: 'The harness improvement and the close',
    surface: ['terminal', 'slide'],
    before: ['the harness clip recorded separately on the same day'],
    commands: [],
    watch: ['the improvement running', 'the end card with the repository URL'],
    showcase: false,
  },
];

/** The whole cut, in seconds. ETHGlobal rejects anything outside 120 to 240. */
export function runtime(beats: Beat[] = SCENARIO): number {
  const last = beats[beats.length - 1];
  return last === undefined ? 0 : last.to;
}

/** The showcase cut of DESIGN.md section 7: the harness beat drops out. */
export function showcase(beats: Beat[] = SCENARIO): Beat[] {
  return beats.filter((beat) => beat.showcase);
}

/** mm:ss, the way a shot list and a take log both write a timing. */
export function timecode(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds - minutes * 60).padStart(2, '0')}`;
}

/**
 * What is wrong with a cut, in the operator's words. Empty is a cut that can be
 * shot. The gates are ETHGlobal's own: contiguous beats so nothing is missing,
 * a runtime inside two to four minutes, and every acceptance beat present.
 */
export function scenarioProblems(beats: Beat[] = SCENARIO): string[] {
  const problems: string[] = [];
  let at = 0;
  for (const beat of beats) {
    if (beat.from !== at) {
      problems.push(`shot ${beat.shot} starts at ${timecode(beat.from)} and the one before ended at ${timecode(at)}`);
    }
    if (beat.to <= beat.from) problems.push(`shot ${beat.shot} has no length`);
    if (beat.watch.length === 0) problems.push(`shot ${beat.shot} says nothing about what must be on screen`);
    at = beat.to;
  }
  const total = runtime(beats);
  if (total < 120) problems.push(`the cut is ${timecode(total)}, under the two minute floor`);
  if (total > 240) problems.push(`the cut is ${timecode(total)}, over the four minute ceiling`);
  const proved = new Set(beats.flatMap((beat) => beat.proves ?? []));
  for (const required of ['reserve', 'approved-claim', 'declined-claim', 'reserve-release'] as const) {
    if (!proved.has(required)) problems.push(`nothing in the cut shows the ${required.replace('-', ' ')}`);
  }
  return problems;
}
