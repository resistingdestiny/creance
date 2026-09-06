import { LandingScreen } from '../components/landing/landing-screen';
import { readLanding } from '../lib/landing-data';

/**
 * The front door, from the design of record.
 *
 * It replaces the worker flow's start screen, which was this route until T29,
 * and it keeps that screen's two actions: "Get a quote" submits the same
 * beginPurchase server action and "I want to invest" goes to /invest. The four
 * routes that send a visitor here when their purchase session is missing
 * therefore still land on a page that can start one.
 *
 * Dynamic and uncached, because the price, the reading and the demo clock on it
 * are live state and a front door that shows yesterday's premium is worse than
 * one that shows no premium.
 */

export const dynamic = 'force-dynamic';

export default async function Landing() {
  return <LandingScreen data={await readLanding()} />;
}
