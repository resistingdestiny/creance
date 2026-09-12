import { homeStatus, type HomeView } from './claim-model';
import { serverFlag, serverVar } from './server-env';

/**
 * The labelled demo control, off by default.
 *
 * T16's acceptance asks for every state to be reachable through the replay or a
 * demo control. Three of them have no server path to force: a cover only lapses
 * when a month's premium goes unpaid, a payment only fails when a wallet is
 * short, and a browser is only offline when it is offline. So this renders any
 * Home state from fixtures, behind a private flag, and every screen it renders
 * says on its face that nothing on it came from the API.
 *
 * A state here is a fallback and not the offer. Where a deployment has bound a
 * real cover in a state, `DEMO_COVER_SLOTS` publishes it and the screen drops
 * the fixture: a judge pressing Paid out should reach a cover that really was
 * paid, with the transaction that paid it. The slot names below are these state
 * names for exactly that reason, so the two halves line up without a table
 * between them.
 *
 * A private variable and never a NEXT_PUBLIC one, in the spirit of the demo
 * eligibility issuer: the web image inlines public variables at build time, and
 * a demo control that cannot be turned off after a build is not off by default.
 * Recorded in docs/DECISIONS.md.
 *
 *     WEB_DEMO_STATES=true   then /home?demo=lapsed
 *
 * The states, and what each is for:
 *
 *     covered              the ordinary card
 *     claims-open          the amber pill and the line that invites a claim
 *     claim-in-progress    the amber pill while a claim is being decided
 *     paid                 the red pill, the payout row and the receipt
 *     lapsed               the red pill, "Payment due", and the way to pay
 *     replay               the replay badge over the ordinary card
 */

const OCCUPATION = 'Computer and mathematical';

/**
 * The fixture's figures.
 *
 * The comment here used to say these were the demo series' own, so a fixture
 * never invents a price. That stopped being true when the pricing was solved
 * from the return capital requires on 12 September 2026: 4.25 was a real quote
 * on this series under the old formula and is now roughly a sixth of one.
 *
 * It is left at 4.25 rather than chased, because chasing it would make the same
 * comment false again at the next repricing. What makes a fixture honest is not
 * that its numbers are current, it is that every screen drawn from one says on
 * its own face that nothing on it came from the API, which they all do. These
 * three states are also unreachable in this deployment: covered, claims open
 * and paid out are real covers now, and the states below are the ones that
 * cannot be reached live.
 */
const COVER = 1_000;
const PREMIUM = '4.25';

function base(): HomeView {
  return {
    policyId: 'pol_01M1S3EBDQR3W79A9E8MR6MPYB',
    occupation: OCCUPATION,
    cover: COVER,
    status: homeStatus('covered'),
    nextPayment: `${PREMIUM} on 4 October`,
    index: { value: '0.69, steady', caption: 'Points from opening claims.' },
    claimsOpen: null,
    paid: null,
    lapsed: null,
    replayBadge: null,
  };
}

const STATES: Record<string, () => HomeView> = {
  covered: base,
  'claims-open': () => ({
    ...base(),
    status: homeStatus('claims_open'),
    index: { value: '0.00, rising', caption: 'Claims are open for Computer and mathematical.' },
    claimsOpen: 'If you lost your job on or after 30 January, you can claim 1,000.',
  }),
  'claim-in-progress': () => ({ ...base(), status: homeStatus('claim_in_progress') }),
  paid: () => ({
    ...base(),
    status: homeStatus('paid'),
    paid: { amount: '1,000', day: '5 September 2026' },
  }),
  lapsed: () => ({
    ...base(),
    status: homeStatus('lapsed'),
    lapsed: {
      heading: 'Payment due',
      line: 'Pay by 19 October to stay covered.',
      action: `Pay ${PREMIUM}`,
    },
  }),
  replay: () => ({ ...base(), replayBadge: 'Replay: Jul 2026' }),
};

/** The states the control can render, for the screen that lists them. */
export const DEMO_STATES: readonly string[] = Object.keys(STATES);

/**
 * The states left for fixtures to show, once the real covers have taken theirs.
 *
 * A state with a real cover behind it is offered as that cover and not twice, so
 * the list on the screen shrinks as a deployment gets more of the product into a
 * state it can publish. On a deployment that has published nothing this is all
 * six, which is where this control started.
 */
export function fixtureStates(covers: readonly DemoCover[]): readonly string[] {
  const real = new Set<string>(covers.map((cover) => cover.slot));
  return DEMO_STATES.filter((state) => !real.has(state));
}

export function demoStatesEnabled(): boolean {
  return serverFlag('WEB_DEMO_STATES');
}

/** One state, or null for a name this control does not know. */
export function demoHomeView(name: string): HomeView | null {
  return STATES[name]?.() ?? null;
}

/**
 * The covers a deployment publishes a way into, and the key that opens each.
 *
 * A judge has minutes, no World ID and no wallet, and cover behind all three is
 * cover nobody sees. The cover key is the one way into a dashboard that needs
 * none of them, so `pnpm demo:seed` captures the key of every cover it binds
 * and prints this line for the operator to set.
 *
 *     WEB_DEMO_COVERS=covered:K7QP...,claims-open:3ZDN...,paid:9F0R...
 *
 * A slot is named for the Home state the cover behind it is in, and the three
 * here are the three states a cover can be put into and then opened cold, by
 * somebody who has no session of their own:
 *
 *     covered       a cover on a series whose claims are shut
 *     claims-open   a cover on a series whose claims are open
 *     paid          a cover whose claim was approved and paid
 *
 * The other three Home states cannot be reached that way, and stay fixtures.
 * Claim in progress is read from the browser's own claim session, so a stranger
 * opening the cover with its key sees no claim. Nothing in this build lapses a
 * cover. The replay badge is the oracle's mode and belongs to the whole
 * deployment rather than to one cover.
 *
 * The seed fills a slot from what the database and the chain say the cover is,
 * so a deployment that has paid no claim publishes no paid cover.
 *
 * These keys are bearer keys, exactly as strong as every other cover key, and
 * they are published on purpose. Each opens its own cover and nothing else,
 * which is the property that makes publishing one safe. Private and never a
 * NEXT_PUBLIC name for the same reason as the flag above: the key belongs in
 * the page the server renders, not inlined into every bundle at build time.
 */
export const DEMO_COVER_SLOTS = ['covered', 'claims-open', 'paid'] as const;
export type DemoCoverSlot = (typeof DEMO_COVER_SLOTS)[number];

export interface DemoCover {
  readonly slot: DemoCoverSlot;
  /** Canonical, twenty characters, as apps/api/src/cover-key.ts issued it. */
  readonly key: string;
}

/** Crockford's base 32 without the four letters it never prints: I, L, O, U. */
const KEY_SHAPE = /^[0-9A-HJKMNP-TV-Z]{20}$/;

/**
 * The setting, read.
 *
 * An entry this cannot make sense of is dropped rather than rendered, because a
 * button that cannot open anything is worse on this screen than no button: the
 * whole claim it makes is that what you are about to see is real. The API is
 * still the authority on what opens a cover; this only decides what to offer.
 */
export function parseDemoCovers(raw: string): DemoCover[] {
  const found: DemoCover[] = [];
  for (const entry of raw.split(',')) {
    const at = entry.indexOf(':');
    if (at === -1) continue;
    const slot = entry.slice(0, at).trim();
    const key = entry.slice(at + 1).replace(/[\s\-_]/g, '').toUpperCase();
    if (!(DEMO_COVER_SLOTS as readonly string[]).includes(slot)) continue;
    if (!KEY_SHAPE.test(key)) continue;
    if (found.some((cover) => cover.slot === slot)) continue;
    found.push({ slot: slot as DemoCoverSlot, key });
  }
  return DEMO_COVER_SLOTS.flatMap((slot) => found.filter((cover) => cover.slot === slot));
}

export function demoCovers(): DemoCover[] {
  return parseDemoCovers(serverVar('WEB_DEMO_COVERS') ?? '');
}

/**
 * Whether this deployment has a demonstration to show at all.
 *
 * The front door only offers the link when there is something behind it, so a
 * deployment that has published neither a cover nor the fixture states never
 * mentions either.
 */
export function demonstrationOn(): boolean {
  return demoCovers().length > 0 || demoStatesEnabled();
}
