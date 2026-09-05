import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { readClaim } from '../../../lib/claim-session';
import { isInterimIssuer } from '../../../lib/eligibility';
import { ConfirmScreen } from './confirm-screen';

/**
 * C4, Confirm it's you.
 *
 * The check behind it is a fresh Selfie Check with `require_user_presence` on
 * the claim action, with the cover's id as the signal, whenever this deployment
 * has a World app id. A host with none gets the labelled demo presence path and
 * the line that says so, exactly as the purchase Verify screen does.
 */

export const metadata: Metadata = { title: "Confirm it's you" };

export const dynamic = 'force-dynamic';

export default async function ConfirmPage() {
  const session = await readClaim();
  if (session?.policyId == null) redirect('/home');
  if (session.evidence.length === 0) redirect('/claim/proof');

  return (
    <ConfirmScreen
      alreadyVerified={session.credential !== null}
      demo={isInterimIssuer()}
    />
  );
}
