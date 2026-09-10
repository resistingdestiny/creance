import { LandingScreen } from '../components/landing/landing-screen';
import { demonstrationOn } from '../lib/demo-states';
import { isInterimIssuer } from '../lib/eligibility';
import { readLanding } from '../lib/landing-data';

/**
 * The front door, from the design of record.
 *
 * It replaces the worker flow's start screen, which was this route until T29,
 * and it keeps that screen's two actions. "I want to invest" goes to /invest.
 * "Get a quote" opened /occupation through a server action and a redirect until
 * T35; it now opens the quote in place, on this page. The purchase session is
 * started by the first thing that quote writes, because updatePurchase starts
 * one when there is none, so the four routes that send a visitor here when
 * their session is missing still land on a page that can start one.
 *
 * Dynamic, because the price, the reading and the demo clock on it are live
 * state and none of them may be baked into a build. It is not awaited: the
 * figures are read behind a short hold and handed to the page as promises, so
 * the shell is on the first byte and each figure arrives in its own place
 * (T40). Nothing here is a fixture and nothing is a build time constant.
 *
 * T37 brought the World check and the payment onto it too, so it now needs the
 * one thing /verify needed from the server: whether this deployment has a World
 * app id at all. A clone with none gets the interim issuer and says so, in the
 * same words on the same step.
 */

export const dynamic = 'force-dynamic';

export default function Landing() {
  return (
    <LandingScreen
      data={readLanding()}
      demo={demonstrationOn()}
      interim={isInterimIssuer()}
    />
  );
}
