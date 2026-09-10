'use client';

import dynamicImport from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';

import { AppFrame } from '../../components/app-frame';
import { FormField } from '../../components/form-field';
import { PillButton, PillLink } from '../../components/pill-button';
import { useWorldCheck } from '../verify/use-world-check';
import { openWithCoverKey, signInWithWorld, startSignInCheck } from '../purchase-actions';
import {
  BACK_IN_HEADING,
  BACK_IN_KEY_ACTION,
  BACK_IN_KEY_HINT,
  BACK_IN_KEY_LABEL,
  BACK_IN_LINE,
  BACK_IN_WORLD,
  NO_COVER_ACTION,
  NO_COVER_HEADING,
  NO_COVER_LINE,
} from './home-copy';

/**
 * Getting back into a cover, when this browser holds no session for one.
 *
 * Two ways in and neither is a password, and neither is a fallback for the
 * other. World ID is how you get back in on your own phone; the cover key is
 * how you get back in anywhere. They are given equal weight on the screen for
 * that reason.
 *
 * The World check is `useWorldCheck` with this surface's three server actions
 * rather than the purchase flow's. Nothing about how a proof is made or checked
 * differs: the same signed context, the same preset, the same signal, the same
 * verify endpoint. What is different is that a credential is not issued and the
 * answer is a cover.
 *
 * A check that worked and found no cover is not a failure and does not say one.
 * It is `outcome`, kept here rather than in the hook, because the hook's states
 * are the purchase screen's and none of them means "you are who you say you are
 * and there is nothing here yet".
 *
 * The widget hangs off the bottom of the screen rather than inside the button's
 * own branch, so a re-render while a check is out cannot unmount it. That is
 * the rule T37 wrote down on the landing card.
 */

/** Loaded only where a check runs, so the SDK stays out of every other route. */
const WorldCheck = dynamicImport(() =>
  import('../verify/world-check').then((module) => module.WorldCheck),
);

type Outcome = 'none' | 'no-cover' | 'failed';

/** The hint under the field, named so the input can point at it. */
const HINT_ID = 'cover-key-hint';

export function SignInScreen({
  world,
}: {
  /** This deployment has a World ID app, so the check can be offered at all. */
  world: boolean;
}) {
  const router = useRouter();
  const [outcome, setOutcome] = useState<Outcome>('none');
  const [keyError, setKeyError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const found = useRef(false);

  const check = useWorldCheck({
    interim: false,
    actions: {
      context: startSignInCheck,
      interim: async () => ({ ok: false, error: null, alreadyCovered: false }),
      complete: async (result) => {
        const answer = await signInWithWorld(result);
        found.current = answer.found;
        setOutcome(answer.found ? 'none' : answer.error === null ? 'no-cover' : 'failed');
        // The hook throws on a refusal, which is what stops the widget calling
        // onSuccess, so "found nothing" is reported as a refusal here and said
        // calmly on the screen instead.
        return { ok: answer.found, error: answer.error, alreadyCovered: false };
      },
    },
  });

  const onSuccess = () => {
    check.onSuccess();
    // The cookie was set by the server action, so the dashboard is one render
    // away: refresh rather than push, because this is already /home.
    if (found.current) router.refresh();
  };

  const submitKey = (formData: FormData) => {
    setOutcome('none');
    startTransition(async () => {
      const answer = await openWithCoverKey(formData);
      setKeyError(answer.error);
    });
  };

  const failed = outcome === 'failed' || (outcome === 'none' && check.state === 'failed');

  return (
    <AppFrame>
      <main className="flex min-h-dvh flex-col gap-8 px-5 py-10">
        <header className="flex flex-col gap-2">
          <h1 className="text-title font-display font-semibold tracking-title text-ink">
            {BACK_IN_HEADING}
          </h1>
          <p className="text-body-lg text-ink-2">{BACK_IN_LINE}</p>
        </header>

        {outcome === 'no-cover' ? (
          <div className="flex flex-col gap-3" data-testid="no-cover" role="status">
            <p className="text-body-lg text-ink">{NO_COVER_HEADING}</p>
            <p className="text-body text-ink-2">{NO_COVER_LINE}</p>
            <PillLink href="/" variant="secondary">
              {NO_COVER_ACTION}
            </PillLink>
          </div>
        ) : null}

        {failed ? (
          <p className="text-body text-triggered" role="status">
            We couldn&apos;t verify you. Try again, or use your cover key.
          </p>
        ) : null}

        {world ? (
          <PillButton
            className="w-full"
            loading={check.pending || check.state === 'waiting'}
            onClick={check.start}
          >
            {BACK_IN_WORLD}
          </PillButton>
        ) : null}

        <form action={submitKey} className="flex flex-col gap-4">
          <FormField
            aria-describedby={HINT_ID}
            autoCapitalize="characters"
            autoComplete="off"
            error={keyError ?? undefined}
            label={BACK_IN_KEY_LABEL}
            name="cover_key"
            spellCheck={false}
          />
          <p className="text-secondary text-ink-2" id={HINT_ID}>
            {BACK_IN_KEY_HINT}
          </p>
          <PillButton className="w-full" loading={pending} type="submit" variant="secondary">
            {BACK_IN_KEY_ACTION}
          </PillButton>
        </form>

        {check.context === null ? null : (
          <WorldCheck
            context={check.context}
            open={check.open}
            onOpenChange={check.setOpen}
            handleVerify={check.handleVerify}
            onSuccess={onSuccess}
            onError={check.onError}
          />
        )}
      </main>
    </AppFrame>
  );
}
