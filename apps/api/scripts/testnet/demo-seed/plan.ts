/// The chain free half of `pnpm demo:seed`: what the demonstration needs to
/// exist before a camera is switched on, which stages still have work to do,
/// and the recorded sequence the video walks.
///
/// Everything here is pure, so `pnpm test` covers all of it and never touches
/// testnet. The runner beside it does the writing, and asks the chain rather
/// than this file whenever the chain knows the answer: the loss window, the
/// reserve and the series status are read from CoverPool, not recomputed.

/** The stages, in the order a first run walks them. */
export const STAGES = ['status', 'policies', 'investors', 'packets', 'verify'] as const;
export type Stage = (typeof STAGES)[number];

/** What `pnpm demo:seed` with no argument runs. */
export const RUN: Stage[] = ['status', 'policies', 'investors', 'packets', 'verify'];

/// The two committed packets, each pinned to the account that carries it on
/// camera. The letters themselves live under apps/adjuster/fixtures and are
/// rendered by `pnpm --filter @creance/adjuster fixtures`; the seed stages
/// them, it never invents one. Both employers are invented.
export interface PacketPlan {
  /** `a` approves and pays, `b` declines on the separation type. */
  packet: 'a' | 'b';
  /** The account in docs/hedera.testnet.json that holds the cover. */
  role: string;
  employer: string;
  claimant: string;
  jobTitle: string;
  /** Last day of work, the date the loss window is measured against. */
  separationDate: string;
  /** What the Adjuster does with it, said plainly so a take can be checked. */
  outcome: 'approve' | 'decline';
  document: string;
  /** The committed document's fingerprint, so a swapped file is caught here. */
  sha256: string;
}

export const PACKETS: PacketPlan[] = [
  {
    packet: 'a',
    role: 'policyholder-1',
    employer: 'Northgate Systems Ltd',
    claimant: 'Alex Mercer',
    jobTitle: 'Software Engineer',
    separationDate: '2026-03-13',
    outcome: 'approve',
    document: 'packet-a/letter.pdf',
    sha256: 'c92a84402195993a9472418ce9ed0ddb11435f6688e4acfaabe13d07422588f5',
  },
  {
    packet: 'b',
    role: 'policyholder-3',
    employer: 'Calder & Finch LLP',
    claimant: 'Robin Vale',
    jobTitle: 'Data Analyst',
    separationDate: '2026-03-06',
    outcome: 'decline',
    document: 'packet-b/letter.pdf',
    sha256: 'ad1ef4663c8a1df95b6c230537b77ffb3c6d7534f4570731d76494961ff289fe',
  },
];

/// The cover each demonstration policy carries. These are the numbers already
/// on testnet from the T13 and T16 runs, not the ones the pre-kick-off plan
/// guessed, so a rebuilt demonstration matches the transactions docs/HEDERA.md
/// already links.
export const COVER = {
  /** 1,000 TUSD, in minor units. */
  limit: '1000000000',
  /** 28.00 TUSD a month. */
  premium: '28000000',
  /**
   * The day cover began. `CoverPool.bind` does not validate `startAt`, so this
   * is a stated fact about a demonstration and it is said out loud in the
   * video: see docs/DECISIONS.md, "A policy is bound with a backdated start for
   * the demonstration, and it is said out loud".
   */
  startAt: '2025-12-01',
};

/** The two noteholders the investor screens and the coupon are shown against. */
export const INVESTOR_ROLES = ['investor-1', 'investor-2'];

export interface SeededPolicy {
  role: string;
  packet: 'a' | 'b';
  policyId: string;
  accountId: string;
  address: string;
  startAt: string;
  claimsPayableFrom: string;
  limit: string;
  bindTx?: string;
  nftSerial?: number;
}

export interface SeedRecord {
  network: string;
  seededAt?: string;
  series?: { label: string; seriesId: string; groupKey: string };
  policies: SeededPolicy[];
  investors: { role: string; accountId: string; address: string; note?: string }[];
  packets: { packet: 'a' | 'b'; policyId: string; sha256: string; bytes: number }[];
  /** When each stage last finished, so a second run can say what it skipped. */
  stages: Partial<Record<Stage, { at: string; note: string }>>;
}

export function emptyRecord(network: string): SeedRecord {
  return { network, policies: [], investors: [], packets: [], stages: {} };
}

/**
 * Which stages a run walks.
 *
 * The same shape as `pnpm ats:issue` and `pnpm coupons:pay`: no argument runs
 * everything, a named stage runs that one alone so a run that died half way
 * through is resumed rather than restarted.
 */
export function stagesToRun(requested: string | undefined): Stage[] {
  const name = requested ?? 'all';
  if (name === 'all') return [...RUN];
  if ((STAGES as readonly string[]).includes(name)) return [name as Stage];
  throw new Error(`unknown stage "${name}". One of: ${[...STAGES, 'all'].join(', ')}`);
}

/**
 * The packets that still have no cover to claim on.
 *
 * Idempotence is decided here and nowhere else: a role whose recorded policy is
 * still usable is left alone, so a second run binds nothing. The runner decides
 * what "usable" means by asking the database and the chain, and passes the
 * answer in.
 */
export function packetsNeedingCover(record: SeedRecord, usable: (policyId: string) => boolean): PacketPlan[] {
  return PACKETS.filter((plan) => {
    const held = record.policies.find((policy) => policy.packet === plan.packet);
    return held === undefined || !usable(held.policyId);
  });
}

/**
 * What the bind command printed, read back so the seed can compose it rather
 * than reimplement it.
 *
 * `pnpm --filter @creance/api testnet:bind-backdated` ends with a block of
 * aligned name and value lines. Parsing that block is the price of composing a
 * command instead of copying two hundred lines of it into this directory.
 */
export function parseBoundPolicy(stdout: string): {
  policyId: string;
  coverKey?: string;
  bindTx?: string;
  nftSerial?: number;
  claimsPayableFrom?: string;
} {
  const policyId = /^policy\s+(pol_[0-9A-Z]+)$/m.exec(stdout)?.[1];
  if (policyId === undefined) {
    throw new Error('the bind command printed no policy id, so nothing was bound');
  }
  const bindTx = /^bind\s+https:\/\/hashscan\.io\/testnet\/transaction\/(\S+)$/m.exec(stdout)?.[1];
  const serial = /^policy receipt \S+ serial (\d+)$/m.exec(stdout)?.[1];
  const payable = /^claims payable from (\d{4}-\d{2}-\d{2})$/m.exec(stdout)?.[1];
  // The key is printed once, in groups of four, and can never be printed
  // again: the database holds a digest of it and nothing else. So it is read
  // here or the cover the seed just bound has no way in.
  const grouped = /^cover key\s+([0-9A-Z][0-9A-Z ]*)$/m.exec(stdout)?.[1];
  const coverKey = grouped === undefined ? undefined : grouped.replace(/\s/g, '');
  return {
    policyId,
    ...(coverKey === undefined ? {} : { coverKey }),
    ...(bindTx === undefined ? {} : { bindTx }),
    ...(serial === undefined ? {} : { nftSerial: Number(serial) }),
    ...(payable === undefined ? {} : { claimsPayableFrom: payable }),
  };
}

/**
 * Whether a packet can be claimed on the cover the seed bound for it, judged
 * on the parts of DESIGN.md 3.9 that are arithmetic on the policy: the
 * separation is after the waiting period and inside the term, and the claim
 * window has not closed. Whether the separation month is in the loss window is
 * the chain's answer and is asked of `CoverPool.isInLossWindow`.
 *
 * Returns the problems in the words the operator needs, empty when the packet
 * is ready to go on camera.
 */
export function coverProblems(
  plan: PacketPlan,
  policy: { claimsPayableFrom: string; endsAt: string },
  windowEndsAt: Date,
  now: Date,
): string[] {
  const problems: string[] = [];
  const separation = Date.parse(`${plan.separationDate}T00:00:00Z`);
  if (separation < Date.parse(`${policy.claimsPayableFrom}T00:00:00Z`)) {
    problems.push(
      `separation ${plan.separationDate} is inside the waiting period, which ends ${policy.claimsPayableFrom}`,
    );
  }
  if (separation > Date.parse(policy.endsAt)) {
    problems.push(`separation ${plan.separationDate} is after the cover ended ${policy.endsAt.slice(0, 10)}`);
  }
  if (now.getTime() >= windowEndsAt.getTime()) {
    problems.push(`the claim window closed ${windowEndsAt.toISOString()}`);
  }
  return problems;
}

/** A minor unit amount printed the way a person reads it. */
export function inUnits(minor: string | bigint, decimals: number): string {
  const value = BigInt(minor);
  const scale = 10n ** BigInt(decimals);
  const whole = (value / scale).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const rest = (value % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  return rest === '' ? whole : `${whole}.${rest}`;
}
