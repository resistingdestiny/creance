'use server';

import { redirect } from 'next/navigation';

import { ApiError } from '../lib/api';
import { issueEligibilityFor } from '../lib/eligibility';
import { AMOUNT_DEFAULT } from '../components/amount-slider';
import { findOccupation, hasCover } from '../lib/occupations';
import {
  readPurchase,
  startPurchase,
  updatePurchase,
  type PurchaseSession,
} from '../lib/purchase-session';
import { DEMO_ACCOUNT } from '../lib/wallet';
import {
  bindMessage,
  coverAmount,
  paysOutSentence,
  premiumAmount,
  priceFailure,
  type PayResult,
  type PriceResult,
  type VerifyResult,
} from '../lib/worker-model';
import { bindPolicy, requestQuote, toMinorUnits, waitForSerial } from '../lib/worker-api';

/**
 * The purchase flow's writes.
 *
 * Every call to the API is made here, on the server, so the eligibility
 * credential never reaches a browser and so the pay step can be settled by a
 * server side payer when T08 lands the x402 gate. Nothing in this file talks to
 * the chain directly.
 */

/** Start screen: "Get a quote". */
export async function beginPurchase(): Promise<void> {
  await startPurchase();
  redirect('/occupation');
}

/** Occupation picker: "Continue". */
export async function chooseOccupation(formData: FormData): Promise<void> {
  const group = String(formData.get('group') ?? '');
  const occupation = findOccupation(group);
  if (occupation === null || !hasCover(occupation)) {
    // The picker does not offer an occupation with no series behind it, so this
    // is a hand-made request rather than a person, and it goes back to the list.
    redirect('/occupation');
  }
  await updatePurchase({ group, limit: AMOUNT_DEFAULT, quoteId: null });
  redirect('/amount');
}

/**
 * Amount screen: the price for a limit, taken 250ms after the slider settles.
 *
 * A quote takes no capacity hold and expires in fifteen minutes, so pricing the
 * slider is the same call the Pay sheet makes and the figure on screen is a
 * binding price rather than an estimate.
 */
export async function priceCover(limit: number): Promise<PriceResult> {
  const session = await readPurchase();
  const group = session?.group;
  if (!group) redirect('/occupation');

  try {
    const quote = await requestQuote({
      group,
      limit: toMinorUnits(limit),
      wallet: DEMO_ACCOUNT.accountId,
    });
    await updatePurchase({
      limit,
      quoteId: quote.quote_id,
      premiumMinorUnits: quote.premium.amount,
    });
    return {
      limit: coverAmount(quote.limit),
      premium: premiumAmount(quote.premium),
      sentence: paysOutSentence(quote),
      usedPercent: quote.capacity.used_pct,
      full: false,
      error: null,
    };
  } catch (cause) {
    return priceFailure(limit, cause);
  }
}

/** Amount screen: "Continue". */
export async function continueToVerify(): Promise<void> {
  redirect('/verify');
}

/**
 * Verify screen: the check that earns an eligibility credential.
 *
 * The credential is single use, lasts thirty minutes and is held in the server
 * side session. Nothing about it is returned to the browser.
 */
export async function verifyPerson(): Promise<VerifyResult> {
  const session = await readPurchase();
  const group = session?.group;
  if (!group || session === null) redirect('/occupation');

  try {
    const issued = await issueEligibilityFor({
      group,
      wallet: DEMO_ACCOUNT,
      nullifier: session.nullifier,
    });
    await updatePurchase({
      credential: issued.credential,
      credentialExpiresAt: issued.expiresAt,
    });
    return { ok: true, error: null };
  } catch (cause) {
    if (cause instanceof ApiError && cause.code === 'no_capacity_for_group') {
      return { ok: false, error: 'There is no cover behind this occupation yet.' };
    }
    return { ok: false, error: "We couldn't verify you." };
  }
}

/** Verify screen: "Continue". */
export async function continueToPay(): Promise<void> {
  redirect('/pay');
}

/**
 * Pay sheet: the bind.
 *
 * A quote lasts fifteen minutes and the sheet can sit open longer than that, so
 * an expired quote is re-priced once. The new price is bound only when it is
 * the same price the button named; a price that moved sends the person back to
 * the sheet to read the new one, because a button that says "Pay 4.25" must not
 * pay anything else.
 */
export async function payAndBind(): Promise<PayResult> {
  const session = await readPurchase();
  if (session === null || session.group === null || session.limit === null) {
    redirect('/occupation');
  }
  if (session.credential === null) redirect('/verify');
  if (session.quoteId === null) redirect('/pay');

  try {
    const policy = await bindPolicy(session.quoteId, session.credential);
    const settled = await waitForSerial(policy);
    await updatePurchase({ policyId: settled.policy_id, credential: null, quoteId: null });
    return { ok: true, error: null };
  } catch (cause) {
    if (cause instanceof ApiError && cause.code === 'quote_expired') {
      return repriceAndBind(session);
    }
    return { ok: false, error: bindMessage(cause) };
  }
}

async function repriceAndBind(session: PurchaseSession): Promise<PayResult> {
  if (session.group === null || session.limit === null || session.credential === null) {
    return { ok: false, error: 'That price expired. Ask for a fresh one.' };
  }
  try {
    const fresh = await requestQuote({
      group: session.group,
      limit: toMinorUnits(session.limit),
      wallet: DEMO_ACCOUNT.accountId,
    });
    await updatePurchase({
      quoteId: fresh.quote_id,
      premiumMinorUnits: fresh.premium.amount,
    });
    if (fresh.premium.amount !== session.premiumMinorUnits) {
      return {
        ok: false,
        error: `The price changed while this was open. It is now ${premiumAmount(fresh.premium)} a month.`,
      };
    }
    const policy = await bindPolicy(fresh.quote_id, session.credential);
    const settled = await waitForSerial(policy);
    await updatePurchase({ policyId: settled.policy_id, credential: null, quoteId: null });
    return { ok: true, error: null };
  } catch (cause) {
    return { ok: false, error: bindMessage(cause) };
  }
}

/** Home: start again after the cover has been bought. */
export async function startAgain(): Promise<void> {
  await startPurchase();
  redirect('/occupation');
}
