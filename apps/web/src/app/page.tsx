import { LandingScreen } from '../components/landing/landing-screen';
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
 * Dynamic and uncached, because the price, the reading and the demo clock on it
 * are live state and a front door that shows yesterday's premium is worse than
 * one that shows no premium.
 */

export const dynamic = 'force-dynamic';

export default async function Landing() {
  return <LandingScreen data={await readLanding()} />;
}
