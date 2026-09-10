'use server';

import { redirect } from 'next/navigation';

import { ApiError, reportUnreachable } from '../lib/api';

import { forgetCover, openCoverSession } from '../lib/current-cover';
import { issueEligibilityFor, type EligibilityRequest } from '../lib/eligibility';
import { AMOUNT_DEFAULT } from '../lib/cover-amount';
import { findOccupation, hasCover, occupationLabel } from '../lib/occupations';
import {
  readPurchase,
  startPurchase,
  updatePurchase,
  type PurchaseSession,
} from '../lib/purchase-session';
import { readConnectedAccount, UnknownAccountError } from '../lib/wallet-account';
import {
  DEMO_ACCOUNT,
  DEMO_WALLET_LABEL,
  NO_RECEIPT_WARNING,
  OWN_WALLET_LABEL,
  SERVICE_PAYS_LABEL,
  type WalletAccount,
} from '../lib/wallet';
import { payerAccountId } from '../lib/payer';
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
  wrongKind,
} from '../lib/worker-model';
import {
  bindPolicy,
  openCoverWithKey,
  requestQuote,
  requestWorldContext,
  signInWithWorldCheck,
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

/**
 * The wallet this purchase names, which is the demo wallet until somebody
 * connects their own at the payment step.
 *
 * Every call in this file that names a wallet reads it here, so there is one
 * answer to "whose cover is this" and a session with nothing connected still
 * sees exactly the account it always saw.
 */
function purchaseWallet(session: PurchaseSession | null): WalletAccount {
  return session?.wallet ?? DEMO_ACCOUNT;
}

/**
 * Start screen: "Get a quote". Nothing calls this since T35.
 *
 * It was the landing page's button, which started a session and left for the
 * picker. The quote happens on the landing page now and starts its session by
 * writing to it, so there is no caller left in the app.
 *
 * It is kept rather than deleted because /occupation is still a live route that
 * a shared link opens, and this is the one action that starts a purchase
 * without also writing to it: the entry to the route path, named. `startAgain`
 * below is the same pair of calls from /home.
 */
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
      wallet: purchaseWallet(session).accountId,
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
    return await requestWorldContext(purchaseWallet(session).accountId);
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
  return await earnCredential({ group, wallet: purchaseWallet(session), proof: result });
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
  return await earnCredential({
    group,
    wallet: purchaseWallet(session),
    nullifier: session.nullifier,
  });
}

async function earnCredential(request: EligibilityRequest): Promise<VerifyResult> {
  try {
    const issued = await issueEligibilityFor(request);
    await updatePurchase({
      credential: issued.credential,
      credentialExpiresAt: issued.expiresAt,
    });
    return { ok: true, error: null, alreadyCovered: false, wrongCheck: false };
  } catch (cause) {
    if (cause instanceof ApiError && cause.code === 'already_covered') {
      return {
        ok: false,
        error: 'One person, one cover. This stops bots and duplicate accounts.',
        alreadyCovered: true,
        wrongCheck: false,
      };
    }
    // The one refusal the generic failure answers wrongly: it offers a retry on
    // a device that will answer with the same kind of check again. The words a
    // person reads come from `verifyCopy`; this string is what the widget is
    // told, which is why the code and not the sentence is what travels. T42.
    if (cause instanceof ApiError && cause.code === 'world_credential_unaccepted') {
      return {
        ok: false,
        error: "That check isn't the one we asked for.",
        alreadyCovered: false,
        wrongCheck: true,
      };
    }
    if (cause instanceof ApiError && cause.code === 'no_capacity_for_group') {
      return {
        ok: false,
        error: 'There is no cover behind this occupation yet.',
        alreadyCovered: false,
        wrongCheck: false,
      };
    }
    return {
      ok: false,
      error: "We couldn't verify you.",
      alreadyCovered: false,
      wrongCheck: false,
    };
  }
}

/** Verify screen: "Continue". */
export async function continueToPay(): Promise<void> {
  redirect('/pay');
}

/**
 * Pay step: bind this purchase to a wallet somebody just connected.
 *
 * The browser sends an account id and nothing else. The EVM address that goes
 * with it is read from the mirror node here, because it is the address a payout
 * is sent to and an address a browser supplies is an address a browser could
 * have made up. A throw is what the chooser shows: the connection did not take,
 * and the wallet the person had is the wallet they still have.
 *
 * Changing the wallet drops the eligibility credential. DESIGN.md 3.6 binds a
 * check to the wallet id and /v1/bind refuses a quote and a credential that
 * name different accounts, so a credential earned against the old wallet is not
 * a credential for this cover. The quote goes with it, because the pay step
 * takes a fresh one on entry anyway. The screens turn back to the check.
 */
export async function connectWallet(accountId: string): Promise<WalletAccount> {
  const session = await readPurchase();
  if (session === null || session.group === null) redirect('/occupation');

  let account;
  try {
    account = await readConnectedAccount(accountId);
  } catch (cause) {
    if (cause instanceof UnknownAccountError) throw cause;
    reportUnreachable('the connected wallet', cause);
    throw new Error("We couldn't check that account. Try again in a moment.", { cause });
  }

  const unchanged = session.wallet?.accountId === account.accountId;
  await updatePurchase({
    wallet: { accountId: account.accountId, evmAddress: account.evmAddress },
    walletHoldsReceipt: account.canHoldReceipt,
    ...(unchanged ? {} : { credential: null, credentialExpiresAt: null, quoteId: null }),
  });
  return { accountId: account.accountId, evmAddress: account.evmAddress };
}

/**
 * Pay step: go back to the demo wallet.
 *
 * The same rule in the other direction. The credential named the wallet that is
 * being put down, so it goes, and the flow turns back to the check.
 */
export async function useDemoWallet(): Promise<void> {
  const session = await readPurchase();
  if (session === null || session.wallet === null) return;
  await updatePurchase({
    wallet: null,
    walletHoldsReceipt: true,
    credential: null,
    credentialExpiresAt: null,
    quoteId: null,
  });
}

/** Verify screen, when this person already holds cover: the cover they have. */
export async function goToCover(): Promise<void> {
  redirect('/home');
}

/**
 * Pay sheet: the rows on it, and the price the button will name.
 *
 * The quote is taken fresh, because the figure on the button is the figure that
 * will be bound and a quote lasts fifteen minutes. That is what /pay has always
 * done on entry; this is the same read, named, so the route and the landing
 * page take it once each and in the same way.
 *
 * Null is "there is nothing to confirm": no session, no credential, or the API
 * did not answer. The route turns the first two into the redirects it always
 * made and the third into the screen it always showed, and the landing page
 * says so on the card. Neither invents a premium.
 *
 * On the demo path there are five rows and they are the five the deck names. A
 * connected wallet adds one, because the cover and the premium stop naming the
 * same account: the cover is held in the person's wallet and src/lib/payer.ts
 * still settles the premium out of the service account. Two rows saying what is
 * true is the only honest way to draw that, and the alternative, one row
 * captioned as somebody's own wallet, would be the overclaim this ticket
 * forbids.
 */
export interface PayConfirmation {
  readonly cover: string;
  readonly occupation: string;
  readonly premium: string;
  /** The account the premium leaves. Always the service account today. */
  readonly paysFrom: string;
  readonly walletLabel: string | null;
  /** The account the cover is held in, or null when it is the paying one. */
  readonly heldIn: string | null;
  readonly heldInLabel: string | null;
  /**
   * One sentence when the connected wallet will not accept the policy NFT, or
   * null. The cover binds either way, so this warns rather than blocks.
   */
  readonly receiptWarning: string | null;
}

export async function openPayment(): Promise<PayConfirmation | null> {
  const session = await readPurchase();
  if (!session?.group || session.credential === null) return null;

  const group = session.group;
  const wallet = purchaseWallet(session);
  const connected = session.wallet !== null;
  try {
    const quote = await requestQuote({
      group,
      limit: toMinorUnits(session.limit ?? AMOUNT_DEFAULT),
      wallet: wallet.accountId,
    });
    await updatePurchase({ quoteId: quote.quote_id, premiumMinorUnits: quote.premium.amount });
    return {
      cover: coverAmount(quote.limit),
      occupation: occupationLabel(group),
      premium: premiumAmount(quote.premium),
      // Not `quote.pays_from`. The quote echoes the wallet it was asked for,
      // which is the wallet the cover binds to, and that is no longer the
      // account the money comes out of. On the demo path the two are the same
      // string and the row is unchanged.
      paysFrom: payerAccountId(),
      walletLabel: connected ? SERVICE_PAYS_LABEL : DEMO_WALLET_LABEL,
      heldIn: connected ? wallet.accountId : null,
      heldInLabel: connected ? OWN_WALLET_LABEL : null,
      receiptWarning: connected && !session.walletHoldsReceipt ? NO_RECEIPT_WARNING : null,
    };
  } catch (cause) {
    reportUnreachable('the pay sheet', cause);
    return null;
  }
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
    await openCoverSession(settled.policy_id, policy.cover_key);
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
      wallet: purchaseWallet(session).accountId,
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
    await openCoverSession(settled.policy_id, policy.cover_key);
    return { ok: true, error: null };
  } catch (cause) {
    return { ok: false, error: bindMessage(cause) };
  }
}

/**
 * Home: start again after the cover has been bought.
 *
 * Every session naming the old cover goes first, for the reason forgetCover
 * gives: `currentPolicyId` prefers a claim session over a cover session, so a
 * stale one would leave the dashboard showing the cover that was left behind
 * rather than the one just bought.
 */
export async function startAgain(): Promise<void> {
  await forgetCover();
  await startPurchase();
  redirect('/occupation');
}

/**
 * Getting back in with a cover key.
 *
 * The key crosses from the form to here and no further: it goes to the API in
 * a body, the API answers with the cover it opens, and what the browser is left
 * holding is the session cookie. A wrong key gets one sentence and the field
 * back, because there is nothing else true to say about it.
 */
export async function openWithCoverKey(formData: FormData): Promise<SignInResult> {
  const key = String(formData.get('cover_key') ?? '').trim();
  if (key === '') return { found: false, error: COVER_KEY_REFUSED };
  try {
    const { cover } = await openCoverWithKey(key);
    await openCoverSession(cover.policy_id, key);
  } catch (cause) {
    if (cause instanceof ApiError && cause.code === 'cover_key_unknown') {
      return { found: false, error: COVER_KEY_REFUSED };
    }
    reportUnreachable('the cover key', cause);
    return { found: false, error: "We couldn't check that key. Try again in a moment." };
  }
  redirect('/home');
}

/**
 * Getting back in with World ID.
 *
 * The same signed context the purchase check asks for, requested without a
 * purchase in progress, and the same completed result forwarded whole. No
 * credential comes back: this earns a way into a dashboard, not a way to buy.
 */
export async function startSignInCheck(): Promise<WorldRequestContextView | null> {
  try {
    return await requestWorldContext(purchaseWallet(await readPurchase()).accountId);
  } catch {
    return null;
  }
}

/** What a sign in attempt found. `found` false with no error is "no cover yet". */
export interface SignInResult {
  readonly found: boolean;
  readonly error: string | null;
  /**
   * The check was of a kind this deployment does not accept, so the screen can
   * say which check to run instead rather than offering a retry that cannot
   * work. Absent means it was not that kind of refusal. T42.
   */
  readonly wrongCheck?: boolean;
}

export async function signInWithWorld(result: unknown): Promise<SignInResult> {
  try {
    const answer = await signInWithWorldCheck({
      wallet: purchaseWallet(await readPurchase()).accountId,
      result,
    });
    if (answer.cover === null) return { found: false, error: null, wrongCheck: false };
    await openCoverSession(answer.cover.policy_id);
    return { found: true, error: null, wrongCheck: false };
  } catch (cause) {
    return { found: false, error: "We couldn't verify you.", wrongCheck: wrongKind(cause) };
  }
}

/**
 * Home: leave this cover on this browser.
 *
 * Every session that names it, not only the cover cookie: a browser that still
 * resolved the cover through the purchase session would not have signed out of
 * anything. See forgetCover.
 */
export async function signOutOfCover(): Promise<void> {
  await forgetCover();
  redirect('/');
}

const COVER_KEY_REFUSED = "That key doesn't open a cover. Check it and try again.";
