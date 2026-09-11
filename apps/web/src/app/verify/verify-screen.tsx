'use client';

import dynamic from 'next/dynamic';

import { AppFrame } from '../../components/app-frame';
import { PillButton } from '../../components/pill-button';
import { useSurface } from '../../lib/surface';
import { verifyCopy, waitingLine } from '../../lib/worker-model';
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
 * A clone with no World app id in its environment gets the interim issuer
 * instead, and says so in ink-2 the same way the wallet says it is a demo. That
 * state does not imitate the widget: a screen that looks like a Selfie Check
 * and is not one is the one thing it must not be, and it answers in one request
 * without leaving the device, so its button carries its own loading state.
 *
 * "One person, one cover" is a rule, not a failure. Someone who already holds
 * cover in this series is told the rule and sent to the cover they have, rather
 * than offered a retry that would be refused the same way.
 *
 * The check itself is `useWorldCheck`, which T37 lifted out of this file so the
 * landing page could run the same one. This route is unchanged: same states,
 * same copy, same actions, same widget.
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
          {interim ? (
            <p className="text-secondary text-ink-2">
              Interim check. Testnet only. This issues the eligibility credential without running
              a World Selfie Check yet.
            </p>
          ) : null}
        </div>

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
