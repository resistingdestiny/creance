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

/**
 * The demonstration, for somebody who has bought nothing.
 *
 * Written for a reader with minutes and no reason to trust the screen, so the
 * two halves are kept apart in words as well as in layout: the covers are real,
 * and the states under them are fixtures.
 *
 * The fixtures used to carry a line here saying so. They no longer need one.
 * Every state a real cover can be put into is now offered as that cover, the
 * rest are the three that cannot be, and each of those says on its own face
 * that nothing on it came from the API. A blanket sentence on this screen was
 * saying it a second time, further from the thing it was about.
 *
 * T57 cut it to that. Every slot carried a title and a sentence of description
 * underneath, and the sentences said what the screen behind the button was
 * going to show, which is a thing a reader finds out by pressing the button.
 * The titles do the whole job.
 */
export const DEMO_HEADING = 'See a cover without buying one';
export const DEMO_LINE =
  'These covers are real. Their keys are published, so anyone can open one and look.';
export const DEMO_KEY_LABEL = 'Cover key';
export const DEMO_REFUSED =
  "That key didn't open a cover. The key published here and this deployment have come apart, which is ours to fix.";
export const DEMO_OPEN = 'Open this cover';

/** What each published slot is, in one line, so no slot is a bare name. */
export const DEMO_COVER_COPY = {
  covered: { title: 'A cover that is running' },
  'claims-open': { title: 'A cover with claims open' },
  paid: { title: 'A cover that paid out' },
} as const;

export const DEMO_STATES_HEADING = 'See other examples';
export const DEMO_STATES_HELD =
  'You have a cover open, so these show yours instead. Sign out of it first.';

/** The states by the names the pills use, not by the names in the address. */
export const DEMO_STATE_LABELS: Record<string, string> = {
  covered: 'Covered',
  'claims-open': 'Claims open',
  'claim-in-progress': 'Claim in progress',
  paid: 'Paid out',
  lapsed: 'Payment due',
  replay: 'Replay',
};

/** The one line the front door and the way back in offer this page under. */
export const DEMO_ENTRY = 'See a live cover';
