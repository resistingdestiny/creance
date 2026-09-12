'use client';

import { useRef, useState, useTransition } from 'react';

import type { WorldRequestContextView } from '../../lib/worker-api';
import type { VerifyResult, VerifyState } from '../../lib/worker-model';
import { completeWorldCheck, startWorldCheck, verifyPerson } from '../purchase-actions';

/**
 * The check itself, as a hook, so the same one runs on the route and on the
 * landing card.
 *
 * It is the state machine that was written into VerifyScreen in T11, lifted out
 * of it unchanged in T37 and not otherwise touched: the same fresh signed
 * context per opening, the same handleVerify that throws so failure never
 * reaches onSuccess, the same two sets of error codes, the same interim branch
 * for a clone with no World app id. Nothing about the request, the preset, the
 * signal or the verify path is decided here or anywhere below here; all of it
 * is the API's, through the three server actions.
 *
 * It is a hook rather than a component because the widget it drives cannot live
 * where the button lives. On the landing page the button is on a face of a card
 * that rotates, and a widget mounted inside that face is unmounted by a turn
 * while a check is still out. The state sits above both, the button reads it and
 * the widget hangs off the page beside the card.
 *
 * T41 is the third surface: signing in to a dashboard runs the same check for a
 * different reason, and what it earns is a way back into a cover rather than a
 * credential. So the three server actions are a parameter with the purchase
 * flow's as the default. Nothing about the request, the preset, the signal or
 * the verify path moved.
 *
 * The demo check is here for the same reason everything else is: the purchase
 * asks for a check on two surfaces and they have to behave identically. The
 * widget can be opened and left with nothing decided, and on a deployment whose
 * Selfie Check cannot be completed on every device that is not a rare case but
 * the ordinary one. So an abandoned attempt counts as an attempt: the screen
 * goes back to a pressable state and the labelled demo check is offered beside
 * it, exactly as a refusal does. Neither surface may make it the primary, and
 * both say on screen what it is. The claim flow's C4 screen wrote this pattern
 * and this is the same pattern, shared rather than written twice.
 */

/**
 * The three server actions one surface's check is made of: the signed context,
 * the completed result, and the labelled demo check.
 */
export interface WorldCheckActions {
  readonly context: () => Promise<WorldRequestContextView | null>;
  readonly complete: (result: unknown) => Promise<VerifyResult>;
  /**
   * The demo issuer, which is the whole of the check on a deployment with no
   * World app and the way out of a refused one on a deployment that has one.
   */
  readonly interim: () => Promise<VerifyResult>;
}

const PURCHASE: WorldCheckActions = {
  context: startWorldCheck,
  complete: completeWorldCheck,
  interim: verifyPerson,
};

/** Codes that mean the person chose to stop. No error, just the button back. */
export const CANCELLED = new Set(['user_rejected', 'verification_rejected']);

/** Codes cured by a fresh signature. Retried once, silently. */
export const STALE = new Set(['invalid_rp_signature', 'malformed_request']);

export interface WorldCheckRun {
  readonly state: VerifyState;
  /** The signed context for the request in hand, or null before the first one. */
  readonly context: WorldRequestContextView | null;
  readonly open: boolean;
  readonly setOpen: (open: boolean) => void;
  /** True while a context is being signed or the interim issuer is answering. */
  readonly pending: boolean;
  /** The button. Opens the widget, or runs the demo check where that is all there is. */
  readonly start: () => void;
  /** The secondary button, where one is offered: the labelled demo check. */
  readonly demoCheck: () => void;
  /**
   * A real check has been opened and has not come back with a credential, so
   * the demo check and its honesty line belong on screen. True for a refusal,
   * for a check of a kind this deployment does not accept, and for a sheet shut
   * with nothing decided, which is what a device that cannot finish the Selfie
   * Check leaves behind. False once somebody is verified, and false when they
   * already hold cover, because that is a rule rather than a failed check and
   * no second check of any kind would get past it.
   */
  readonly refusedCheck: boolean;
  /**
   * Whether the screen has to say the demo check is what is happening, or what
   * happened.
   *
   * True wherever the demo check is on offer, and true afterwards for anybody
   * who took it. The claim flow drops its own line the moment the check passes;
   * this one keeps it, because the sentence after a demo check has run is the
   * one that matters most. "You're verified" over a Continue button is where a
   * person decides what they were verified by, and they are one press from
   * paying for cover on the strength of it. The credential says which issuer
   * minted it and so do the receipt and the audit trail; the screen should not
   * be the only place that goes quiet about it.
   */
  readonly demoLine: boolean;
  readonly handleVerify: (result: unknown) => Promise<void>;
  readonly onSuccess: () => void;
  readonly onError: (code: string) => void;
  /**
   * Back to before the check ran. T43 drops the eligibility credential when the
   * wallet changes, because a check binds to the wallet it was run for, so a
   * card still showing "You're verified" would be offering a credential the
   * server no longer holds.
   */
  readonly reset: () => void;
}

/** Which failure the API described. Three answers, one state each. */
function refusedState(answer: VerifyResult): VerifyState {
  if (answer.alreadyCovered) return 'covered';
  return answer.wrongCheck ? 'wrong-check' : 'failed';
}

export function useWorldCheck({
  interim,
  alreadyVerified = false,
  actions = PURCHASE,
}: {
  /** No World app id in this deployment, so the interim issuer answers instead. */
  interim: boolean;
  /** The session already holds a credential, so the check is behind them. */
  alreadyVerified?: boolean;
  /** Whose check this is. The purchase flow's unless a surface says otherwise. */
  actions?: WorldCheckActions;
}): WorldCheckRun {
  const [state, setState] = useState<VerifyState>(alreadyVerified ? 'verified' : 'idle');
  const [context, setContext] = useState<WorldRequestContextView | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  /** Set when our own verification refused, so onError does not overwrite it. */
  const refused = useRef(false);
  /** One silent retry per attempt on an expired or malformed signature. */
  const retried = useRef(false);
  /**
   * True once the widget has been opened and left without a credential, for any
   * reason at all, including no reason being reported.
   *
   * The widget can close without saying anything: somebody opens it, finds the
   * check cannot be finished on their device and shuts the sheet. Without this
   * the screen sat on `waiting` with a spinner in the button and nothing to
   * press, which is the dead end the purchase must not have and the likeliest
   * one wherever the Selfie Check cannot be completed.
   */
  const [attempted, setAttempted] = useState(false);
  /** The credential this session holds came from the demo check. */
  const [demoUsed, setDemoUsed] = useState(false);

  const demoCheck = () => {
    startTransition(async () => {
      const result = await actions.interim();
      setDemoUsed(result.ok);
      setState(result.ok ? 'verified' : refusedState(result));
    });
  };

  const openWidget = () => {
    refused.current = false;
    startTransition(async () => {
      const fresh = await actions.context();
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

  const start = () => {
    retried.current = false;
    if (interim) demoCheck();
    else openWidget();
  };

  // Throwing here is deliberate. The widget turns it into `failed_by_host_app`
  // and never calls onSuccess, so the success state is gated on the API.
  const handleVerify = async (result: unknown) => {
    const answer = await actions.complete(result);
    if (answer.ok) return;
    refused.current = true;
    setState(refusedState(answer));
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

  /**
   * The widget closing.
   *
   * Success and failure have both moved the state on before this runs, so the
   * only case left is the sheet being shut with nothing decided: somebody
   * opened it, found their app could not finish the check, and closed it. The
   * widget reports no code for that, so handing `setOpen` straight to it left
   * the screen on `waiting` with a spinner in the button and no way forward.
   * Closing has to give the button back.
   */
  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) return;
    setAttempted(true);
    setState((current) => (current === 'waiting' ? 'idle' : current));
  };

  const refusedCheck =
    state !== 'verified' &&
    state !== 'covered' &&
    (state === 'failed' || state === 'wrong-check' || attempted);

  return {
    state,
    context,
    open,
    setOpen: onOpenChange,
    pending,
    start,
    demoCheck,
    // Both refusals offer the demo check the same way. A check of a kind this
    // deployment does not accept is the case that needs it most, since the same
    // device answers with the same kind every time; an attempt abandoned rather
    // than refused is the same dead end reached by a quieter road.
    refusedCheck,
    demoLine: interim || refusedCheck || demoUsed,
    handleVerify,
    onSuccess: () => setState('verified'),
    onError,
    reset: () => {
      refused.current = false;
      retried.current = false;
      setAttempted(false);
      setDemoUsed(false);
      setOpen(false);
      setState('idle');
    },
  };
}
