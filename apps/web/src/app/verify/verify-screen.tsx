'use client';

import dynamic from 'next/dynamic';
import { useRef, useState, useTransition } from 'react';

import { AppFrame } from '../../components/app-frame';
import { PillButton } from '../../components/pill-button';
import { useSurface } from '../../lib/surface';
import type { WorldRequestContextView } from '../../lib/worker-api';
import { verifyCopy, waitingLine, type VerifyState } from '../../lib/worker-model';
import {
  completeWorldCheck,
  continueToPay,
  goToCover,
  startWorldCheck,
  verifyPerson,
} from '../purchase-actions';

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
 */

/** Loaded only where a check runs, so the SDK stays out of every other route. */
const WorldCheck = dynamic(() => import('./world-check').then((module) => module.WorldCheck));

/** Codes that mean the person chose to stop. No error, just the button back. */
const CANCELLED = new Set(['user_rejected', 'verification_rejected']);

/** Codes cured by a fresh signature. Retried once, silently. */
const STALE = new Set(['invalid_rp_signature', 'malformed_request']);

export function VerifyScreen({
  interim,
  alreadyVerified,
}: {
  interim: boolean;
  alreadyVerified: boolean;
}) {
  const [state, setState] = useState<VerifyState>(alreadyVerified ? 'verified' : 'idle');
  const [context, setContext] = useState<WorldRequestContextView | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const surface = useSurface();
  /** Set when our own verification refused, so onError does not overwrite it. */
  const refused = useRef(false);
  /** One silent retry per attempt on an expired or malformed signature. */
  const retried = useRef(false);

  const interimCheck = () => {
    startTransition(async () => {
      const result = await verifyPerson();
      setState(result.ok ? 'verified' : 'failed');
    });
  };

  const openWidget = () => {
    refused.current = false;
    startTransition(async () => {
      const fresh = await startWorldCheck();
      if (fresh === null) {
        setState('failed');
        return;
      }
      setContext(fresh);
      setState('waiting');
      setOpen(true);
    });
  };

  const start = () => {
    retried.current = false;
    if (interim) interimCheck();
    else openWidget();
  };

  // Throwing here is deliberate. The widget turns it into `failed_by_host_app`
  // and never calls onSuccess, so the success state is gated on the API.
  const handleVerify = async (result: unknown) => {
    const answer = await completeWorldCheck(result);
    if (answer.ok) return;
    refused.current = true;
    setState(answer.alreadyCovered ? 'covered' : 'failed');
    throw new Error(answer.error ?? 'the check was refused');
  };

  const onError = (code: string) => {
    setOpen(false);
    if (refused.current) return;
    if (CANCELLED.has(code)) {
      setState('idle');
      return;
    }
    if (STALE.has(code) && !retried.current) {
      retried.current = true;
      openWidget();
      return;
    }
    setState('failed');
  };

  const copy = verifyCopy(state, surface);

  return (
    <AppFrame>
      <main className="flex min-h-dvh flex-col justify-between px-5 py-10">
        <div className="flex flex-col gap-4">
          <h1 className="text-title font-display font-semibold tracking-title text-ink">
            {copy.heading}
          </h1>
          <p className="text-body-lg text-ink-2">{copy.line}</p>
          {state === 'verified' ? (
            <p className="text-body-lg text-ink" data-testid="verify-state" role="status">
              You&apos;re verified
            </p>
          ) : null}
          {state === 'waiting' ? (
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

        {state === 'verified' ? (
          <form action={continueToPay}>
            <PillButton className="w-full" type="submit">
              {copy.button}
            </PillButton>
          </form>
        ) : state === 'covered' ? (
          <form action={goToCover}>
            <PillButton className="w-full" type="submit">
              {copy.button}
            </PillButton>
          </form>
        ) : (
          <PillButton
            className="w-full"
            loading={pending || state === 'waiting'}
            onClick={start}
          >
            {copy.button}
          </PillButton>
        )}

        {context === null || interim ? null : (
          <WorldCheck
            context={context}
            open={open}
            onOpenChange={setOpen}
            handleVerify={handleVerify}
            onSuccess={() => setState('verified')}
            onError={onError}
          />
        )}
      </main>
    </AppFrame>
  );
}
