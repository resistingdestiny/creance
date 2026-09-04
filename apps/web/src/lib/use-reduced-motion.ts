'use client';

import { useEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Whether the user has asked for reduced motion.
 *
 * The transitions in this app take the reduced-motion branch in CSS, through
 * Tailwind's `motion-reduce:` variant. This hook exists for the one thing CSS
 * cannot do: the count-up, which has to be skipped rather than shortened.
 *
 * It subscribes rather than reading once, because the preference can change
 * while the page is open and a stale read leaves an animation running for
 * someone who just asked for it to stop.
 *
 * The initial value is false so that the server render and the first client
 * render agree. The effect corrects it before anything animates.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const media = window.matchMedia(QUERY);
    setReduced(media.matches);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  return reduced;
}
