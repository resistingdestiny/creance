import { reportUnreachable } from './api';
import type { SeniorityBand } from './bands';
import { heldRead } from './held-read';
import type { FundedBands } from './occupations';
import { fetchAllBands, type SeriesBandsView } from './worker-api';

/**
 * What capital has committed behind each occupation, and how much of it has
 * been written against.
 *
 * Cover is committed to an occupation and a band together, so "can I buy this"
 * has forty five answers rather than fifteen, and the honest one for most of
 * them may well be no. That answer is a fact about real subscriptions and so it
 * cannot be a constant the way the occupation list is: it is read from the API,
 * which reads it from rows.
 *
 * The same answer carries the other half of every price in the product. The
 * premium is `marketRate(guideRate(distance), utilisation)`, so a screen that
 * does not know the utilisation behind an occupation cannot quote it; it can
 * only quote the guide price, which is the price before capital has said what
 * it will take the risk for. `GET /v1/cover/bands` carries the exposure and
 * the principal for all fifteen in one free call, so one read answers both
 * questions and neither caller pays for its own.
 *
 * It is held for a minute, the same way the landing page holds its figures and
 * for the same reason: the picker is on the first screen a person sees, the
 * answer changes only when capital moves, and a hundred visitors arriving
 * together should cause one read rather than a hundred. src/lib/held-read.ts.
 *
 * A failed read returns undefined, which every helper that takes it treats as
 * unknown rather than as nothing funded. That fails open on purpose. The
 * experience screen and the quote are both authoritative a step later and both
 * refuse an unfunded band outright, so the cost of being wrong here is one more
 * tap; the cost of failing closed would be a front door that says this product
 * sells nothing every time a read times out.
 */

const HOLD_MS = 60_000;
const STALE_MS = 10 * 60_000;

const hold = heldRead<readonly SeriesBandsView[]>({
  what: 'what capital has funded',
  ttlMs: HOLD_MS,
  staleMs: STALE_MS,
  read: async () => (await fetchAllBands()).occupations,
});

async function readCapacity(): Promise<readonly SeriesBandsView[] | undefined> {
  try {
    return await hold.read();
  } catch (cause) {
    reportUnreachable('what capital has funded', cause);
    return undefined;
  }
}

export async function readFundedBands(): Promise<FundedBands | undefined> {
  const occupations = await readCapacity();
  if (occupations === undefined) return undefined;
  const funded: Record<string, SeniorityBand[]> = {};
  for (const occupation of occupations) {
    // Capital, not free capacity. A band that is full is a band capital did
    // choose, and it belongs on the funded side of this answer; the row that
    // is full says so for itself on the experience screen.
    funded[occupation.group] = occupation.bands
      .filter((band) => band.capital.amount !== '0')
      .map((band) => band.band);
  }
  return funded;
}

/**
 * Committed exposure over the principal still standing behind it, per
 * occupation, as a fraction.
 *
 * The series total rather than a band's, because the screens that read it are
 * about an occupation and not about one person's experience: the public index
 * explorer prices an occupation, and the market board's risk column is the same
 * figure per series. A band's own utilisation is what the purchase flow prices
 * against, and that comes back with the quote.
 *
 * An occupation is absent from the answer rather than nought when no principal
 * stands behind it. Nought is the utilisation of a funded series nobody has
 * bought from, which is a real and cheap state; a series with no principal has
 * no utilisation at all, and a caller that cannot tell the two apart would
 * quote the cheapest price in the product for capacity that does not exist.
 */
export async function readUtilisation(): Promise<Readonly<Record<string, number>>> {
  const occupations = await readCapacity();
  if (occupations === undefined) return {};
  const used: Record<string, number> = {};
  for (const occupation of occupations) {
    const principal = Number(occupation.principal_remaining.amount);
    const exposure = Number(occupation.active_exposure.amount);
    if (!Number.isFinite(principal) || !Number.isFinite(exposure) || principal <= 0) continue;
    used[occupation.group] = exposure / principal;
  }
  return used;
}

/**
 * The principal standing behind every occupation, added up, in minor units.
 *
 * The landing band said "100,000 funding the cover", which was one series'
 * funded principal presented as the product's capital. It understated the
 * product 4.5 times while overstating that series by the 3,000 already paid out
 * of it, on a page whose whole argument is that the figures are checkable.
 *
 * Remaining rather than funded, so a principal that has been paid out to a
 * policyholder stops being counted as standing behind anything, which is the
 * same base CoverPool binds against and the same one the market board's
 * capacity uses. Null rather than a partial sum when the read failed, because
 * a total that quietly lost a series is worse than no total.
 *
 * It reads the same held call readUtilisation does, so the landing pays nothing
 * for it beyond what the picker already buys.
 */
export async function readPrincipalBehindCover(): Promise<bigint | null> {
  const occupations = await readCapacity();
  if (occupations === undefined) return null;
  let total = 0n;
  for (const occupation of occupations) {
    try {
      total += BigInt(occupation.principal_remaining.amount);
    } catch {
      return null;
    }
  }
  return total;
}

/** Tests only. A module level hold outlives a test file otherwise. */
export function forgetFundedBands(): void {
  hold.forget();
}
