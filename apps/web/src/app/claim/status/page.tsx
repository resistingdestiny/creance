import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { readClaim } from '../../../lib/claim-session';
import { claimScreenOf, fallbackReasonLines } from '../../../lib/claim-model';
import { readClaimStatus, readDecisionLines } from '../../claim-actions';
import { ClaimStatusScreen } from './status-screen';
import { WorkerUnavailable } from '../../unavailable';

/**
 * C6 to C9: the claim after it has been submitted.
 *
 * One route, because they are one screen over time. C6 is what a person sees
 * while the Adjuster is deciding, and the decision replaces it when it arrives:
 * approved, under review, or declined.
 *
 * The sentences a decline carries are read here, on the server, through the
 * admin payload, for the claim id in this browser's own session. They never
 * reach the free endpoint, because they carry dates and sometimes an employer
 * name (docs/CLAIMS.md). Where no token is configured the codes are turned into
 * the same sentences without their dates, so a person still learns why.
 */

export const metadata: Metadata = { title: 'Your claim' };

export const dynamic = 'force-dynamic';

export default async function ClaimStatusPage() {
  const session = await readClaim();
  if (session?.claimId == null) redirect('/home');

  const claim = await readClaimStatus();
  if (claim === null) return <WorkerUnavailable retryHref="/claim/status" />;

  const screen = claimScreenOf(claim);
  const decision = screen === 'declined' ? await readDecisionLines() : { lines: [], why: null };
  const lines =
    decision.lines.length > 0 ? decision.lines : fallbackReasonLines(claim.reasons);

  return <ClaimStatusScreen claim={claim} reasonLines={lines} why={decision.why} />;
}
