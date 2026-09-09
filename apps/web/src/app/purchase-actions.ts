'use server';

import { redirect } from 'next/navigation';

import { ApiError } from '../lib/api';
import { issueEligibilityFor, type EligibilityRequest } from '../lib/eligibility';
import { AMOUNT_DEFAULT } from '../lib/cover-amount';
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
  noCoverForGroup,
  paysOutSentence,
  premiumAmount,
  priceFailure,
  type PayResult,
  type PriceResult,
  type VerifyResult,
} from '../lib/worker-model';
import {
  bindPolicy,
  requestQuote,
  requestWorldContext,
  toMinorUnits,
  waitForSerial,
  type WorldRequestContextView,
} from '../lib/worker-api';

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
 * Landing page: the inline quote's occupation step.
 *
 * It is chooseOccupation and the Amount route's opening quote in one call,
 * because inline there is no navigation between the two steps to hang a second
 * read on, and a front door that paid for two quotes to show one price would be
 * paying twice for the same figure.
 *
 * It writes the same server side session those two routes write, behind the same
 * httpOnly cookie, so a quote begun on the landing page can be finished on
 * /occupation and /amount and a link already shared still resumes it.
 * updatePurchase starts a session when there is none, so a visitor who arrives
 * cold needs no separate begin.
 */
export async function quoteOccupation(group: string): Promise<PriceResult> {
  const occupation = findOccupation(group);
  if (occupation === null || !hasCover(occupation)) {
    // The picker does not offer an occupation with no series behind it, so this
    // is a hand-made request rather than a person. It is answered with the
    // sentence a quote for that group would have been answered with, and
    // nothing is written to the session.
    return noCoverForGroup(AMOUNT_DEFAULT);
  }
  await updatePurchase({ group, limit: AMOUNT_DEFAULT, quoteId: null });
  return await priceCover(AMOUNT_DEFAULT);
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
 * Verify screen: a fresh signed context for one IDKit request.
 *
 * Called on every opening of the widget, never cached. The signature lives five
 * minutes and World refuses a nonce it has already seen, so a retry after
 * someone cancelled or after the context expired gets its own.
 */
export async function startWorldCheck(): Promise<WorldRequestContextView | null> {
  const session = await readPurchase();
  if (!session?.group) redirect('/occupation');
  try {
    return await requestWorldContext(DEMO_ACCOUNT.accountId);
  } catch {
    return null;
  }
}

/**
 * Verify screen: the completed check, forwarded to the API.
 *
 * The IDKit result crosses from the browser to here and no further: the API
 * forwards it to World, checks the signal against the wallet, takes the
 * nullifier out of the proof and answers with the credential. The credential is
 * single use, lasts thirty minutes and stays in the server side session.
 */
export async function completeWorldCheck(result: unknown): Promise<VerifyResult> {
  const session = await readPurchase();
  const group = session?.group;
  if (!group || session === null) redirect('/occupation');
  return await earnCredential({ group, wallet: DEMO_ACCOUNT, proof: result });
}

/**
 * Verify screen: the interim check, for a clone with no World app.
 *
 * The nullifier is the session's own, because there is no proof to take one
 * from. On the World path it comes out of the proof, inside the API.
 */
export async function verifyPerson(): Promise<VerifyResult> {
  const session = await readPurchase();
  const group = session?.group;
  if (!group || session === null) redirect('/occupation');
  return await earnCredential({ group, wallet: DEMO_ACCOUNT, nullifier: session.nullifier });
}

async function earnCredential(request: EligibilityRequest): Promise<VerifyResult> {
  try {
    const issued = await issueEligibilityFor(request);
    await updatePurchase({
      credential: issued.credential,
      credentialExpiresAt: issued.expiresAt,
    });
    return { ok: true, error: null, alreadyCovered: false };
  } catch (cause) {
    if (cause instanceof ApiError && cause.code === 'already_covered') {
      return {
        ok: false,
        error: 'One person, one cover. This stops bots and duplicate accounts.',
        alreadyCovered: true,
      };
    }
    if (cause instanceof ApiError && cause.code === 'no_capacity_for_group') {
      return {
        ok: false,
        error: 'There is no cover behind this occupation yet.',
        alreadyCovered: false,
      };
    }
    return { ok: false, error: "We couldn't verify you.", alreadyCovered: false };
  }
}

/** Verify screen: "Continue". */
export async function continueToPay(): Promise<void> {
  redirect('/pay');
}

/** Verify screen, when this person already holds cover: the cover they have. */
export async function goToCover(): Promise<void> {
  redirect('/home');
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
