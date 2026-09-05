import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { readClaim } from '../../../lib/claim-session';
import { JobForm } from './job-form';

/**
 * C2, Your job.
 *
 * The claim session is the guard: a step that arrives without one has no cover
 * to be about, so it goes back to Home rather than guessing which cover it was.
 * Every field is prefilled from the session, so going back from C3 loses
 * nothing.
 */

export const metadata: Metadata = { title: 'Your job' };

export const dynamic = 'force-dynamic';

export default async function JobPage() {
  const session = await readClaim();
  if (session?.policyId == null) redirect('/home');

  return (
    <JobForm
      employer={session.employer}
      fullName={session.fullName}
      jobTitle={session.jobTitle}
      lastDayOfWork={session.lastDayOfWork}
      separationType={session.separationType}
    />
  );
}
