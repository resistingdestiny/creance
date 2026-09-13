'use server';

import { revalidatePath } from 'next/cache';

import { MarketApiError, subscribeToSeries } from '../../../lib/investor-api';
import { subscribeRefusal } from '../../../lib/investor-model';
import { demoInvestorAccount } from '../../../lib/wallet';

/**
 * The subscribe screen's one write.
 *
 * It is made here, on the server, and it names the demo investor account this
 * deployment speaks for rather than an account out of the form. The same rule
 * the market writes follow (src/app/invest/market-actions.ts): a form on a
 * public page is a public endpoint, and a body that could name its own holder
 * would let anybody have the API pay principal in for an address of their
 * choosing. The only things the form carries are which series and how much.
 *
 * What happens on chain is the API's: it approves the vault from the api
 * account, which is the account holding the subscription role, and calls
 * `subscribe` on the vault, which records the investor as the subscriber.
 * DESIGN.md 3.8. Nothing in this app holds a key for either leg, and that has
 * not changed; what changed is that the press now settles a subscription
 * instead of only changing what the screen shows.
 *
 * The amount adds to whatever the account already carries. So this returns what
 * the vault said afterwards rather than the figure on the slider, and the
 * screen shows that: the two are only the same on a first subscription.
 */

/**
 * The slider's range, in whole units of the settlement asset.
 *
 * Restated here rather than imported from the screen, and not exported from
 * here either: a `'use server'` module may export async functions and nothing
 * else, so these two cannot be the shared copy. The screen offers the range and
 * this checks it, which is the split anyway, because a form on a public page
 * can carry any number a caller likes.
 */
const MIN_AMOUNT = 5_000;
const MAX_AMOUNT = 50_000;

/** Money on this deployment is six decimals, as the note's units are. */
const SCALE = 1_000_000n;

export interface SubscribeResult {
  readonly ok: boolean;
  /** One sentence for the screen, or null when it worked. */
  readonly error: string | null;
  /** Whether the same press could succeed. False on a refusal that is settled. */
  readonly retry: boolean;
  /**
   * What the vault holds for this account now, in minor units, as the API read
   * it back after the write. Null on a refusal.
   */
  readonly subscribed: string | null;
  /** The subscription on HashScan, or null on a refusal. */
  readonly transaction: string | null;
}

function refused(message: string, retry: boolean): SubscribeResult {
  return { ok: false, error: message, retry, subscribed: null, transaction: null };
}

/**
 * A series id out of a form.
 *
 * It goes into a call, so it is held to the shape the API issues rather than
 * passed through: a label, a group key or a bytes32 id, and nothing with a
 * slash or a space in it.
 */
function asSeriesId(value: FormDataEntryValue | null): string | null {
  if (typeof value !== 'string') return null;
  return /^[A-Za-z0-9_-]{1,80}$/.test(value.trim()) ? value.trim() : null;
}

/** A whole number of units from the slider, in the range the slider offers. */
function asAmount(value: FormDataEntryValue | null): bigint | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^[0-9]{1,9}$/.test(trimmed)) return null;
  const whole = Number(trimmed);
  if (whole < MIN_AMOUNT || whole > MAX_AMOUNT) return null;
  return BigInt(whole) * SCALE;
}

export async function subscribe(form: FormData): Promise<SubscribeResult> {
  const series = asSeriesId(form.get('series'));
  const amount = asAmount(form.get('amount'));
  if (series === null || amount === null) {
    return refused('That is not an amount this series can take.', false);
  }

  let view;
  try {
    view = await subscribeToSeries({
      series,
      holder: demoInvestorAccount().evmAddress,
      amount: amount.toString(),
    });
  } catch (cause) {
    // Logged here because the screen deliberately never prints a code, and a
    // refusal a person cannot act on is one somebody on this side has to be
    // able to find.
    console.error(`[web] the subscription was refused. ${String(cause)}`);
    const refusal =
      cause instanceof MarketApiError
        ? subscribeRefusal(cause.code, cause.status)
        : subscribeRefusal(null, null);
    return refused(refusal.message, refusal.retry);
  }

  // The screen behind this reads the chain for the principal, the holders and
  // the coupons, and it has just gone out of date. Nothing else on the site
  // shows this account's subscription, so one path is enough.
  revalidatePath('/invest/subscribe');
  return {
    ok: true,
    error: null,
    retry: false,
    subscribed: view.subscription_after.amount,
    transaction: view.hashscan,
  };
}
