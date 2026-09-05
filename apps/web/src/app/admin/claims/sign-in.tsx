'use client';

import { useState, useTransition } from 'react';

import { DesktopFrame } from '../../../components/desktop-frame';
import { FormField } from '../../../components/form-field';
import { PillButton } from '../../../components/pill-button';
import { signIn } from './actions';

/**
 * The one screen in front of the review queue.
 *
 * A reviewer types the deployment's admin token once. The web server compares
 * it in constant time and gives the browser an opaque session id in an httpOnly
 * cookie; the token never comes back. Everything behind this screen reads
 * claimants' employers, job titles and separation dates, and its two buttons
 * move settlement funds, so it is not a screen a stranger should be served.
 *
 * A wrong token says only that it was wrong. Which of the two things was wrong,
 * whether a token of that length exists, and how long the right one is are all
 * things this screen has no reason to say.
 */

export function ReviewerSignIn() {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (form: FormData) => {
    setError(null);
    startTransition(async () => {
      const result = await signIn(form);
      if (!result.ok) setError(result.message);
    });
  };

  return (
    <DesktopFrame>
      <form action={submit} className="flex max-w-[420px] flex-col gap-6">
        <h1 className="text-title font-display font-semibold tracking-title text-ink">
          Review queue
        </h1>
        <p className="text-body text-ink-2">
          This screen carries claimants&apos; details and decides their claims. Enter the
          reviewer token to open it.
        </p>
        <FormField
          autoComplete="off"
          label="Reviewer token"
          name="token"
          required
          type="password"
        />
        {error === null ? null : (
          <p className="text-secondary text-triggered" role="status">
            {error}
          </p>
        )}
        <PillButton loading={pending} type="submit">
          Open the queue
        </PillButton>
      </form>
    </DesktopFrame>
  );
}
