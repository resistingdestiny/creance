'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * The one moving light in the material: the rainbow band that travels across
 * a metal card. The colour, the travel and the reduced motion stop are all in
 * the `.cover-card__shimmer` rules in the global stylesheet; this component is
 * the element that carries them, and the one thing CSS cannot do for an
 * infinite animation, which is knowing whether anybody can see it.
 *
 * A nine second loop that never ends costs battery on a page that has scrolled
 * past it and CPU in a tab nobody is looking at. So the band is paused, with
 * `animation-play-state` through the `is-paused` class, whenever the card is
 * out of the viewport or the document is hidden, and resumed when either
 * changes back. It is the same pair of signals the landing already listens
 * to: the ticker pauses with `animation-play-state` and the hero amount stops
 * on `visibilitychange`.
 *
 * The server renders the band running, because a server cannot know where the
 * viewport is, and the first client render matches it. Where there is no
 * IntersectionObserver the band runs on visibility alone, which is also what
 * the test environment sees.
 *
 * The animation is on the pseudo-element inside this span and animates
 * transform only, so pausing and resuming it never repaints the card.
 */
export function CardShimmer() {
  const ref = useRef<HTMLSpanElement>(null);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (node === null) return;

    let inView = true;
    const apply = () => setPaused(document.hidden || !inView);

    const observer =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver((entries) => {
            inView = entries.some((entry) => entry.isIntersecting);
            apply();
          });
    observer?.observe(node);
    document.addEventListener('visibilitychange', apply);
    apply();

    return () => {
      observer?.disconnect();
      document.removeEventListener('visibilitychange', apply);
    };
  }, []);

  return (
    <span
      aria-hidden="true"
      className={paused ? 'cover-card__shimmer is-paused' : 'cover-card__shimmer'}
      ref={ref}
    />
  );
}
