import { SENIORITY_BANDS, bandUtilisation, type SeniorityBand } from '@creance/index-model';

import type { SeriesChainState } from './chain/cover-pool.js';
import type { PolicyStatus, Repository } from './db/types.js';

/// Where every band figure comes from.
///
/// Cover is sold in three experience bands and the band moves the market term
/// of the price and nothing else (see @creance/index-model's pricing module and
/// docs/DECISIONS.md). The market term is utilisation, and utilisation per band
/// needs two amounts per band: the exposure written in it and the capital
/// committed to it. Neither is on chain. `CollateralVault` takes a subscription
/// against a series and `CoverPool` reports one exposure figure for a series,
/// because both were frozen before bands existed and neither can be redeployed
/// under the covers that are live on them.
///
/// So the split is off chain, and it is off chain in rows rather than in a
/// constant. No multiplier is applied to a band anywhere in this codebase: a
/// band is dearer or cheaper only because real capital did or did not choose
/// it, in exactly the way utilisation has always worked.
///
/// The four inputs, and where each is read:
///
///   P   principal remaining        CollateralVault, through the chain gateway
///   E   active exposure            CoverPool, through the chain gateway
///   A(b) capital committed to b    `band_subscriptions` rows, summed per band
///   X(b) exposure written in b     `policies` rows with that band, summed
///
/// and the two the arithmetic derives:
///
///   U    = P - sum A(b)            principal no subscription named a band for
///   X(u) = E - sum X(b)            exposure no policy named a band for
///
/// Then, and this is the whole rule:
///
///   capital(b)  = A(b) + U
///   exposure(b) = X(b) + X(u)
///
/// Capital that named no band is capital that will take any band, so it stands
/// behind all three. It is not divided between them and it is not reserved to
/// one: whichever band sells first draws on it. That means the three bands'
/// capital sums to more than the series principal, which is not overselling,
/// because the series total is still the cap and is still enforced twice, once
/// here at the quote and once by `CoverPool.bind` itself.
///
/// Two consequences are the point of doing it this way.
///
/// The first is that nothing changes until capital says so. With no band
/// subscriptions and no banded policies, U is P and X(u) is E, so every band's
/// utilisation is the series utilisation to the last digit and all three price
/// exactly as this product priced before bands existed. The example cover
/// published in the submission material is unaffected, and so is every other
/// live policy.
///
/// The second is that a band can genuinely be unavailable. Once capital has
/// allocated the whole principal to two bands, the third has A(b) of zero and U
/// of zero, so it has no capital, no utilisation and no price. That is not an
/// error state and it is not a zero. It is capital declining a risk in public,
/// which is the one thing an insurance market does that almost nothing on a
/// screen ever shows.

/**
 * The statuses that count as exposure.
 *
 * `ACTIVE_POLICY_STATUSES` less `paid`: a paid claim has already taken its
 * money out of the reserve, so counting it again would charge the next buyer
 * for capacity that is gone rather than committed. Everything else that could
 * still pay is in, including `declined`, which leaves cover running.
 */
export const EXPOSED_POLICY_STATUSES: readonly PolicyStatus[] = [
  'binding',
  'bound',
  'active',
  'claims_open',
  'claimed',
  'under_review',
  'approved',
  'declined',
];

export type CapacityReason = 'none' | 'no_capital' | 'no_free_capacity';

export interface BandCapacity {
  band: SeniorityBand;
  /** Capital committed to this band, in minor units. */
  capital: bigint;
  /** Exposure this band is carrying, in minor units. */
  exposure: bigint;
  /** What is left, floored at zero. */
  free: bigint;
  /** Null when no capital stands behind the band. Never zero for that reason. */
  utilisation: number | null;
  /** Whether anything at all has been committed to this band. */
  funded: boolean;
}

export interface SeriesCapacity {
  seriesId: string;
  principalRemaining: bigint;
  activeExposure: bigint;
  /** Principal that no subscription has named a band for. */
  unallocated: bigint;
  /** Exposure that no policy named a band for, which is every policy older than bands. */
  unbandedExposure: bigint;
  bands: BandCapacity[];
  /**
   * The capacity behind a quote that names no band, which is the unallocated
   * principal and the unbanded exposure on their own. A caller that names no
   * band is buying out of the pot that named no band.
   */
  unbanded: Omit<BandCapacity, 'band' | 'funded'> & { funded: boolean };
}

export interface CapacityInput {
  seriesId: string;
  principalRemaining: bigint;
  activeExposure: bigint;
  /** Committed per band, from `band_subscriptions`. */
  allocated: Readonly<Partial<Record<SeniorityBand, bigint>>>;
  /** Written per band, from `policies`. */
  written: Readonly<Partial<Record<SeniorityBand, bigint>>>;
}

function clampToZero(value: bigint): bigint {
  return value < 0n ? 0n : value;
}

function capacityOf(capital: bigint, exposure: bigint): Omit<BandCapacity, 'band'> {
  return {
    capital,
    exposure,
    free: clampToZero(capital - exposure),
    utilisation: bandUtilisation(Number(exposure), Number(capital)),
    funded: capital > 0n,
  };
}

/** The arithmetic above, as a pure function, so it can be read and tested. */
export function seriesCapacity(input: CapacityInput): SeriesCapacity {
  const allocatedTotal = SENIORITY_BANDS.reduce(
    (total, band) => total + (input.allocated[band] ?? 0n),
    0n,
  );
  const writtenTotal = SENIORITY_BANDS.reduce(
    (total, band) => total + (input.written[band] ?? 0n),
    0n,
  );
  // Both clamp at zero rather than going negative. Principal falls as a series
  // is redeemed and exposure is released as policies end, so a record written
  // when both were larger can outlive the chain state it was checked against.
  const unallocated = clampToZero(input.principalRemaining - allocatedTotal);
  const unbandedExposure = clampToZero(input.activeExposure - writtenTotal);

  return {
    seriesId: input.seriesId,
    principalRemaining: input.principalRemaining,
    activeExposure: input.activeExposure,
    unallocated,
    unbandedExposure,
    bands: SENIORITY_BANDS.map((band) => ({
      band,
      ...capacityOf((input.allocated[band] ?? 0n) + unallocated, (input.written[band] ?? 0n) + unbandedExposure),
    })),
    unbanded: capacityOf(unallocated, unbandedExposure),
  };
}

/** One band out of a computed series capacity, or the unbanded pot for null. */
export function capacityFor(
  capacity: SeriesCapacity,
  band: SeniorityBand | null,
): Omit<BandCapacity, 'band'> {
  if (band === null) return capacity.unbanded;
  const found = capacity.bands.find((row) => row.band === band);
  // Unreachable: SENIORITY_BANDS is the whole domain of the type and every one
  // of them is built above. The fallback exists so the caller has no null to
  // handle for a band the type says exists.
  return found ?? capacityOf(0n, 0n);
}

/** Whether a limit can be written against a band, and why not when it cannot. */
export function capacityReason(
  capacity: Omit<BandCapacity, 'band'>,
  limit: bigint,
): CapacityReason {
  if (!capacity.funded) return 'no_capital';
  return capacity.free < limit ? 'no_free_capacity' : 'none';
}

/**
 * The series capacity, read from the rows and the chain.
 *
 * `seriesId` is the series label, which is what `policies.series_id`,
 * `quotes.series_id` and `band_subscriptions.series_id` all carry; the chain
 * state comes in already read, because the quote and bind paths have read it
 * for their own reasons and a second round trip for the same tuple would be a
 * second answer as well as a second call.
 */
export async function readSeriesCapacity(
  repository: Repository,
  seriesId: string,
  state: Pick<SeriesChainState, 'activeExposure' | 'principalRemaining'>,
): Promise<SeriesCapacity> {
  const [subscriptions, written] = await Promise.all([
    repository.bandSubscriptions(seriesId),
    repository.bandExposure(seriesId, EXPOSED_POLICY_STATUSES),
  ]);

  const allocated: Partial<Record<SeniorityBand, bigint>> = {};
  for (const row of subscriptions) {
    allocated[row.band] = (allocated[row.band] ?? 0n) + BigInt(row.amount);
  }
  const writtenByBand: Partial<Record<SeniorityBand, bigint>> = {};
  for (const row of written) {
    writtenByBand[row.band] = (writtenByBand[row.band] ?? 0n) + BigInt(row.amount);
  }

  return seriesCapacity({
    seriesId,
    principalRemaining: state.principalRemaining,
    activeExposure: state.activeExposure,
    allocated,
    written: writtenByBand,
  });
}
