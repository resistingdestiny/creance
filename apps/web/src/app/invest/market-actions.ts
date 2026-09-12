'use server';

import { redirect } from 'next/navigation';

import {
  MarketApiError,
  cancelOffer,
  fillOffer,
  makeOffer,
} from '../../lib/investor-api';
import { marketOutcome, type MarketOutcome } from '../../lib/investor-model';
import { demoInvestorAccount } from '../../lib/wallet';

/**
 * The secondary market's three writes.
 *
 * Every one of them is made here, on the server, and every one of them names
 * the demo investor account this deployment speaks for rather than an account
 * out of the form. A form on a public page is a public endpoint: a body that
 * could name its own seller would let anybody move somebody else's note, so the
 * only thing the form carries is which offer, and how many units at what price.
 *
 * The screens are server rendered and have no client JavaScript, so these are
 * plain form actions and the answer is a redirect back to the page the form was
 * on. What happened travels in the address as a code out of a fixed list, never
 * as a message: a sentence in a query string is a sentence a stranger can put
 * on somebody else's screen, and the screen writes its own words from the code.
 *
 * The refusal is the part that matters. `fillOffer` throws with
 * `fill_refused` when the note's own register has not approved the buyer, and
 * it throws before anything is signed. The chain does the same thing to a call
 * that got past it: the transfer leg reverts on the KYC status before any money
 * moves. Both are the note refusing, which is the compliance control working,
 * and the screen says so rather than reporting a failure.
 */

/** Note units and money are both six decimals on this deployment. */
const SCALE = 1_000_000n;

/**
 * Where a form came from, so the redirect lands back on the screen it was
 * pressed on rather than on whichever screen the series happens to have.
 *
 * The board and the series page both carry these forms. `back` says which, and
 * it is a flag out of two values rather than a path, because a path in a form
 * field is an open redirect.
 */
function backTo(form: FormData, outcome: MarketOutcome): string {
  const series = asId(form.get('series'));
  const toBoard = form.get('back') === 'board' || series === null;
  const base = toBoard ? '/invest' : `/invest?series=${encodeURIComponent(series)}`;
  return `${base}${toBoard ? '?' : '&'}market=${outcome}`;
}

/**
 * A series id or an offer id out of a form, or null.
 *
 * Both go into an address, so both are held to the shapes the API issues: a
 * series id is the identifier the list serves and an offer id is a decimal
 * counter. Anything else is not sent on and not echoed.
 */
function asId(value: FormDataEntryValue | null): string | null {
  if (typeof value !== 'string') return null;
  return /^[A-Za-z0-9-]{1,40}$/.test(value) ? value : null;
}

function asOfferId(value: FormDataEntryValue | null): string | null {
  if (typeof value !== 'string') return null;
  return /^[0-9]{1,20}$/.test(value) ? value : null;
}

/**
 * A whole number a person typed, in minor units.
 *
 * Whole units and whole prices only. The note's units are integers in six
 * decimals and every price in this product is a round figure, so a field that
 * took fractions would be a field whose rounding somebody would have to explain.
 */
function asWholeMinor(value: FormDataEntryValue | null, max: number): bigint | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^[0-9]{1,9}$/.test(trimmed)) return null;
  const whole = Number(trimmed);
  if (whole <= 0 || whole > max) return null;
  return BigInt(whole) * SCALE;
}

/** The code to redirect with, from the problem document the API answered. */
function outcomeOf(cause: unknown): MarketOutcome {
  if (!(cause instanceof MarketApiError)) return 'failed';
  return marketOutcome(cause.code ?? undefined) ?? 'failed';
}

/** Take an open offer whole, as the account these screens speak for. */
export async function takeOffer(form: FormData): Promise<void> {
  const offerId = asOfferId(form.get('offer'));
  if (offerId === null) redirect(backTo(form, 'invalid'));

  let outcome: MarketOutcome = 'filled';
  try {
    await fillOffer(offerId, demoInvestorAccount().evmAddress);
  } catch (cause) {
    outcome = outcomeOf(cause);
  }
  redirect(backTo(form, outcome));
}

/** Put a lot of notes on the market at a price a unit. */
export async function offerNotes(form: FormData): Promise<void> {
  const series = asId(form.get('series'));
  const units = asWholeMinor(form.get('units'), 1_000_000);
  const perUnit = asWholeMinor(form.get('price'), 1_000_000);
  if (series === null || units === null || perUnit === null) redirect(backTo(form, 'invalid'));

  let outcome: MarketOutcome = 'offered';
  try {
    await makeOffer({
      seller: demoInvestorAccount().evmAddress,
      series,
      units: units.toString(),
      // The form asks for a price a unit, because that is what the book is
      // quoted in; the API takes the price of the lot.
      price: ((units * perUnit) / SCALE).toString(),
    });
  } catch (cause) {
    outcome = outcomeOf(cause);
  }
  redirect(backTo(form, outcome));
}

/** Withdraw an offer this account made. */
export async function withdrawOffer(form: FormData): Promise<void> {
  const offerId = asOfferId(form.get('offer'));
  if (offerId === null) redirect(backTo(form, 'invalid'));

  let outcome: MarketOutcome = 'withdrawn';
  try {
    await cancelOffer(offerId, demoInvestorAccount().evmAddress);
  } catch (cause) {
    outcome = outcomeOf(cause);
  }
  redirect(backTo(form, outcome));
}
