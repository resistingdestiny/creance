import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { reportUnreachable } from '../../lib/api';

import { fetchPayout } from '../../lib/audit-api';
import { fetchReplay, type ClaimStatusView } from '../../lib/claim-api';
import {
  claimDay,
  claimsOpenLine,
  homeStateOf,
  homeStatus,
  lapsedCopy,
  replayBadgeLabel,
  type HomeView,
} from '../../lib/claim-model';
import { formatDay, formatWholeMoney } from '../../lib/format';
import { occupationLabel } from '../../lib/occupations';
import { readPurchase } from '../../lib/purchase-session';
import { demoHomeView, demoStatesEnabled } from '../../lib/demo-states';
import { fetchIndex, fetchPolicy, type PolicyView } from '../../lib/worker-api';
import { headlineReading, nextPaymentLine } from '../../lib/worker-model';
import { readClaimStatus } from '../claim-actions';
import { HomeScreen } from './home-screen';
import { WorkerUnavailable } from '../unavailable';

/**
 * Home, the card, docs/DESIGN-TOKENS.md section 8 and the addendum's replaced
 * state.
 *
 * Five states, decided here rather than on the client: Covered, Claims open
 * when the chain says this cover's series is open and this browser has no claim
 * of its own, Claim in progress while one is being decided, Paid out once the
 * money has moved, and Payment due when the cover has lapsed.
 *
 * `?policy=` opens a cover that is not the session's, which is how a run
 * through is reopened after the session behind it has gone.
 *
 * Nothing here polls. The bind is settled by the time it responds, and the
 * claim screen does its own polling.
 */

export const metadata: Metadata = { title: 'Cover' };

export const dynamic = 'force-dynamic';

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ bound?: string; policy?: string; demo?: string }>;
}) {
  const { bound, policy: requested, demo } = await searchParams;

  // The labelled demo control, off unless this deployment turns it on. It
  // renders a state from fixtures and never touches the API.
  if (demo !== undefined && demoStatesEnabled()) {
    const view = demoHomeView(demo);
    if (view !== null) return <HomeScreen bound={false} demo view={view} />;
  }

  const session = await readPurchase();
  const policyId = requested ?? session?.policyId;
  if (!policyId) redirect('/');

  try {
    const policy = await fetchPolicy(policyId);
    const [index, claim, replay] = await Promise.all([
      fetchIndex(policy.group),
      claimFor(policyId),
      fetchReplay(),
    ]);
    const reading = headlineReading(index);
    const state = homeStateOf(policy, claim);

    const view: HomeView = {
      policyId: policy.policy_id,
      occupation: occupationLabel(policy.group),
      cover: Number(BigInt(policy.limit.amount) / 10n ** BigInt(policy.limit.decimals)),
      status: homeStatus(state),
      nextPayment: nextPaymentLine(policy, formatDay),
      index:
        reading === null ? null : { value: reading.value, caption: reading.caption },
      claimsOpen: state === 'claims_open' ? claimsOpenLine(policy) : null,
      paid: state === 'paid' ? await paidRow(policy, claim) : null,
      lapsed: state === 'lapsed' ? lapsedCopy(policy) : null,
      replayBadge: replayBadgeLabel(replay),
    };

    return <HomeScreen bound={bound === '1'} view={view} />;
  } catch (cause) {
    reportUnreachable('home', cause);
    return <WorkerUnavailable retryHref="/home" />;
  }
}

/** The claim this browser submitted on this cover, if it submitted one. */
async function claimFor(policyId: string): Promise<ClaimStatusView | null> {
  const claim = await readClaimStatus();
  return claim !== null && claim.policy_id === policyId ? claim : null;
}

/**
 * "2,500 received" and the day it arrived.
 *
 * From this browser's own claim where there is one, and from the audit trail
 * otherwise: a cover opened from a link has no claim session, and the payout
 * is on the payments topic either way.
 */
async function paidRow(
  policy: PolicyView,
  claim: ClaimStatusView | null,
): Promise<HomeView['paid']> {
  if (claim?.amount != null) {
    return {
      amount: formatWholeMoney(BigInt(claim.amount.amount), claim.amount.decimals),
      day: claim.paid_at === null ? null : claimDay(claim.paid_at),
    };
  }
  const payout = await fetchPayout(policy.policy_id);
  if (payout?.amount == null) return null;
  return {
    amount: formatWholeMoney(BigInt(payout.amount.amount), payout.amount.decimals),
    day: payout.at === null ? null : claimDay(payout.at),
  };
}
