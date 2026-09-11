'use client';

import { useEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { AppFrame } from '../../../components/app-frame';
import { CoverCardShell } from '../../../components/cover-card';
import { DisplayNumber } from '../../../components/display-number';
import { ListRow } from '../../../components/list-row';
import { PillButton, PillLink } from '../../../components/pill-button';
import { SurfaceGroup } from '../../../components/surface-group';
import { TextLink } from '../../../components/text-link';
import type { ClaimStatusView } from '../../../lib/claim-api';
import { claimDay, claimIsDecided, claimReference, claimScreenOf } from '../../../lib/claim-model';
import { readClaimStatus, submitAgain } from '../../claim-actions';
import type { Money } from '../../../lib/api';

/**
 * C6, C7, C8 and C9, from the free read of the claim.
 *
 * The poll is the screen's own: `GET /v1/claims/:id` is free precisely so a
 * claim screen can ask it (docs/CLAIMS.md, "The claimant's own read"). It stops
 * the moment there is a decision, because a decided claim does not change
 * again, and it never runs at all on a screen that already carries one.
 *
 * The amount is the API's, in minor units with its scale beside it, and it is
 * formatted here through the one formatter in this app. It never counts up: the
 * design gives this product one orchestrated moment and it belongs to the
 * purchase.
 */

/** The money envelope in whole cover amounts, which is what a display number takes. */
function wholeUnits(money: Money): number {
  return Number(BigInt(money.amount) / 10n ** BigInt(money.decimals));
}

/** Clean claims are decided in minutes, so a slow poll would be a slow demo. */
const POLL_MS = 3_000;

export function ClaimStatusScreen({
  claim,
  reasonLines,
  why,
}: {
  claim: ClaimStatusView;
  reasonLines: readonly string[];
  why: string | null;
}) {
  const router = useRouter();
  const screen = claimScreenOf(claim);
  const decided = claimIsDecided(claim);

  useEffect(() => {
    if (decided) return;
    const timer = setInterval(() => {
      void readClaimStatus().then((latest) => {
        if (latest !== null && latest.status !== claim.status) router.refresh();
      });
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [claim.status, decided, router]);

  if (screen === 'approved') return <Approved claim={claim} />;
  if (screen === 'under_review') return <UnderReview claim={claim} />;
  if (screen === 'declined') {
    return <Declined claim={claim} reasonLines={reasonLines} why={why} />;
  }
  return <Received />;
}

/** C6. Mostly empty, on purpose: there is nothing for the person to do. */
function Received() {
  return (
    <Screen
      heading="Claim received."
      line="Most claims are decided in minutes. You'll see the answer here."
    >
      <TextLink href="/home">Back to cover</TextLink>
    </Screen>
  );
}

/**
 * C7. The amount, then the way to the cover the payout lands on.
 *
 * The amount is drawn on a certificate in the metal (T49), because a payout
 * is the value the cover existed for and the certificate is the object the
 * product gives to value. It is this screen's one shimmer, and it is the only
 * decided state that gets the material: under review and declined stay on
 * canvas, since a failure state is not the place for a moving light. The
 * heading and the line above it say what the figure is, so the card carries
 * the figure alone and no new words; the light is a layer under the content,
 * so the number never sits on it.
 */
function Approved({ claim }: { claim: ClaimStatusView }) {
  return (
    <Screen heading="Approved." line="On its way to your wallet.">
      {claim.amount === null ? null : (
        <CoverCardShell className="w-full" metal="shimmer" treatment="certificate">
          <div className="cover-card__content flex flex-col items-center py-8">
            <DisplayNumber size="display-l" value={wholeUnits(claim.amount)} />
          </div>
        </CoverCardShell>
      )}
      <PillLink href="/home">Back to cover</PillLink>
    </Screen>
  );
}

/** C8. A person is reading it, and an overdue claim is flagged, never decided. */
function UnderReview({ claim }: { claim: ClaimStatusView }) {
  return (
    <Screen
      heading="A person is checking your claim."
      line="Usually within one working day. There's nothing you need to do."
    >
      <SurfaceGroup className="w-full">
        <ListRow
          label="Submitted"
          value={
            <span className="tabular-nums">
              {claim.submitted_at === null ? '' : claimDay(claim.submitted_at)}
            </span>
          }
        />
        <ListRow
          label="Reference"
          value={<span className="tabular-nums">{claimReference(claim.claim_id)}</span>}
        />
      </SurfaceGroup>
      <TextLink href="/home">Back to cover</TextLink>
    </Screen>
  );
}

/**
 * C9. The sentences from the decision record, one per line, then what the
 * person can do about it.
 *
 * "Submit again" is offered only where the decision says a corrected packet
 * would be worth submitting. A resignation is not a document problem, so
 * offering to resubmit one would be an invitation to be declined twice.
 */
function Declined({
  claim,
  reasonLines,
  why,
}: {
  claim: ClaimStatusView;
  reasonLines: readonly string[];
  why: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const allowed = claim.resubmit?.allowed === true;

  return (
    <Screen heading="We can't pay this claim." lines={reasonLines}>
      <section className="flex w-full flex-col gap-2">
        <h2 className="text-body-lg font-medium text-ink">What you can do</h2>
        <p className="text-body text-ink-2">
          {why ??
            (allowed
              ? 'If you have a document that shows a different end date, add it and submit again.'
              : 'There is nothing to change on this claim.')}
        </p>
      </section>
      {allowed ? (
        <PillButton
          className="w-full"
          loading={pending}
          onClick={() => startTransition(() => submitAgain())}
        >
          Submit again
        </PillButton>
      ) : null}
      <TextLink href="/home">Back to cover</TextLink>
    </Screen>
  );
}

/** The shape all four share: a heading, what it means, then one way onward. */
function Screen({
  heading,
  line,
  lines,
  children,
}: {
  heading: string;
  line?: string;
  lines?: readonly string[];
  children: React.ReactNode;
}) {
  return (
    <AppFrame>
      <main className="flex min-h-frame flex-col justify-between gap-8 px-5 py-10">
        <div className="flex flex-col gap-4">
          <h1 className="text-title font-display font-semibold tracking-title text-ink">
            {heading}
          </h1>
          {line === undefined ? null : <p className="text-body-lg text-ink-2">{line}</p>}
          {(lines ?? []).map((one) => (
            <p className="text-body-lg text-ink-2" key={one}>
              {one}
            </p>
          ))}
        </div>
        <div className="flex flex-col items-center gap-5">{children}</div>
      </main>
    </AppFrame>
  );
}
