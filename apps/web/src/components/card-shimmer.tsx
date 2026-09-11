'use client';

import { useEffect, useRef } from 'react';

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
 * The class is toggled on the element directly rather than held in state. The
 * span has no children and its class is never otherwise rendered, so nothing
 * React reconciles can disagree with it, and a card that scrolls in and out
 * of view costs no render of the card it sits on. The server renders the band
 * running, because a server cannot know where the viewport is. Where there is
 * no IntersectionObserver the band runs on visibility alone, which is also
 * what the test environment sees.
 *
 * The animation is on the pseudo-element inside this span and animates
 * transform only, so pausing and resuming it never repaints the card.
 */
export function CardShimmer() {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (node === null) return;

    let inView = true;
    const apply = () => node.classList.toggle('is-paused', document.hidden || !inView);

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

  return <span aria-hidden="true" className="cover-card__shimmer" ref={ref} />;
}
