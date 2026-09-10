import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { reportUnreachable } from '../../lib/api';
import { currentPolicyId } from '../../lib/current-cover';
import { fetchPolicy } from '../../lib/worker-api';
import { ClaimsClosed } from './claims-closed';
import { BeforeYouStart } from './before-you-start';
import { WorkerUnavailable } from '../unavailable';

/**
 * C1, Before you start, and the screen that says claims aren't open.
 *
 * Which of the two renders is the chain's answer, not this app's: the cover's
 * `claims` block is read from `CoverPool.seriesOf` at every request, so the
 * screen and the contract cannot disagree while somebody is watching
 * (docs/CLAIMS.md, "Claims aren't open"). The refusal's sentences are composed
 * server side and printed verbatim.
 *
 * A cover whose API has not read the chain for it carries no block at all. That
 * is not an open cover, so it gets the refusal with the one sentence the API
 * would have said about a closed one.
 *
 * Which cover is `currentPolicyId`'s answer and no longer the address bar's:
 * T41 replaced `?policy=` with the cover session behind the httpOnly cookie.
 */

export const metadata: Metadata = { title: 'Claim' };

export const dynamic = 'force-dynamic';

export default async function ClaimPage() {
  const policyId = await currentPolicyId();
  if (policyId === null) redirect('/');

  try {
    const policy = await fetchPolicy(policyId);
    const claims = policy.claims;
    if (claims === undefined || !claims.open) {
      return <ClaimsClosed claims={claims ?? null} />;
    }
    return <BeforeYouStart policy={policy} />;
  } catch (cause) {
    reportUnreachable('claim', cause);
    return <WorkerUnavailable retryHref="/claim" />;
  }
}
