'use client';

import { useTransition } from 'react';

import { AppFrame } from '../../components/app-frame';
import { PillButton } from '../../components/pill-button';
import { TextLink } from '../../components/text-link';
import { waitingPeriodDays } from '../../lib/claim-model';
import type { PolicyView } from '../../lib/worker-api';
import { beginClaim } from '../claim-actions';

/**
 * C1, Before you start.
 *
 * The plain list of what is covered and what is not, from
 * docs/DESIGN-TOKENS-ADDENDUM.md verbatim, then the primary. DESIGN.md 3.9
 * asks for this list in plain words before the person starts, because the one
 * thing that wastes their time is filling in a claim for something the cover
 * was never going to pay.
 *
 * The waiting period in the second sentence is the cover's own, counted from
 * its start to the first day a separation can qualify, and never a constant.
 */

export function BeforeYouStart({ policy }: { policy: PolicyView }) {
  const [pending, startTransition] = useTransition();
  const days = waitingPeriodDays(policy);

  return (
    <AppFrame>
      <main className="flex min-h-frame flex-col justify-between gap-8 px-5 py-10">
        <div className="flex flex-col gap-6">
          <h1 className="text-title font-display font-semibold tracking-title text-ink">
            Before you start
          </h1>

          <section className="flex flex-col gap-2">
            <h2 className="text-body-lg font-medium text-ink">What cover pays for</h2>
            <p className="text-body text-ink-2">
              Laid off, made redundant, your position eliminated, your workplace closed.
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-body-lg font-medium text-ink">What it doesn&apos;t pay for</h2>
            <p className="text-body text-ink-2">
              Resigning, dismissal for misconduct, the end of a fixed-term contract,
              self-employed work drying up, or losing your job in the first {days} days of cover.
            </p>
          </section>
        </div>

        <div className="flex flex-col items-center gap-5">
          <PillButton
            className="w-full"
            loading={pending}
            onClick={() => startTransition(() => beginClaim(policy.policy_id))}
          >
            Start a claim
          </PillButton>
          <TextLink href="/home">Back to cover</TextLink>
        </div>
      </main>
    </AppFrame>
  );
}
