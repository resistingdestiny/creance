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
 * Two things change at two different moments, and the difference matters:
 *
 * - what the page says changes at once. The face being turned to is the current
 *   step from the first frame of the turn, and focus moves to it then, so a
 *   keyboard user is on the new step for the whole of the turn rather than
 *   after it, and focus is never on a control that has just been taken away.
 *   Nothing of it is painted until it comes round;
 * - the face on screen, and how tall the object is, change when the card is
 *   edge on. That is not halfway through the duration, because the turn eases
 *   out; it is where the rotation reaches ninety degrees, which is the one
 *   moment the card has no width and a swap cannot be seen.
 *
 * Under reduced motion both happen at once and there is no turn: the quote is
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
function solve(f: (t: number) => number, target: number): number {
  let low = 0;
  let high = 1;
  for (let step = 0; step < 24; step += 1) {
    const mid = (low + high) / 2;
    if (f(mid) < target) low = mid;
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
 * The curve above is symmetric, so this is a half; it is solved rather than
 * written as one because the curve is the thing that decides it, and a curve
 * changed later without this changing with it would swap the faces in plain
 * sight. Ninety degrees is the one moment the card has no width on screen and
 * nothing about the swap can be seen.
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
  const [sizing, setSizing] = useState(at);
  const travelling = useRef(at);

  useEffect(() => {
    const element = turn.current;
    if (travelling.current === at) return;
    const from = travelling.current * 180;
    const to = at * 180;
    travelling.current = at;

    if (reduced || element === null) {
      setSizing(at);
      return;
    }

    element.setAttribute('data-turning', '');
    const half = setTimeout(() => setSizing(at), TURN_MS * EDGE_ON);
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
      if (done < 1) {
        frame = requestAnimationFrame(shift);
        return;
      }
      element.removeAttribute('data-turning');
    };
    let frame = requestAnimationFrame(shift);

    return () => {
      clearTimeout(half);
      cancelAnimationFrame(frame);
      element.removeAttribute('data-turning');
      element.style.removeProperty('--card-shimmer-shift');
    };
  }, [at, reduced]);

  // A layout effect, so focus lands in the same commit that made the face it
  // came from inert. An effect would let the browser paint a frame in which the
  // control that was pressed is gone and focus is on the document.
  //
  // The scroll is prevented here and taken below instead. Focusing the heading
  // would scroll the heading into view, and the heading is the top of a face
  // whose height is still the old face's until the half turn, so the browser
  // would settle on a card that is about to grow past the bottom of the screen.
  const focused = useRef(at);
  useLayoutEffect(() => {
    if (focused.current === at) return;
    focused.current = at;
    const target = turn.current?.querySelector('[data-facing="viewer"] [data-quote-focus]');
    if (target instanceof HTMLElement) target.focus({ preventScroll: true });
  }, [at]);

  // Once the card is edge on the object is the height of the face that is
  // arriving, so this is the first moment it can be brought into view as the
  // thing it is about to be. At 1440 the card is beside the hero text and already on
  // screen, and `nearest` then scrolls nothing at all; at 390 it stands under
  // the hero, and without this a tap on "Get a quote" turns a card the visitor
  // cannot see. It is not a smooth scroll: this is the page following an
  // action, not an animation, so it is instant under any motion preference.
  const settled = useRef(sizing);
  useLayoutEffect(() => {
    if (settled.current === sizing) return;
    settled.current = sizing;
    const element = turn.current;
    // Guarded the way the stack guards matchMedia: an environment with no
    // layout, which is where this is tested, has no scrollIntoView to call.
    if (typeof element?.scrollIntoView === 'function') element.scrollIntoView({ block: 'nearest' });
  }, [sizing]);

  return (
    <div className="cover-card-turn" ref={turn} style={{ transform: `rotateY(${at * 180}deg)` }}>
      <Face facing={side(0, at)} side="front" sizing={side(0, sizing) === 'viewer'}>
        {front}
      </Face>
      {back === null ? null : (
        <Face facing={side(1, at)} side="back" sizing={side(1, sizing) === 'viewer'}>
          {back}
        </Face>
      )}
    </div>
  );
}

/** A face points at the viewer when its side matches the half turn's. */
function side(face: 0 | 1, at: number): 'viewer' | 'away' {
  return Math.abs(at % 2) === face ? 'viewer' : 'away';
}

/**
 * One face.
 *
 * `inert` and `aria-hidden` follow the step and not the paint. The face being
 * turned away from stops being reachable the moment the step changes, even
 * though it is still on screen for the first half of the turn, and the face
 * being turned to is reachable from that same moment, which is what lets focus
 * move at the start of the turn rather than after it.
 */
function Face({
  facing,
  side: which,
  sizing,
  children,
}: {
  facing: 'viewer' | 'away';
  side: 'front' | 'back';
  sizing: boolean;
  children: ReactNode;
}) {
  const away = facing === 'away';
  return (
    <div
      aria-hidden={away ? true : undefined}
      className={`cover-card-face cover-card-face--${which}`}
      data-facing={facing}
      data-sizing={sizing ? 'true' : 'false'}
      inert={away}
    >
      {children}
    </div>
  );
}
