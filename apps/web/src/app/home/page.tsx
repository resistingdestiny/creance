import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { formatDay } from '../../lib/format';
import { occupationLabel } from '../../lib/occupations';
import { readPurchase } from '../../lib/purchase-session';
import { fetchIndex, fetchPolicy } from '../../lib/worker-api';
import { headlineReading, nextPaymentLine } from '../../lib/worker-model';
import { HomeScreen } from './home-screen';
import { WorkerUnavailable } from '../unavailable';

/**
 * Home, the card, docs/DESIGN-TOKENS.md section 8.
 *
 * It reads the policy and the index and nothing else. `?policy=` opens a policy
 * that is not the session's, which is how a run through is reopened after the
 * session behind it has gone.
 *
 * Nothing here polls. The bind is settled by the time it responds, and polling
 * for a policy that already exists is how the orchestrated moment gets minted
 * twice.
 */

export const metadata: Metadata = { title: 'Cover' };

export const dynamic = 'force-dynamic';

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ bound?: string; policy?: string }>;
}) {
  const { bound, policy: requested } = await searchParams;
  const session = await readPurchase();
  const policyId = requested ?? session?.policyId;
  if (!policyId) redirect('/');

  try {
    const policy = await fetchPolicy(policyId);
    const index = await fetchIndex(policy.group);
    const reading = headlineReading(index);
    return (
      <HomeScreen
        bound={bound === '1'}
        cover={Number(BigInt(policy.limit.amount) / 10n ** BigInt(policy.limit.decimals))}
        indexCaption={reading?.caption ?? null}
        indexValue={reading?.value ?? null}
        nextPayment={nextPaymentLine(policy, formatDay)}
        occupation={occupationLabel(policy.group)}
      />
    );
  } catch {
    return <WorkerUnavailable retryHref="/home" />;
  }
}
