import { describe, expect, it } from 'vitest';

import { capacityFor, capacityReason, seriesCapacity } from '../src/capacity.js';
import { priceCover } from '../src/pricing.js';

/// The band arithmetic, which is the whole of what an experience band does.
///
/// Two properties matter more than the rest and both are pinned here. Nothing
/// changes until capital says so, so a deployment with no band subscriptions
/// prices every band exactly as it priced before bands existed. And a band with
/// no capital behind it has no utilisation and no price at all, rather than a
/// floor price or a zero.

const PRINCIPAL = 100_000_000_000n;
const EXPOSURE = 40_000_000_000n;

function capacity(
  allocated: Parameters<typeof seriesCapacity>[0]['allocated'] = {},
  written: Parameters<typeof seriesCapacity>[0]['written'] = {},
) {
  return seriesCapacity({
    seriesId: 'ODI-COMP-2026-01',
    principalRemaining: PRINCIPAL,
    activeExposure: EXPOSURE,
    allocated,
    written,
  });
}

describe('the capacity behind a band', () => {
  it('prices every band as the series priced before bands, while nothing is allocated', () => {
    const state = capacity();
    for (const band of state.bands) {
      expect(band.capital).toBe(PRINCIPAL);
      expect(band.exposure).toBe(EXPOSURE);
      expect(band.utilisation).toBeCloseTo(0.4, 12);
    }
    // And so does a quote that names no band, which is what the published
    // example cover and every other live policy was written against.
    expect(state.unbanded.capital).toBe(PRINCIPAL);
    expect(state.unbanded.exposure).toBe(EXPOSURE);
  });

  it('stands unallocated capital behind all three bands rather than splitting it', () => {
    const state = capacity({ '25_plus': 30_000_000_000n });
    const senior = capacityFor(state, '25_plus');
    const junior = capacityFor(state, '0_5');
    expect(state.unallocated).toBe(70_000_000_000n);
    expect(senior.capital).toBe(100_000_000_000n);
    expect(junior.capital).toBe(70_000_000_000n);
    // Capital that named a band is dearer for nobody and cheaper for the band
    // that got it: more capital behind the same exposure is a lower utilisation.
    expect(senior.utilisation ?? 1).toBeLessThan(junior.utilisation ?? 0);
  });

  it('leaves a band capital never chose with no price at all', () => {
    // The whole principal committed to two bands, which leaves the third with
    // nothing behind it. Not an error, and not a cheap band: not for sale.
    const state = capacity({
      '5_25': 30_000_000_000n,
      '25_plus': 70_000_000_000n,
    });
    const junior = capacityFor(state, '0_5');
    expect(junior.capital).toBe(0n);
    expect(junior.utilisation).toBeNull();
    expect(junior.funded).toBe(false);
    expect(capacityReason(junior, 5_000_000_000n)).toBe('no_capital');
    expect(
      priceCover({
        ebar: -0.6,
        levelLine: -0.68,
        limit: 5_000_000_000n,
        exposure: junior.exposure,
        capital: junior.capital,
      }),
    ).toBeNull();
    // The bands beside it are unaffected and still sell.
    expect(capacityReason(capacityFor(state, '25_plus'), 5_000_000_000n)).toBe('none');
  });

  it('counts exposure no policy named a band for against every band', () => {
    // Every policy bound before bands existed is in this figure, because the
    // chain reports one exposure for the series and the rows carry a band for
    // none of them. It draws on the capital that named no band, which stands
    // behind all three, so it is carried by all three.
    const state = capacity({}, { '0_5': 10_000_000_000n });
    expect(state.unbandedExposure).toBe(30_000_000_000n);
    expect(capacityFor(state, '0_5').exposure).toBe(40_000_000_000n);
    expect(capacityFor(state, '5_25').exposure).toBe(30_000_000_000n);
    expect(state.unbanded.exposure).toBe(30_000_000_000n);
  });

  it('separates a band that is full from a band that was never funded', () => {
    const state = capacity({ '0_5': 100_000_000_000n }, {});
    const junior = capacityFor(state, '0_5');
    expect(junior.funded).toBe(true);
    expect(junior.free).toBe(60_000_000_000n);
    expect(capacityReason(junior, 80_000_000_000n)).toBe('no_free_capacity');
    expect(capacityReason(junior, 10_000_000_000n)).toBe('none');
  });

  it('never reports a negative figure when the chain has moved under a record', () => {
    // Principal falls as a series is redeemed and exposure is released as cover
    // ends, so an allocation can outlive the capital it was checked against.
    const state = seriesCapacity({
      seriesId: 'ODI-COMP-2026-01',
      principalRemaining: 10_000n,
      activeExposure: 0n,
      allocated: { '0_5': 50_000n },
      written: { '0_5': 90_000n },
    });
    expect(state.unallocated).toBe(0n);
    expect(state.unbandedExposure).toBe(0n);
    expect(capacityFor(state, '0_5').free).toBe(0n);
  });
});
