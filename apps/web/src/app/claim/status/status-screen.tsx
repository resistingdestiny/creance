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
  return <Received claim={claim} />;
}

/**
 * The two facts a submitted claim has whatever happens to it next: the day it
 * went in and the reference to quote. Read from the claim record, never
 * composed here.
 */
function ClaimFacts({ claim }: { claim: ClaimStatusView }) {
  return (
    <SurfaceGroup>
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
  );
}

/**
 * C6. There is nothing for the person to do, so the screen asks nothing of
 * them. What it does carry is the reference, because a person who has just
 * handed over their documents and been told to wait has otherwise been given
 * nothing to hold.
 */
function Received({ claim }: { claim: ClaimStatusView }) {
  return (
    <Screen
      actions={<TextLink href="/home">Back to cover</TextLink>}
      heading="Claim received."
      line="Most claims are decided in minutes. You'll see the answer here."
    >
      <ClaimFacts claim={claim} />
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
 *
 * T57 moved it up under the heading. It used to sit in the bottom group with
 * the button, which at any height above a phone left the one number this whole
 * flow exists to produce stranded below a screen of empty canvas.
 */
function Approved({ claim }: { claim: ClaimStatusView }) {
  return (
    <Screen
      actions={<PillLink className="w-full" href="/home">Back to cover</PillLink>}
      heading="Approved."
      line="On its way to your wallet."
    >
      {claim.amount === null ? null : (
        <CoverCardShell className="w-full" metal="shimmer" treatment="certificate">
          <div className="cover-card__content flex flex-col items-center py-8">
            <DisplayNumber size="display-l" value={wholeUnits(claim.amount)} />
          </div>
        </CoverCardShell>
      )}
    </Screen>
  );
}

/** C8. A person is reading it, and an overdue claim is flagged, never decided. */
function UnderReview({ claim }: { claim: ClaimStatusView }) {
  return (
    <Screen
      actions={<TextLink href="/home">Back to cover</TextLink>}
      heading="A person is checking your claim."
      line="Usually within one working day. There's nothing you need to do."
    >
      <ClaimFacts claim={claim} />
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
 *
 * The reference is under it because a decline is the one answer somebody comes
 * back about, and being asked for a reference they were never shown is the
 * worst end to this flow there is.
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
    <Screen
      actions={
        <>
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
        </>
      }
      heading="We can't pay this claim."
      lines={reasonLines}
    >
      <section className="flex flex-col gap-2 rounded-group bg-surface p-4">
        <h2 className="text-body-lg font-medium text-ink">What you can do</h2>
        <p className="text-body text-ink-2">
          {why ??
            (allowed
              ? 'If you have a document that shows a different end date, add it and submit again.'
              : 'There is nothing to change on this claim.')}
        </p>
      </section>
      <ClaimFacts claim={claim} />
    </Screen>
  );
}

/**
 * The shape all four share: what happened, then what it means, then what the
 * screen has to show about it, and the way onward at the foot.
 *
 * The content is its own slot rather than part of the bottom group, so what a
 * screen has to say sits under the sentence that introduced it. Before T57
 * everything below the heading was in the group pinned to the bottom of the
 * frame, so an approved payout and a decline's reasons both appeared at the end
 * of a column of empty canvas.
 */
function Screen({
  actions,
  heading,
  line,
  lines,
  children = null,
}: {
  actions: React.ReactNode;
  heading: string;
  line?: string;
  lines?: readonly string[];
  children?: React.ReactNode;
}) {
  return (
    <AppFrame>
      <main className="flex min-h-frame flex-col gap-8 px-5 py-10">
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
        {children}
        <div className="mt-auto flex flex-col items-center gap-5">{actions}</div>
      </main>
    </AppFrame>
  );
}
