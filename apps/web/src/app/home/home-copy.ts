import type { HomeState } from '../../lib/claim-model';

/**
 * Home's own strings, from docs/DESIGN-TOKENS.md section 8.
 *
 * They live beside the screen rather than in src/lib/claim-model.ts because
 * they are about the dashboard and about getting back into it, and nothing else
 * in the app says them. The rules are the deck's: sentence case, no em or en
 * dashes, say what happened and what to do next, and never "policy", "bind",
 * "settle", "parametric", "nullifier" or "on chain" where a worker can read it.
 */

/**
 * Whether you are covered, in words.
 *
 * The card's status pill carries the same fact as a colour and a label, and a
 * colour is not a sentence: a person who cannot tell amber from red, or who is
 * reading this aloud, gets the answer here.
 */
const STATUS_SENTENCE: Record<HomeState, string> = {
  covered: "You're covered.",
  claims_open: 'Claims are open for your occupation.',
  claim_in_progress: 'Your claim is being decided.',
  paid: 'Your claim has been paid.',
  lapsed: 'Your cover needs a payment.',
};

export function statusSentence(state: HomeState): string {
  return STATUS_SENTENCE[state];
}

/** The audit trail, under the heading the deck gives it. */
export const HISTORY_HEADING = 'What has happened';
export const HISTORY_EMPTY = 'Nothing has happened on this cover yet.';

/** How many entries the dashboard shows before the receipt takes over. */
export const HISTORY_LIMIT = 5;

/** The cover key, shown back to the person from inside their own session. */
export const KEY_HEADING = 'Your cover key';
export const KEY_REVEAL = 'Show cover key';
export const KEY_KEEP = 'Keep this somewhere safe. It is how you get back in anywhere.';
export const SIGN_OUT = 'Sign out of this cover';

/** Getting back in, when there is no session to get back into. */
export const BACK_IN_HEADING = 'Get back into your cover';
export const BACK_IN_LINE =
  'World ID is how you get back in on your own phone. Your cover key is how you get back in anywhere.';
export const BACK_IN_WORLD = 'Sign in with World ID';
export const BACK_IN_KEY_LABEL = 'Cover key';
export const BACK_IN_KEY_HINT = 'The twenty characters you were given when you bought your cover.';
export const BACK_IN_KEY_ACTION = 'Open my cover';

/**
 * A check that worked and found nothing.
 *
 * Not a failure and not phrased as one. The person proved who they are; the
 * honest answer is that this World ID has not bought cover yet.
 */
export const NO_COVER_HEADING = 'No cover yet.';
export const NO_COVER_LINE = "That World ID hasn't bought cover. Getting one takes about two minutes.";
export const NO_COVER_ACTION = 'Get a quote';
