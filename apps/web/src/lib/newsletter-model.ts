/**
 * What the newsletter form says, in one place.
 *
 * The words are here rather than in the component for the reason
 * src/lib/investor-model.ts gives about the market's outcomes: the form posts
 * to a server action and the answer comes back as a code in the address, so the
 * screen writes its own sentence from the code and nothing a stranger can put
 * in a query string ever reaches a reader.
 *
 * There are three codes and no fourth. "Joined" is the answer whether the
 * address was new or already held, because the API answers those two
 * identically on purpose and a screen that could tell them apart would undo
 * that: the page must not be able to report whether somebody is on the list.
 */

export const NEWSLETTER_OUTCOMES = ['joined', 'invalid', 'failed'] as const;

export type NewsletterOutcome = (typeof NEWSLETTER_OUTCOMES)[number];

/** A code out of the address, or null for anything else. */
export function newsletterOutcome(value: string | undefined): NewsletterOutcome | null {
  return NEWSLETTER_OUTCOMES.includes(value as NewsletterOutcome)
    ? (value as NewsletterOutcome)
    : null;
}

export interface NewsletterMessage {
  /** Whether the address was taken. Decides the pill and the tone. */
  readonly done: boolean;
  readonly line: string;
}

/**
 * What happened, in the product's voice.
 *
 * The refusal says what is wrong with the address and never repeats the
 * address. Echoing it back is the ordinary thing to do and it is the one thing
 * this form may not do: what was typed goes into the page, into the history and
 * into anything that renders the answer, and none of that is worth a person
 * seeing their own typo twice.
 */
export function newsletterMessage(outcome: NewsletterOutcome): NewsletterMessage {
  switch (outcome) {
    case 'joined':
      return { done: true, line: 'Thanks. We have your address.' };
    case 'invalid':
      return {
        done: false,
        line: 'That does not look like an email address. Check it and try again.',
      };
    case 'failed':
      return { done: false, line: 'That did not save. Try again in a moment.' };
  }
}

/**
 * What happens to an address, said before anybody types one.
 *
 * Every clause is checkable. Two columns are stored and no third
 * (apps/api/migrations/006_newsletter.sql), the deployment runs against a test
 * network, there is no provider, no key and no queue anywhere in this
 * repository, and nothing has gone out. It names no frequency and no date,
 * because a frequency this cannot keep and a launch nobody has set are the two
 * lies a sign up form tells by default.
 */
export const NEWSLETTER_NOTICE =
  'We store your address and the date, nothing else: this is a prototype on a test network, there is no mailing list behind it, and nothing has been sent to anyone.';
