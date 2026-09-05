'use client';

import { useState, useTransition } from 'react';

import { AppFrame } from '../../components/app-frame';
import { PillButton } from '../../components/pill-button';
import { continueToPay, verifyPerson } from '../purchase-actions';

/**
 * The four states docs/DESIGN-TOKENS.md section 8 gives this screen, with the
 * copy verbatim.
 *
 * What runs behind it today is the API's interim eligibility issuer and not a
 * World Selfie Check, and the screen says so in ink-2 the same way the wallet
 * says it is a demo. It does not imitate the IDKit widget: a screen that looks
 * like a Selfie Check and is not one is the one thing this state must not be.
 *
 * "Waiting for the World app" belongs to the state where the check has left for
 * another application. The interim issuer answers in one request and never
 * leaves this device, so the button carries its own loading state instead and
 * T11 restores the wait. See docs/DECISIONS.md.
 */

type VerifyState = 'idle' | 'verified' | 'failed';

export function VerifyScreen({
  interim,
  alreadyVerified,
}: {
  interim: boolean;
  alreadyVerified: boolean;
}) {
  const [state, setState] = useState<VerifyState>(alreadyVerified ? 'verified' : 'idle');
  const [pending, startTransition] = useTransition();

  const check = () => {
    startTransition(async () => {
      const result = await verifyPerson();
      setState(result.ok ? 'verified' : 'failed');
    });
  };

  return (
    <AppFrame>
      <main className="flex min-h-dvh flex-col justify-between px-5 py-10">
        <div className="flex flex-col gap-4">
          <h1 className="text-title font-display font-semibold tracking-title text-ink">
            {state === 'failed' ? "We couldn't verify you." : "Confirm you're a real person."}
          </h1>
          <p className="text-body-lg text-ink-2">
            {state === 'failed'
              ? 'Try again, or use a different device.'
              : 'One person, one cover. This stops bots and duplicate accounts.'}
          </p>
          {state === 'verified' ? (
            <p className="text-body-lg text-ink" data-testid="verify-state" role="status">
              You&apos;re verified
            </p>
          ) : null}
          {interim ? (
            <p className="text-secondary text-ink-2">
              Interim check. Testnet only. This issues the eligibility credential without running
              a World Selfie Check yet.
            </p>
          ) : null}
        </div>

        {state === 'verified' ? (
          <form action={continueToPay}>
            <PillButton className="w-full" type="submit">
              Continue
            </PillButton>
          </form>
        ) : (
          <PillButton className="w-full" loading={pending} onClick={check}>
            {state === 'failed' ? 'Try again' : 'Verify with World ID'}
          </PillButton>
        )}
      </main>
    </AppFrame>
  );
}
