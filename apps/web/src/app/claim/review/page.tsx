import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { reportUnreachable } from '../../../lib/api';
import { readClaim } from '../../../lib/claim-session';
import { separationLabel } from '../../../lib/claim-model';
import { formatDayWithYear } from '../../../lib/format';
import { fetchPolicy } from '../../../lib/worker-api';
import { coverAmount } from '../../../lib/worker-model';
import { ReviewScreen } from './review-screen';
import { WorkerUnavailable } from '../../unavailable';

/**
 * C5, Review and submit.
 *
 * The payout row is the cover limit read back from the API rather than
 * remembered from the purchase, because the number on this screen is the number
 * the contract would pay and it is worth one request to be sure of it.
 */

export const metadata: Metadata = { title: 'Review your claim' };

export const dynamic = 'force-dynamic';

export default async function ReviewPage() {
  const session = await readClaim();
  if (session?.policyId == null) redirect('/home');
  if (session.credential === null) redirect('/claim/confirm');
  if (session.lastDayOfWork === null) redirect('/claim/job');

  try {
    const policy = await fetchPolicy(session.policyId);
    return (
      <ReviewScreen
        employer={session.employer ?? ''}
        files={session.evidence.length}
        jobTitle={session.jobTitle ?? ''}
        lastDayOfWork={formatDayWithYear(session.lastDayOfWork)}
        payout={coverAmount(policy.limit)}
        separation={separationLabel(session.separationType)}
      />
    );
  } catch (cause) {
    reportUnreachable('claim review', cause);
    return <WorkerUnavailable retryHref="/claim/review" />;
  }
}
