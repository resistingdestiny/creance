'use client';

import dynamic from 'next/dynamic';
import { useRef, useState, useTransition } from 'react';

import { AppFrame } from '../../../components/app-frame';
import { PillButton } from '../../../components/pill-button';
import { TextLink } from '../../../components/text-link';
import { claimCheckCopy, type ClaimCheckState } from '../../../lib/claim-model';
import { useSurface } from '../../../lib/surface';
import type { WorldRequestContextView } from '../../../lib/worker-api';
import { waitingLine } from '../../../lib/worker-model';
import {
  completeClaimCheck,
  continueToReview,
  startClaimCheck,
  useDemoPresence,
} from '../../claim-actions';
import { ClaimSteps } from '../claim-steps';

/**
 * C4, Confirm it's you. The same layout and the same four states as the
 * purchase Verify screen, with the addendum's copy.
 *
 * The third of the four steps, and the step bar above the heading is what says
 * so. See src/app/claim/claim-steps.tsx. It is the one screen in the flow that
 * leaves the product for another application, so saying that there are two
 * steps left matters more here than anywhere else in it.
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
  const surface = useSurface();
  /** Set when our own verification refused, so onError does not overwrite it. */
  const refused = useRef(false);
  /** One silent retry per attempt on an expired or malformed signature. */
  const retried = useRef(false);
  /**
   * True once the widget has been opened and left without a credential, for
   * any reason at all.
   *
   * It exists because the widget can close without reporting anything: a person
   * who opens it, finds their app cannot finish the check and shuts the sheet
   * leaves `waiting` on screen with a spinner in the button and no way on. That
   * is the dead end this screen must not have, and it is the likeliest one on a
   * deployment whose check cannot be completed on every device. So an abandoned
   * attempt counts as an attempt: the screen goes back to a pressable state and
   * offers the demo check beside it, exactly as a refusal does.
   */
  const [attempted, setAttempted] = useState(false);

  const demoCheck = () => {
    startTransition(async () => {
      const result = await useDemoPresence();
      if (result.ok) {
        setState('verified');
        return;
      }
      setState(result.wrongCheck ? 'wrong-check' : 'failed');
    });
  };

  const openWidget = () => {
    refused.current = false;
    startTransition(async () => {
      const fresh = await startClaimCheck();
      if (fresh === null) {
        setAttempted(true);
        setState('failed');
        return;
      }
      setContext(fresh);
      setState('waiting');
      setOpen(true);
    });
  };

  /**
   * The widget closing. Success and failure have already moved the screen on by
   * the time this runs, so the only case left is the sheet being shut with
   * nothing decided, and that has to leave a pressable button behind.
   */
  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) return;
    setAttempted(true);
    setState((current) => (current === 'waiting' ? 'idle' : current));
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
    setState(answer.wrongCheck ? 'wrong-check' : 'failed');
    throw new Error(answer.error ?? 'the check was refused');
  };

  const onError = (code: string) => {
    setOpen(false);
    setAttempted(true);
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

  const copy = claimCheckCopy(state, surface);
  // Both refusals offer the demo check the same way. A check of a kind this
  // deployment does not accept is the case that needs the fallback most, since
  // the same device answers with the same kind every time. T42. An attempt that
  // was abandoned rather than refused is offered it too: the person shut the
  // sheet because the check could not be finished, which is the same dead end
  // arrived at by a quieter road.
  const refusedCheck =
    state !== 'verified' && (state === 'failed' || state === 'wrong-check' || attempted);

  return (
    <AppFrame>
      <main className="flex min-h-frame flex-col justify-between gap-8 px-5 py-10">
        <div className="flex flex-col gap-6">
          <header className="flex flex-col gap-4">
            <ClaimSteps current={3} />
            <h1 className="text-title font-display font-semibold tracking-title text-ink">
              {copy.heading}
            </h1>
            <p className="text-body-lg text-ink-2">{copy.line}</p>
          </header>
          {state === 'verified' ? (
            <p className="text-body-lg text-ink" data-testid="claim-check-state" role="status">
              You&apos;re verified
            </p>
          ) : null}
          {state === 'waiting' ? (
            <p className="text-body-lg text-ink" data-testid="claim-check-state" role="status">
              {waitingLine(surface)}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col items-center gap-5">
          {/* The honesty line about the demo path belongs beside the control it
              is about, not four blocks above it under the heading. */}
          {demo || refusedCheck ? (
            <p className="text-secondary text-ink-2">
              Demo check. Testnet only. This records a live person check without running a World
              Selfie Check, because a camera cannot be automated.
            </p>
          ) : null}
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
          {!demo && refusedCheck ? (
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
            onOpenChange={onOpenChange}
            handleVerify={handleVerify}
            onSuccess={() => setState('verified')}
            onError={onError}
          />
        )}
      </main>
    </AppFrame>
  );
}
