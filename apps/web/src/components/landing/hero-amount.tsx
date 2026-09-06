'use client';

import { useEffect, useState } from 'react';

import { formatAmount } from '../../lib/format';
import { useReducedMotion } from '../../lib/use-reduced-motion';

/**
 * The cover amount on the hero card, counted up once on load.
 *
 * Animation is enhancement and never the source of truth, so this starts at the
 * true value rather than at zero. The server renders the figure, the first
 * client render renders the same figure, and the count-up only ever replaces a
 * true value with another true value at the end. A counter showing zero because
 * its animation never started is a defect, not a degradation, and there are
 * three ways that happens:
 *
 * - reduced motion, where the count-up is skipped and the value stands;
 * - a background tab, where requestAnimationFrame is never called at all. The
 *   tab is checked before the first frame is asked for, and a tab that is
 *   hidden part way through finishes on the spot;
 * - a frame loop that stops for any other reason, which the timeout catches.
 *
 * It renders text and nothing else, so the card's own `<p>` keeps the landing
 * amount scale and the tabular figures rather than this deciding either.
 */

/** The prototype counts the hero amount over this long. */
const DURATION_MS = 900;

/** How long after the count should have finished before the value is forced. */
const GRACE_MS = 500;

export function HeroAmount({ value }: { value: number }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(value);

  useEffect(() => {
    if (reduced) {
      setShown(value);
      return;
    }
    // No frame will fire here, so nothing must be started: the value already on
    // screen is the true one and it stays.
    if (document.hidden) return;

    let frame = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const stop = () => {
      cancelAnimationFrame(frame);
      if (timer !== null) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };

    const finish = () => {
      stop();
      setShown(value);
    };

    function onVisibility() {
      if (document.hidden) finish();
    }

    const start = performance.now();
    const step = (now: number) => {
      // Clamped at both ends. The timestamp a frame callback is given is the
      // moment that frame's work began, which can precede the performance.now()
      // taken here a line earlier, so the first frame's elapsed time is often
      // negative. Unclamped, the cubic ease turns that into a negative
      // multiplier and the card paints a negative amount for one frame.
      const progress = Math.min(1, Math.max(0, (now - start) / DURATION_MS));
      const eased = 1 - (1 - progress) ** 3;
      setShown(Math.round(value * eased));
      if (progress < 1) frame = requestAnimationFrame(step);
    };

    frame = requestAnimationFrame(step);
    timer = setTimeout(finish, DURATION_MS + GRACE_MS);
    document.addEventListener('visibilitychange', onVisibility);

    return stop;
  }, [reduced, value]);

  return <>{formatAmount(shown)}</>;
}
