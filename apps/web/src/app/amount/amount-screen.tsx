'use client';

import { useEffect, useRef, useState, useTransition } from 'react';

import { AmountSlider } from '../../components/amount-slider';
import { AppFrame } from '../../components/app-frame';
import { PillButton } from '../../components/pill-button';
import { TextLink } from '../../components/text-link';
import { continueToVerify, priceCover, type PriceResult } from '../purchase-actions';

/**
 * "Cover amount", "{premium} a month" and the sentence that says when it pays,
 * docs/DESIGN-TOKENS.md section 8, with the group, the attachment and the
 * exhaustion interpolated as its engineering note requires.
 *
 * The price is re-quoted 250ms after the slider settles. While the new price
 * loads the previous one stays on screen in ink-3 rather than being replaced by
 * a skeleton: a figure that disappears every time the thumb moves is the worst
 * version of this screen, and the height never changes either way.
 */

const DEBOUNCE_MS = 250;

export function AmountScreen({
  initial,
  limit: initialLimit,
  occupation,
}: {
  initial: PriceResult;
  limit: number;
  occupation: string;
}) {
  const [limit, setLimit] = useState(initialLimit);
  const [price, setPrice] = useState(initial);
  const [pending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      startTransition(async () => {
        setPrice(await priceCover(limit));
      });
    }, DEBOUNCE_MS);
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, [limit]);

  const stale = pending;

  return (
    <AppFrame>
      <main className="flex min-h-dvh flex-col gap-8 px-5 py-10">
        <div className="flex flex-col gap-2">
          <h1 className="text-title font-display font-semibold tracking-title text-ink">
            Cover amount
          </h1>
          <p className="text-secondary text-ink-2">{occupation}</p>
        </div>

        <p
          aria-live="polite"
          className={[
            'min-h-[60px] text-display-l font-display font-semibold tracking-display tabular-nums',
            stale ? 'text-ink-3' : 'text-ink',
          ].join(' ')}
          data-testid="amount-premium"
        >
          {price.premium === '' ? '' : `${price.premium} a month`}
        </p>

        <AmountSlider onChange={setLimit} value={limit} />

        <p className="text-secondary text-ink-2">{price.sentence}</p>

        {price.error === null ? null : (
          <p className="text-secondary text-triggered" role="status">
            {price.error}
          </p>
        )}

        <div className="mt-auto flex flex-col items-start gap-3">
          <TextLink href="/cover/index">How the index works</TextLink>
          <form action={continueToVerify} className="w-full">
            <PillButton
              className="w-full"
              disabled={price.error !== null || price.premium === ''}
              loading={pending}
              type="submit"
            >
              Continue
            </PillButton>
          </form>
        </div>
      </main>
    </AppFrame>
  );
}
