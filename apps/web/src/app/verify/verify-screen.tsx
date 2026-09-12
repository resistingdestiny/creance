'use client';

import dynamic from 'next/dynamic';

import { AppFrame } from '../../components/app-frame';
import { PillButton } from '../../components/pill-button';
import { useSurface } from '../../lib/surface';
import {
  DEMO_CHECK_ACTION,
  DEMO_CHECK_LINE,
  verifyCopy,
  waitingLine,
} from '../../lib/worker-model';
import { continueToPay, goToCover } from '../purchase-actions';
import { useWorldCheck } from './use-world-check';

/**
 * The states docs/DESIGN-TOKENS.md section 8 gives this screen, with the copy
 * verbatim.
 *
 * Behind it is the World Selfie Check: the button fetches a signed request
 * context from the API, the widget hands the check to the World app, and the
 * completed result goes back to the API, which forwards it to World and answers
 * with the eligibility credential. "Waiting for the World app" is the state
 * while the check is away on another device, which is the state that string was
 * written for.
 *
 * Inside World App the same widget runs over the native transport and shows no
 * QR code, so nothing about the request or the verify changes and only the copy
 * does: the check is not away anywhere and there is no second device to offer.
 * The surface comes from the MiniKit provider in src/app/providers.tsx.
 *
 * A clone with no World app id in its environment gets the demo issuer instead,
 * and says so in ink-2 the same way the wallet says it is a demo. That state
 * does not imitate the widget: a screen that looks like a Selfie Check and is
 * not one is the one thing it must not be, and it answers in one request
 * without leaving the device, so its button carries its own loading state.
 *
 * The same path is offered a second time, on a deployment that does have a
 * World app, once a real check has been opened and has not come back with
 * anything. Without it this screen is where a purchase stops: the widget opens,
 * the Selfie Check cannot be completed on the device in hand, and there is
 * nothing on screen but the same button that has just failed. The offer is
 * secondary, it appears only after a real attempt, it is labelled in the same
 * words the claim flow labels its own, and choosing it is the person's. Nothing
 * is quietly downgraded and nothing downstream changes: the credential carries
 * which issuer minted it, so the receipt and the audit trail go on saying which
 * check was used.
 *
 * "One person, one cover" is a rule, not a failure. Someone who already holds
 * cover in this series is told the rule and sent to the cover they have, rather
 * than offered a retry that would be refused the same way, and no second check
 * of any kind is offered beside it.
 *
 * The check itself is `useWorldCheck`, which T37 lifted out of this file so the
 * landing page could run the same one, and which now holds the demo offer too
 * so that the route and the card cannot come to behave differently at the same
 * step. This route is unchanged otherwise: same states, same copy, same
 * actions, same widget.
 */

/** Loaded only where a check runs, so the SDK stays out of every other route. */
const WorldCheck = dynamic(() => import('./world-check').then((module) => module.WorldCheck));

export function VerifyScreen({
  interim,
  alreadyVerified,
}: {
  interim: boolean;
  alreadyVerified: boolean;
}) {
  const check = useWorldCheck({ alreadyVerified, interim });
  const surface = useSurface();
  const copy = verifyCopy(check.state, surface);

  return (
    <AppFrame>
      <main className="flex min-h-frame flex-col justify-between px-5 py-10">
        <div className="flex flex-col gap-4">
          <h1 className="text-title font-display font-semibold tracking-title text-ink">
            {copy.heading}
          </h1>
          <p className="text-body-lg text-ink-2">{copy.line}</p>
          {check.state === 'verified' ? (
            <p className="text-body-lg text-ink" data-testid="verify-state" role="status">
              You&apos;re verified
            </p>
          ) : null}
          {check.state === 'waiting' ? (
            <p className="text-body-lg text-ink" data-testid="verify-state" role="status">
              {waitingLine(surface)}
            </p>
          ) : null}
        </div>

        {/* The honesty line about the demo path belongs beside the control it
            is about, not four blocks above it under the heading. */}
        <div className="flex flex-col gap-5">
          {check.demoLine ? <p className="text-secondary text-ink-2">{DEMO_CHECK_LINE}</p> : null}
          {check.state === 'verified' ? (
            <form action={continueToPay}>
              <PillButton className="w-full" type="submit">
                {copy.button}
              </PillButton>
            </form>
          ) : check.state === 'covered' ? (
            <form action={goToCover}>
              <PillButton className="w-full" type="submit">
                {copy.button}
              </PillButton>
            </form>
          ) : (
            <PillButton
              className="w-full"
              loading={check.pending || check.state === 'waiting'}
              onClick={check.start}
            >
              {copy.button}
            </PillButton>
          )}
          {!interim && check.refusedCheck ? (
            <PillButton className="w-full" onClick={check.demoCheck} variant="secondary">
              {DEMO_CHECK_ACTION}
            </PillButton>
          ) : null}
        </div>

        {check.context === null || interim ? null : (
          <WorldCheck
            context={check.context}
            open={check.open}
            onOpenChange={check.setOpen}
            handleVerify={check.handleVerify}
            onSuccess={check.onSuccess}
            onError={check.onError}
          />
        )}
      </main>
    </AppFrame>
  );
}
