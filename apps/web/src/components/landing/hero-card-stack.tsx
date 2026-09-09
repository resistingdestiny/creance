'use client';

import { useEffect, useRef, type ReactNode } from 'react';

import { useReducedMotion } from '../../lib/use-reduced-motion';

/**
 * The frame the landing hero card turns inside.
 *
 * The card itself is still rendered on the server and handed in as children, so
 * nothing about what the page says is decided in the browser. This wrapper adds
 * one thing: the angle.
 *
 * The rotation goes on the inner sheet and the perspective on the outer stack,
 * so the one orchestrated moment on load stays a CSS animation on the stack and
 * the two transforms never fight for the same element. A CSS animation outranks
 * an inline style, so a card that carried both would be pinned by the animation
 * and never tilt at all.
 *
 * Three rules from the ticket, in the order they are decided here:
 *
 * - a card that is being written on is a card that holds still. The quote is on
 *   its other face (T36), and a search field that sways under the cursor while
 *   it is being typed into is the drift working against the thing the card is
 *   for. `still` stops the loop and clears the angle, and the shimmer carries on,
 *   so the surface is alive without the object moving;
 * - reduced motion is the finished state, which for a card at rest is the card
 *   square on. No frame loop is started and no listener is attached, so there is
 *   nothing to turn off later;
 * - a coarse pointer is simply still. A finger has no hover and no angle to
 *   take, and a card that drifts under a thumb is motion nobody asked for;
 * - on a fine pointer it drifts while idle, follows the pointer while the
 *   pointer is on it, and eases back over half a second when the pointer
 *   leaves. The easing is the CSS transition in the stylesheet: this clears the
 *   inline transform and lets the transition carry it home, rather than
 *   animating it back frame by frame.
 *
 * Nothing here observes scroll. The drift runs on requestAnimationFrame, which
 * the browser already stops in a background tab.
 */

/** Degrees of drift on each axis while nothing is pointing at the card. */
const SWAY_X = 2.6;
const SWAY_Y = 4.2;

/** Degrees across the full width and height of the card under the pointer. */
const TILT_X = 15;
const TILT_Y = 19;

/** How far the card comes towards the viewer while the pointer is on it. */
const LIFT = 26;

/** The ease back in the stylesheet, after which the drift picks up again. */
const SETTLE_MS = 520;

export function HeroCardStack({
  children,
  className,
  still = false,
}: {
  children: ReactNode;
  className?: string;
  /** Holds the card square on, for as long as something is being filled in on it. */
  still?: boolean;
}) {
  const stack = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const root = stack.current;
    const card = sheet.current;
    if (root === null || card === null) return;
    if (reduced || still) return;
    if (typeof window.matchMedia !== 'function') return;
    if (!window.matchMedia('(pointer: fine)').matches) return;

    let idle = true;
    let origin = performance.now();
    let frame = 0;
    let settle: ReturnType<typeof setTimeout> | null = null;

    const turn = (x: number, y: number, lift: number) => {
      card.style.transform = `rotateX(${x.toFixed(2)}deg) rotateY(${y.toFixed(2)}deg) translateZ(${lift}px)`;
    };

    const drift = (now: number) => {
      if (idle) {
        const seconds = (now - origin) / 1000;
        turn(Math.sin(seconds * 0.42) * SWAY_X, Math.cos(seconds * 0.33) * SWAY_Y, 0);
      }
      frame = requestAnimationFrame(drift);
    };

    const enter = () => {
      idle = false;
      if (settle !== null) {
        clearTimeout(settle);
        settle = null;
      }
      root.classList.add('is-tracking');
    };

    const move = (event: PointerEvent) => {
      const box = card.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) return;
      const across = (event.clientX - box.left) / box.width;
      const down = (event.clientY - box.top) / box.height;
      turn(-(down - 0.5) * TILT_X, (across - 0.5) * TILT_Y, LIFT);
      // The glare reads these two off its own inherited custom properties, so
      // the light layer needs no script and stays where the stylesheet put it,
      // under the card's content.
      root.style.setProperty('--card-glare-x', `${(across * 100).toFixed(1)}%`);
      root.style.setProperty('--card-glare-y', `${(down * 100).toFixed(1)}%`);
    };

    const leave = () => {
      root.classList.remove('is-tracking');
      card.style.transform = '';
      if (settle !== null) clearTimeout(settle);
      settle = setTimeout(() => {
        origin = performance.now();
        idle = true;
      }, SETTLE_MS);
    };

    frame = requestAnimationFrame(drift);
    root.addEventListener('pointerenter', enter);
    root.addEventListener('pointermove', move);
    root.addEventListener('pointerleave', leave);

    return () => {
      cancelAnimationFrame(frame);
      if (settle !== null) clearTimeout(settle);
      root.removeEventListener('pointerenter', enter);
      root.removeEventListener('pointermove', move);
      root.removeEventListener('pointerleave', leave);
      root.classList.remove('is-tracking');
      card.style.transform = '';
    };
  }, [reduced, still]);

  return (
    <div className={['cover-card-stack', className].filter(Boolean).join(' ')} ref={stack}>
      <div className="cover-card-tilt" ref={sheet}>
        {children}
      </div>
    </div>
  );
}
