'use client';

import { useEffect, useRef, useState } from 'react';

import { formatAmount } from '../lib/format';
import { useReducedMotion } from '../lib/use-reduced-motion';

/**
 * docs/DESIGN-TOKENS.md sections 2 and 7: the display roles, tabular, tight
 * tracking. It counts up only in the one orchestrated moment after a payment
 * confirms, over 600ms.
 *
 * Under reduced motion the count-up sets the final value immediately. It never
 * animates from zero to the value in one frame, which is what a duration of
 * zero gives you and which still reads as a flash.
 *
 * Negatives use the ASCII hyphen-minus, which is what the formatter emits.
 */

export type DisplaySize = 'display-xl' | 'display-l';

const sizeClass: Record<DisplaySize, string> = {
  'display-xl': 'text-display-xl',
  'display-l': 'text-display-l',
};

export interface DisplayNumberProps {
  value: number;
  size?: DisplaySize;
  /** Runs the orchestrated count-up when this flips to true. */
  countUp?: boolean;
  durationMs?: number;
  /** Behaves as though the user asked for reduced motion. The gallery shows both. */
  forceReducedMotion?: boolean;
  className?: string;
}

export function DisplayNumber({
  value,
  size = 'display-xl',
  countUp = false,
  durationMs = 600,
  forceReducedMotion = false,
  className,
}: DisplayNumberProps) {
  const reduced = useReducedMotion() || forceReducedMotion;
  const [shown, setShown] = useState(value);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    if (!countUp) {
      setShown(value);
      return;
    }

    if (reduced) {
      // One frame, final value. No intermediate state is ever painted.
      setShown(value);
      return;
    }

    const from = 0;
    const start = performance.now();
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs);
      const eased = 1 - (1 - progress) ** 3;
      setShown(Math.round(from + (value - from) * eased));
      if (progress < 1) frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);

    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [countUp, durationMs, reduced, value]);

  return (
    <span
      className={[
        sizeClass[size],
        'font-display font-semibold tracking-display tabular-nums text-ink',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      data-testid="display-number"
    >
      {formatAmount(shown)}
    </span>
  );
}
