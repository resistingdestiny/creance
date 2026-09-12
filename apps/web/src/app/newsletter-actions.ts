'use server';

import { redirect } from 'next/navigation';

import { ApiError, postJson, reportUnreachable } from '../lib/api';
import type { NewsletterOutcome } from '../lib/newsletter-model';

/**
 * The newsletter form's one write.
 *
 * A plain form action, the same shape the market's three writes use
 * (src/app/invest/market-actions.ts): the call is made here on the server, and
 * the answer is a redirect back to the page the form was pressed on carrying a
 * code out of a fixed list. The landing page turns the code into the sentence.
 *
 * That is what makes it work before hydration. The landing page ships a client
 * component for the quote card, so a form that needed JavaScript would look
 * like it worked; it would simply be dead for the few seconds before the bundle
 * lands and dead altogether for anybody who blocks it. A form element posting
 * to a server action is neither.
 *
 * The code travels in the address and the sentence never does. A sentence in a
 * query string is a sentence a stranger can put on somebody else's screen.
 *
 * What was typed is not in the redirect either. Putting the address back in the
 * address bar would write it into the browser's history and into any log that
 * records a URL, which is more than "we store your address and the date".
 */

/** Where the form lives on the front door, so the answer lands beside it. */
const ANCHOR = '/?news=';

export async function joinNewsletter(form: FormData): Promise<void> {
  const email = form.get('email');
  // An empty field is the browser's own `required` having been got past, which
  // is the same refusal as rubbish and costs the API nothing to decide here.
  if (typeof email !== 'string' || email.trim() === '') redirect(answer('invalid'));

  let outcome: NewsletterOutcome = 'joined';
  try {
    await postJson('/v1/newsletter', { email: email.trim() });
  } catch (cause) {
    // The API is the judge of what an address is, so its refusal is the one
    // this page reports. Anything else is ours and says so.
    outcome =
      cause instanceof ApiError && (cause.code === 'email_invalid' || cause.code === 'validation_failed')
        ? 'invalid'
        : 'failed';
    if (outcome === 'failed') reportUnreachable('the newsletter sign up', cause);
  }
  redirect(answer(outcome));
}

function answer(outcome: NewsletterOutcome): string {
  return `${ANCHOR}${outcome}#news`;
}
