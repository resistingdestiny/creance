'use client';

import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Whether the user has asked for reduced motion.
 *
 * The transitions in this app take the reduced-motion branch in CSS, through
 * Tailwind's `motion-reduce:` variant. This hook exists for the one thing CSS
 * cannot do: the count-up, which has to be skipped rather than shortened.
 *
 * Two things it has to get right, and an effect gets neither:
 *
 * - the value has to be correct on the first client render. Starting at false
 *   and correcting in an effect schedules one animation frame at zero before
 *   the correction lands, which is the flash this is supposed to prevent;
 * - the preference can change while the page is open, so it is subscribed to
 *   rather than read once.
 *
 * useSyncExternalStore gives both. The server snapshot is false because a
 * server has no preference to read, and React reconciles the difference on
 * hydration without a mismatch.
 */

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const media = window.matchMedia(QUERY);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

function getSnapshot(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia(QUERY).matches;
}

function getServerSnapshot(): boolean {
  return false;
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
