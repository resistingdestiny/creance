import { reportUnreachable } from './api';
import type { SeniorityBand } from './bands';
import { heldRead } from './held-read';
import type { FundedBands } from './occupations';
import { fetchAllBands } from './worker-api';

/**
 * Which experience bands capital has chosen, per occupation.
 *
 * Cover is committed to an occupation and a band together, so "can I buy this"
 * has forty five answers rather than fifteen, and the honest one for most of
 * them may well be no. That answer is a fact about real subscriptions and so it
 * cannot be a constant the way the occupation list is: it is read from the API,
 * which reads it from rows.
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

const hold = heldRead<FundedBands>({
  what: 'what capital has funded',
  ttlMs: HOLD_MS,
  staleMs: STALE_MS,
  read: async () => {
    const view = await fetchAllBands();
    const funded: Record<string, SeniorityBand[]> = {};
    for (const occupation of view.occupations) {
      // Capital, not free capacity. A band that is full is a band capital did
      // choose, and it belongs on the funded side of this answer; the row that
      // is full says so for itself on the experience screen.
      funded[occupation.group] = occupation.bands
        .filter((band) => band.capital.amount !== '0')
        .map((band) => band.band);
    }
    return funded;
  },
});

export async function readFundedBands(): Promise<FundedBands | undefined> {
  try {
    return await hold.read();
  } catch (cause) {
    reportUnreachable('what capital has funded', cause);
    return undefined;
  }
}

/** Tests only. A module level hold outlives a test file otherwise. */
export function forgetFundedBands(): void {
  hold.forget();
}
