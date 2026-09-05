import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { isInterimIssuer } from '../../lib/eligibility';
import { readPurchase } from '../../lib/purchase-session';
import { VerifyScreen } from './verify-screen';

/**
 * Confirm you're a real person, docs/DESIGN-TOKENS.md section 8.
 *
 * T11 replaces the check behind this screen with the World Selfie Check. The
 * strings do not change when it does; the interim line does.
 */

export const metadata: Metadata = { title: 'Confirm you are a real person' };

export const dynamic = 'force-dynamic';

export default async function VerifyPage() {
  const session = await readPurchase();
  if (!session?.group) redirect('/occupation');
  return <VerifyScreen alreadyVerified={session.credential !== null} interim={isInterimIssuer()} />;
}
