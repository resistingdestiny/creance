'use client';

import type { ReactNode } from 'react';

import type { LandingEvent } from '../../lib/landing-model';
import { useQuote } from './quote-state';

/**
 * The ring of real events around the hero card (T54), and one chip in it.
 *
 * Every chip is something that happened, built in src/lib/landing-model.ts
 * from a record the page already reads: a coupon that settled, an occupation's
 * newest reading, a month the oracle published. A chip with no event behind it
 * is not drawn dim or empty; it is not drawn. The page therefore rings the
 * card with as many true things as it has, and no more.
 *
 * Depth without a shadow. The addendum permits one elevation and the hero card
 * spends it, so the chips cannot be shadowed the way a Flighty card is. Near
 * chips are the addendum's raised ground, night-2, with a white border at
 * sixteen percent and their text at full opacity; far chips are the same
 * surface at lower opacity, with a fainter border and dimmer text, which is
 * what makes the field read as deep rather than as five boxes. Recorded in
 * docs/DECISIONS.md under T54.
 *
 * Where they stand is the caller's: from the landing breakpoint each chip is
 * placed absolutely around the card by a slot class, and below it they are in
 * flow under the card, because a 350px column has no room to ring anything and
 * a chip over the card there would cover its own numbers. Far chips are not
 * drawn at all below the landing breakpoint, so the phone gets the two nearest
 * true things and a shorter page.
 *
 * The ring fades while a quote is open. The card turns to carry each step and
 * the World widget opens beside it, and a chip over a search field or under a
 * dialog is noise; it is opacity and pointer-events, so the chips are still
 * in the markup and come back the moment the quote closes.
 *
 * Nothing here animates in. The chips are in place on the first paint and
 * arrive with their figure when the page streams, which is also how a still
 * frame and a reduced motion reader see them.
 *
 * Every chip is an anchor, so the base layer's outline is its focus state and
 * a keyboard reaches it. A chip about a reading points at the explorer on
 * this page and opens it on that occupation, which is the one act the quote
 * already treats picking and reading as; a chip about a settlement points at
 * HashScan.
 */
export function EventRing({ children }: { children: ReactNode }) {
  const { step } = useQuote();
  const faded = step !== 'closed';
  return (
    <div
      aria-hidden={faded ? 'true' : undefined}
      className={[
        'mt-6 flex flex-wrap justify-center gap-3 transition-opacity duration-200 ease-out motion-reduce:transition-none lg:pointer-events-none lg:absolute lg:inset-0 lg:mt-0 lg:block',
        faded ? 'pointer-events-none opacity-0' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-testid="landing-events"
    >
      {children}
    </div>
  );
}

export type EventDepth = 'near' | 'far';

/** The surface, the border and the text, by distance from the card. */
const DEPTH: Record<EventDepth, string> = {
  near: 'border-white/16 bg-night-2 hover:border-white/32',
  far: 'hidden border-white/8 bg-night-2/70 lg:flex lg:opacity-60 lg:hover:opacity-100',
};

export function EventChip({
  event,
  depth,
  className,
}: {
  event: LandingEvent;
  depth: EventDepth;
  /** The slot: where the chip stands around the card from the landing breakpoint. */
  className?: string;
}) {
  const { choose } = useQuote();
  const { group } = event;
  const external = /^https?:/.test(event.href);
  return (
    <a
      className={[
        'pointer-events-auto flex flex-col gap-0.5 rounded-group border px-4 py-3 text-left text-secondary no-underline transition-[border-color,opacity] duration-200 ease-out motion-reduce:transition-none max-w-full lg:absolute lg:w-max lg:max-w-[300px]',
        DEPTH[depth],
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      data-depth={depth}
      data-testid="landing-event"
      href={event.href}
      onClick={group === null ? undefined : () => choose(group)}
      rel={external ? 'noreferrer' : undefined}
      target={external ? '_blank' : undefined}
    >
      <span className="font-medium text-white">{event.title}</span>
      <span className="text-white/66">{event.detail}</span>
    </a>
  );
}
