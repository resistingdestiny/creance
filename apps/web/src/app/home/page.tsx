import type { Metadata } from 'next';

import { reportUnreachable } from '../../lib/api';

import { fetchHistory, fetchPayout } from '../../lib/audit-api';
import { fetchReplay, type ClaimStatusView } from '../../lib/claim-api';
import {
  claimDay,
  claimsOpenLine,
  homeStateOf,
  homeStatus,
  indexRow,
  lapsedCopy,
  replayBadgeLabel,
  type HomeView,
} from '../../lib/claim-model';
import { readCoverSession } from '../../lib/current-cover';
import { isInterimIssuer } from '../../lib/eligibility';
import { formatDay, formatWholeMoney } from '../../lib/format';
import { occupationLabel } from '../../lib/occupations';
import { demoHomeView, demoStatesEnabled } from '../../lib/demo-states';
import { fetchIndex, fetchPolicy, type IndexView, type PolicyView } from '../../lib/worker-api';
import {
  bandLabelFor,
  chartDescription,
  chartPoints,
  chartThreshold,
  headlineReading,
  nextPaymentLine,
} from '../../lib/worker-model';
import { readClaimStatus } from '../claim-actions';
import { HomeScreen, type HomeChart } from './home-screen';
import { SignInScreen } from './sign-in-screen';
import { WorkerUnavailable } from '../unavailable';

/**
 * Home, the dashboard, docs/DESIGN-TOKENS.md section 8 and the addendum's
 * replaced state.
 *
 * Five states, decided here rather than on the client: Covered, Claims open
 * when the chain says this cover's series is open and this browser has no claim
 * of its own, Claim in progress while one is being decided, Paid out once the
 * money has moved, and Payment due when the cover has lapsed.
 *
 * Which cover is the cover session's answer, not the address bar's. `?policy=`
 * is gone: T41 replaced it with a signed httpOnly cookie that a cover key or a
 * World ID check fills, so a person who closed the browser has a way back and
 * an id read over a shoulder is not one. See src/lib/current-cover.ts.
 *
 * A request with no session at all gets the way back in rather than a redirect
 * to the front door: somebody who bought cover last week and came back has
 * business here, and the front door has no idea who they are.
 *
 * Nothing here polls. The bind is settled by the time it responds, and the
 * claim screen does its own polling.
 */

export const metadata: Metadata = { title: 'Cover' };

export const dynamic = 'force-dynamic';

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ bound?: string; demo?: string }>;
}) {
  const { bound, demo } = await searchParams;

  // The labelled demo control, off unless this deployment turns it on. It
  // renders a state from fixtures and never touches the API.
  if (demo !== undefined && demoStatesEnabled()) {
    const view = demoHomeView(demo);
    if (view !== null) return <HomeScreen bound={false} demo view={view} />;
  }

  const session = await readCoverSession();
  if (session === null) return <SignInScreen world={!isInterimIssuer()} />;
  const policyId = session.policyId;

  try {
    const policy = await fetchPolicy(policyId);
    const [index, claim, replay, history] = await Promise.all([
      fetchIndex(policy.group),
      claimFor(policyId),
      fetchReplay(),
      fetchHistory(policyId),
    ]);
    const reading = headlineReading(index);
    const state = homeStateOf(policy, claim);
    const occupation = occupationLabel(policy.group);

    const view: HomeView = {
      policyId: policy.policy_id,
      occupation,
      cover: Number(BigInt(policy.limit.amount) / 10n ** BigInt(policy.limit.decimals)),
      status: homeStatus(state),
      nextPayment: nextPaymentLine(policy, formatDay),
      index: indexRow(reading, policy.claims?.open === true, occupation),
      claimsOpen: state === 'claims_open' ? claimsOpenLine(policy) : null,
      paid: state === 'paid' ? await paidRow(policy, claim) : null,
      lapsed: state === 'lapsed' ? lapsedCopy(policy) : null,
      replayBadge: replayBadgeLabel(replay),
    };

    return (
      <HomeScreen
        bound={bound === '1'}
        chart={homeChart(index)}
        coverKey={session.coverKey}
        history={history}
        view={view}
      />
    );
  } catch (cause) {
    reportUnreachable('home', cause);
    return <WorkerUnavailable retryHref="/home" />;
  }
}

/**
 * The Home row's line, docs/DESIGN-TOKENS.md section 5.
 *
 * The same points, threshold and band label the Index tab draws from, so the
 * two charts cannot disagree about the reading. Section 5 gives the small chart
 * 64 by 20 and no band unless the state is triggered, which is what the screen
 * passes on.
 */
function homeChart(index: IndexView): HomeChart {
  return {
    points: chartPoints(index),
    threshold: chartThreshold(index),
    bandLabel: bandLabelFor(index),
    description: chartDescription(index),
    open: index.trigger.open,
  };
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
 * otherwise: a cover opened with a key has no claim session, and the payout is
 * on the payments topic either way.
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
