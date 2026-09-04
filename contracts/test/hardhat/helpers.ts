import { expect } from 'chai';
import { network } from 'hardhat';

import type { CollateralVault, CoverPool, MockSettlementToken } from '../../types/ethers-contracts/index.js';

/// The settlement token has six decimals and every amount on chain is an
/// integer in minor units, so 100,000 TUSD is 100000000000.
export const UNIT = 1_000_000n;

export function tusd(whole: number): bigint {
  return BigInt(whole) * UNIT;
}

export const DAY = 24 * 60 * 60;
export const WAITING_PERIOD = 60 * DAY;
export const TERM = 365 * DAY;
export const GRACE_PERIOD = 15 * DAY;
export const CLAIM_WINDOW_FROM_OBSERVATION = 30 * DAY;
export const CLAIM_WINDOW_FROM_SEPARATION = 60 * DAY;

/// ODI and the smoothed excess are percentage points scaled by 1e4, so 1.0
/// point is 10000 and the demo series level line of -0.68 is -6800.
export const ODI_SCALE = 10_000n;

export const REASON_NONE = 0n;
export const REASON_SHOCK = 1n;
export const REASON_LEVEL = 2n;

export const PAYOUT_FULL = 0;
export const PAYOUT_INDEXED = 1;

export const STATUS_NONE = 0n;
export const STATUS_ACTIVE = 1n;
export const STATUS_CLAIMS_OPEN = 2n;
export const STATUS_SETTLING = 3n;
export const STATUS_MATURED = 4n;

export const POLICY_NONE = 0n;
export const POLICY_ACTIVE = 1n;
export const POLICY_LAPSED = 2n;
export const POLICY_PAID = 3n;
export const POLICY_EXPIRED = 4n;

export async function connect() {
  return network.getOrCreate();
}

/// I8, solvency: the vault can always meet what it says it owes. Asserted
/// after every test in both suites, which turns each one into an invariant
/// test for two lines of harness.
export async function assertSolvent(
  token: MockSettlementToken,
  vault: CollateralVault,
): Promise<void> {
  const balance = await token.balanceOf(await vault.getAddress());
  expect(balance, 'vault solvency (I8)').to.be.greaterThanOrEqual(await vault.accountedTotal());
}

/// I1, exposure accounting: for every series, activeExposure equals the sum of
/// the limits of the policies in it that are still Active. The policy list is
/// read back from the PolicyBound log so a test that binds a fourth policy is
/// covered without saying so.
export async function assertExposure(pool: CoverPool): Promise<void> {
  const bound = await pool.queryFilter(pool.filters.PolicyBound());
  const bySeries = new Map<string, string[]>();
  for (const event of bound) {
    const seriesId = event.args.seriesId;
    const ids = bySeries.get(seriesId) ?? [];
    ids.push(event.args.policyId);
    bySeries.set(seriesId, ids);
  }
  for (const [seriesId, policyIds] of bySeries) {
    let expected = 0n;
    for (const policyId of policyIds) {
      const policy = await pool.policyOf(policyId);
      if (policy.status === POLICY_ACTIVE) expected += policy.limit;
    }
    expect(await pool.activeExposureOf(seriesId), `exposure accounting (I1) ${seriesId}`)
      .to.equal(expected);
  }
}
