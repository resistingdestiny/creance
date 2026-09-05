import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { isInterimIssuer } from '../../lib/eligibility';
import { readPurchase } from '../../lib/purchase-session';
import { VerifyScreen } from './verify-screen';

/**
 * Confirm you're a real person, docs/DESIGN-TOKENS.md section 8.
 *
 * The check behind it is the World Selfie Check whenever this deployment has a
 * World app id. A clone with none gets the interim issuer and the line that
 * says so; the deck strings are the same either way.
 */

export const metadata: Metadata = { title: 'Confirm you are a real person' };

export const dynamic = 'force-dynamic';

export default async function VerifyPage() {
  const session = await readPurchase();
  if (!session?.group) redirect('/occupation');
  return <VerifyScreen alreadyVerified={session.credential !== null} interim={isInterimIssuer()} />;
}
