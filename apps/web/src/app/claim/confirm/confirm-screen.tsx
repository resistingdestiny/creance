'use client';

import dynamic from 'next/dynamic';
import { useRef, useState, useTransition } from 'react';

import { AppFrame } from '../../../components/app-frame';
import { PillButton } from '../../../components/pill-button';
import { TextLink } from '../../../components/text-link';
import { claimCheckCopy, type ClaimCheckState } from '../../../lib/claim-model';
import type { WorldRequestContextView } from '../../../lib/worker-api';
import {
  completeClaimCheck,
  continueToReview,
  startClaimCheck,
  useDemoPresence,
} from '../../claim-actions';

/**
 * C4, Confirm it's you. The same layout and the same four states as the
 * purchase Verify screen, with the addendum's copy.
 *
 * The check is the second key of DESIGN.md 3.9: a live person bought the cover
 * and the same live person has to show the loss. It runs with
 * `require_user_presence` on the claim action, which comes back inside the
 * context the API signs, so this screen holds no World configuration of its
 * own.
 *
 * The demo path does not imitate the widget. A camera cannot be automated and
 * the Sandbox App has no Selfie Check (docs/FEEDBACK-WORLD.md section 3), so a
 * host with no World app mints a credential that says on its face that no
 * camera ran, and the screen says so in ink-2 the way the purchase screen does.
 *
 * It is offered a second time after a failed check, on a deployment that does
 * have a World app. That is the state the Sandbox App leaves a claim in today:
 * the widget opens, the Selfie Check cannot be completed, and without a way
 * through, a demo on the real app id could never reach a payout. The offer is
 * labelled and it is the person's choice, so nothing is quietly downgraded.
 */

/** Loaded only where a check runs, so the SDK stays out of every other route. */
const WorldCheck = dynamic(() =>
  import('../../verify/world-check').then((module) => module.WorldCheck),
);

/** Codes that mean the person chose to stop. No error, just the button back. */
const CANCELLED = new Set(['user_rejected', 'verification_rejected']);

/** Codes cured by a fresh signature. Retried once, silently. */
const STALE = new Set(['invalid_rp_signature', 'malformed_request']);

export function ConfirmScreen({
  demo,
  alreadyVerified,
}: {
  demo: boolean;
  alreadyVerified: boolean;
}) {
  const [state, setState] = useState<ClaimCheckState>(alreadyVerified ? 'verified' : 'idle');
  const [context, setContext] = useState<WorldRequestContextView | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  /** Set when our own verification refused, so onError does not overwrite it. */
  const refused = useRef(false);
  /** One silent retry per attempt on an expired or malformed signature. */
  const retried = useRef(false);

  const demoCheck = () => {
    startTransition(async () => {
      const result = await useDemoPresence();
      setState(result.ok ? 'verified' : 'failed');
    });
  };

  const openWidget = () => {
    refused.current = false;
    startTransition(async () => {
      const fresh = await startClaimCheck();
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
    if (demo) demoCheck();
    else openWidget();
  };

  // Throwing here is deliberate. The widget turns it into `failed_by_host_app`
  // and never calls onSuccess, so the success state is gated on the API.
  const handleVerify = async (result: unknown) => {
    const answer = await completeClaimCheck(result);
    if (answer.ok) return;
    refused.current = true;
    setState('failed');
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

  const copy = claimCheckCopy(state);

  return (
    <AppFrame>
      <main className="flex min-h-dvh flex-col justify-between px-5 py-10">
        <div className="flex flex-col gap-4">
          <h1 className="text-title font-display font-semibold tracking-title text-ink">
            {copy.heading}
          </h1>
          <p className="text-body-lg text-ink-2">{copy.line}</p>
          {state === 'verified' ? (
            <p className="text-body-lg text-ink" data-testid="claim-check-state" role="status">
              You&apos;re verified
            </p>
          ) : null}
          {state === 'waiting' ? (
            <p className="text-body-lg text-ink" data-testid="claim-check-state" role="status">
              Waiting for the World app
            </p>
          ) : null}
          {demo || state === 'failed' ? (
            <p className="text-secondary text-ink-2">
              Demo check. Testnet only. This records a live person check without running a World
              Selfie Check, because a camera cannot be automated.
            </p>
          ) : null}
        </div>

        <div className="flex flex-col items-center gap-5">
          {state === 'verified' ? (
            <form action={continueToReview} className="w-full">
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
          {!demo && state === 'failed' ? (
            <PillButton className="w-full" onClick={demoCheck} variant="secondary">
              Use the demo check
            </PillButton>
          ) : null}
          <TextLink href="/claim/proof">Back</TextLink>
        </div>

        {context === null || demo ? null : (
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
