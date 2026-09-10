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
 */

/**
 * The three server actions one surface's check is made of: the signed context,
 * the completed result, and the interim check for a clone with no World app.
 */
export interface WorldCheckActions {
  readonly context: () => Promise<WorldRequestContextView | null>;
  readonly complete: (result: unknown) => Promise<VerifyResult>;
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
  /** The button. Opens the widget, or runs the interim check. */
  readonly start: () => void;
  readonly handleVerify: (result: unknown) => Promise<void>;
  readonly onSuccess: () => void;
  readonly onError: (code: string) => void;
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

  const interimCheck = () => {
    startTransition(async () => {
      const result = await actions.interim();
      setState(result.ok ? 'verified' : 'failed');
    });
  };

  const openWidget = () => {
    refused.current = false;
    startTransition(async () => {
      const fresh = await actions.context();
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
    const answer = await actions.complete(result);
    if (answer.ok) return;
    refused.current = true;
    setState(refusedState(answer));
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

  return {
    state,
    context,
    open,
    setOpen,
    pending,
    start,
    handleVerify,
    onSuccess: () => setState('verified'),
    onError,
  };
}
