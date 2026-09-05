'use client';

import { useEffect } from 'react';

import { AppFrame } from '../../components/app-frame';
import { CoverCard } from '../../components/cover-card';
import { DisplayNumber } from '../../components/display-number';
import { ListRow } from '../../components/list-row';
import { SurfaceGroup } from '../../components/surface-group';
import { TextLink } from '../../components/text-link';
import { CoverTabs } from '../cover-tabs';

/**
 * Home: the card, the next payment, the index row and the way to the index.
 *
 * The one orchestrated moment in the design happens here, once, after a payment
 * confirms: the card slides up over 420ms ease-out while the amount counts up
 * over 600ms (docs/DESIGN-TOKENS.md section 6). Under prefers-reduced-motion
 * both are replaced by an instant state change. The slide is a CSS animation
 * turned off by `motion-reduce:animate-none`, so the card is simply in place on
 * the first paint rather than being moved there by a script; the count-up is
 * skipped inside DisplayNumber, which is the one piece of motion CSS cannot
 * switch off.
 *
 * It runs on arriving from the Pay sheet and never again. The query that says
 * so is dropped from the address as soon as it has been read, so a reload is a
 * plain Home rather than a second performance.
 */

export function HomeScreen({
  occupation,
  cover,
  nextPayment,
  indexValue,
  indexCaption,
  bound,
}: {
  occupation: string;
  cover: number;
  nextPayment: string;
  indexValue: string | null;
  indexCaption: string | null;
  bound: boolean;
}) {
  useEffect(() => {
    if (bound) window.history.replaceState(null, '', '/home');
  }, [bound]);

  return (
    <AppFrame>
      <div className="flex min-h-dvh flex-col">
        <main className="flex flex-1 flex-col gap-6 px-5 py-10">
          <h1 className="text-title font-display font-semibold tracking-title text-ink">Cover</h1>

          <div
            className={bound ? 'cover-card-enter motion-reduce:animate-none' : undefined}
            data-testid="home-card"
          >
            <CoverCard
              amount={<DisplayNumber countUp={bound} size="display-l" value={cover} />}
              occupation={occupation}
              state="covered"
              statusLabel="Covered"
            />
          </div>

          <SurfaceGroup>
            <ListRow label="Next payment" value={nextPayment} />
            {indexValue === null ? null : (
              <ListRow caption={indexCaption} label="Index" value={indexValue} />
            )}
          </SurfaceGroup>

          <TextLink href="/cover/index">See the index</TextLink>
        </main>
        <CoverTabs active="cover" />
      </div>
    </AppFrame>
  );
}
