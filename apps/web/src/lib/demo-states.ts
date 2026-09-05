import { homeStatus, type HomeView } from './claim-model';
import { serverFlag } from './server-env';

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

/** The demo series' own figures, so a fixture never invents a price. */
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

export function demoStatesEnabled(): boolean {
  return serverFlag('WEB_DEMO_STATES');
}

/** One state, or null for a name this control does not know. */
export function demoHomeView(name: string): HomeView | null {
  return STATES[name]?.() ?? null;
}
