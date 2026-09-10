import { demoSeries, type CouponContext } from './context.js';
import { subscribeInvestor } from './vault.js';

/// What each noteholder subscribes for the demonstration: half the principal
/// each, which is what they hold on the note.
const SUBSCRIPTION_PER_INVESTOR = 50_000n * 1_000_000n;

/**
 * Subscribe both noteholders in the vault, so the principal the note reports
 * and the principal the vault holds are the same number.
 *
 * Nobody had subscribed to the demo series before this: the note had 100 units
 * minted against a vault holding nothing, so every principal figure on the
 * investor screen would have read zero. See docs/DECISIONS.md.
 *
 * The subscription is written onto the series and not onto the record as a
 * whole. A series carries its own noteholders, `pnpm series:capacity` writes
 * the seed subscription the same way, and the API reads the roles off the
 * series when it decides whether the note or the vault is the source of truth.
 *
 * Written after each investor rather than at the end, because the money has
 * already moved by then: a failure between two investors must not lose the
 * memory of the first.
 */
export async function subscribe(context: CouponContext): Promise<void> {
  const series = demoSeries(context.record);

  for (const investor of context.investors) {
    const subscription = await subscribeInvestor(
      context,
      series.id,
      investor,
      SUBSCRIPTION_PER_INVESTOR,
    );
    if (subscription === null) continue;
    series.subscriptions = [
      ...(series.subscriptions ?? []).filter((entry) => entry.role !== investor.role),
      subscription,
    ];
    context.save();
  }
  const state = (await context.vault.getFunction('seriesOf')(series.id)) as {
    principalFunded: bigint;
  };
  console.log(`  principalFunded ${state.principalFunded}`);
}
