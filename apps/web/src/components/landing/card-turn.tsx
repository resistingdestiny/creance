'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

import { useReducedMotion } from '../../lib/use-reduced-motion';

/**
 * The hero card turning over, on its vertical axis, to show its other face.
 *
 * It is one object. There is no card that fades out and no panel that fades in:
 * two faces share one element, the element rotates, and whichever face is
 * pointing at the viewer is the one being read. `at` is how many half turns
 * from the start the card is, so a step forward adds one and a step back takes
 * one away, and the direction of travel is the direction of the turn without
 * anything having to decide it.
 *
 * The rotation goes on this element and never on `.cover-card-tilt` above it,
 * which the hero card stack writes an inline transform to on every frame. One
 * element cannot carry two transforms, and a keyframe animation there would
 * outrank the inline style and leave the card pinned square on for good.
 *
 * The rotation starts the moment the step changes. Everything else waits until
 * the card is edge on, and that is deliberate: which face is on screen, which
 * face is in the tab order and the accessibility tree, how tall the object is,
 * and where focus is, all change together at ninety degrees, where the card has
 * no width and none of it can be seen.
 *
 * Doing any of it sooner breaks one of the others. A hidden face cannot take
 * focus, so focus cannot move ahead of the turn; and a face taken out of the tab
 * order while it is still the one on screen takes the focus that was on it with
 * it, which is focus lost in the middle of a turn. Held to the one moment, the
 * visitor keeps the control they pressed until the card has turned away from
 * it, and lands on the new step as it arrives.
 *
 * Under reduced motion it all happens at once and there is no turn: the quote is
 * simply on the card. The stylesheet takes the transition off, so nothing here
 * has to know how the rotation is drawn.
 */

/** The turn, matching the transition in the stylesheet. */
export const TURN_MS = 480;

/** How far a quarter turn carries the shimmer band across the metal. */
const SHIMMER_TRAVEL = 60;

/** The easing in the stylesheet, so what is worked out here matches the paint. */
const EASE = [0.65, 0, 0.35, 1] as const;

/** One axis of a cubic bezier whose first and last control points are 0 and 1. */
function axis(first: number, second: number, t: number): number {
  return 3 * (1 - t) ** 2 * t * first + 3 * (1 - t) * t ** 2 * second + t ** 3;
}

/** Bisection, which is short, exact enough at 24 steps and has no failure case. */
function solve(curve: (t: number) => number, target: number): number {
  let low = 0;
  let high = 1;
  for (let step = 0; step < 24; step += 1) {
    const mid = (low + high) / 2;
    if (curve(mid) < target) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

/** How far through the turn the card is, at a fraction of the duration. */
function eased(fraction: number): number {
  return axis(EASE[1], EASE[3], solve((t) => axis(EASE[0], EASE[2], t), fraction));
}

/**
 * The fraction of the duration at which the card is edge on.
 *
 * The curve above is symmetric, so this is a half. It is solved rather than
 * written as one because the curve is what decides it, and a curve changed
 * later without this changing with it would swap the faces in plain sight.
 */
const EDGE_ON = solve(eased, 0.5);

export function CardTurn({
  at,
  front,
  back,
}: {
  /** Half turns from the start. Even faces are the front, odd ones the back. */
  at: number;
  front: ReactNode;
  /** Null until there is anything on the back, which keeps the first paint one card. */
  back: ReactNode | null;
}) {
  const reduced = useReducedMotion();
  const turn = useRef<HTMLDivElement>(null);
  // Which half turn the faces are dressed for, which lags `at` for as long as
  // the card is on its way there.
  const [shown, setShown] = useState(at);
  const travelling = useRef(at);

  useEffect(() => {
    const element = turn.current;
    if (travelling.current === at) return;
    const from = travelling.current * 180;
    const to = at * 180;
    travelling.current = at;

    if (reduced || element === null) {
      setShown(at);
      return;
    }

    const edge = setTimeout(() => setShown(at), TURN_MS * EDGE_ON);
    const started = performance.now();
    // The shimmer is a CSS animation and stays one. This tells it where the
    // surface is pointing, which is the one thing CSS cannot work out, by
    // writing the offset the keyframes add to the band's own travel.
    const shift = (now: number) => {
      const done = Math.min(1, Math.max(0, (now - started) / TURN_MS));
      const angle = ((from + (to - from) * eased(done)) * Math.PI) / 180;
      element.style.setProperty(
        '--card-shimmer-shift',
        `${(Math.sin(angle) * SHIMMER_TRAVEL).toFixed(1)}px`,
      );
      if (done < 1) frame = requestAnimationFrame(shift);
    };
    let frame = requestAnimationFrame(shift);

    return () => {
      clearTimeout(edge);
      cancelAnimationFrame(frame);
      element.style.removeProperty('--card-shimmer-shift');
    };
  }, [at, reduced]);

  // A layout effect, so focus moves in the same commit that hides the face it
  // was on. An effect would let the browser paint a frame in which the control
  // holding focus is gone and focus is on the document.
  //
  // The scroll is prevented on the focus call and taken separately, because the
  // heading is the top of the new face and scrolling to it would leave the rest
  // of a taller face below the bottom of the screen. `nearest` on the object
  // itself brings the whole card in. At 1440 it is beside the hero text and
  // already on screen, so nothing scrolls at all; at 390 it stands under the
  // hero, and without this a tap on "Get a quote" turns a card nobody can see.
  // It is instant rather than smooth: this is the page following an action.
  const settled = useRef(shown);
  useLayoutEffect(() => {
    if (settled.current === shown) return;
    settled.current = shown;
    const element = turn.current;
    const target = element?.querySelector('[data-facing="viewer"] [data-quote-focus]');
    if (target instanceof HTMLElement) target.focus({ preventScroll: true });
    // Guarded the way the stack guards matchMedia: an environment with no
    // layout, which is where this is tested, has no scrollIntoView to call.
    if (typeof element?.scrollIntoView === 'function') element.scrollIntoView({ block: 'nearest' });
  }, [shown]);

  return (
    <div className="cover-card-turn" ref={turn} style={{ transform: `rotateY(${at * 180}deg)` }}>
      <Face facing={side(0, shown)} side="front">
        {front}
      </Face>
      {back === null ? null : (
        <Face facing={side(1, shown)} side="back">
          {back}
        </Face>
      )}
    </div>
  );
}

/** A face points at the viewer when its side matches the half turn's. */
function side(face: 0 | 1, shown: number): 'viewer' | 'away' {
  return Math.abs(shown % 2) === face ? 'viewer' : 'away';
}

/**
 * One face.
 *
 * The stylesheet hides the away face, which is enough to take it out of the tab
 * order in a browser. `inert` says the same thing to anything that reads the
 * tree rather than the paint, and `aria-hidden` keeps the step the card has
 * turned away from out of a screen reader's reach while it is still in the
 * document holding what was entered on it.
 */
function Face({
  facing,
  side: which,
  children,
}: {
  facing: 'viewer' | 'away';
  side: 'front' | 'back';
  children: ReactNode;
}) {
  const away = facing === 'away';
  return (
    <div
      aria-hidden={away ? true : undefined}
      className={`cover-card-face cover-card-face--${which}`}
      data-facing={facing}
      inert={away}
    >
      {children}
    </div>
  );
}
