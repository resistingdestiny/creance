'use client';

import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';

import { useReducedMotion } from '../lib/use-reduced-motion';
import { formatPeriod, formatPeriodShort } from '../lib/format';
import {
  BAND_EDGE,
  BAND_FILL,
  buildScale,
  contiguousRuns,
  pathFor,
  type IndexPoint,
} from './index-chart';

/**
 * The index explorer's chart: sixty months of one occupation, its line, the
 * months claims opened, and a handle the reader drags through time.
 *
 * It is the index chart of docs/DESIGN-TOKENS.md section 5 with two additions
 * the section does not cover, because the section was written for a chart
 * nobody touches: a red mark on every month claims opened, and a scrub handle.
 * Everything else is unchanged. Black line, no fill, no dots, no gridlines, no
 * legend, two axis labels, one band in the same two reds.
 *
 * The band is above the line, on the side where claims open, for both trigger
 * forms: the API serves both as "open when the value reaches the line", so up
 * is towards a payout on this chart whichever form it is drawing.
 *
 * No index value is printed anywhere on it. The handle carries the month and
 * the verdict block beside it says the rest, because a consumer is never shown
 * a signed index value (docs/DECISIONS.md).
 *
 * Motion. The line tweens when the reader picks another occupation, 520ms with
 * a cubic ease-out, and never on a scrub, which has to track the pointer. The
 * tween is an override written onto the path element by an animation frame:
 * React always renders the true path, so a hidden tab, a reduced-motion
 * preference or a frame callback that never fires all leave the finished state
 * on screen rather than an unfinished one.
 */

const WIDTH = 720;
const HEIGHT = 300;
const PAD = 26;
const INNER_WIDTH = WIDTH - 2 * PAD;
const INNER_HEIGHT = HEIGHT - 2 * PAD;

/** docs/DESIGN-TOKENS.md section 6: the longest this line is allowed to move. */
export const TWEEN_MS = 520;

export interface ExplorerChartPoint extends IndexPoint {
  /** Whether claims were open that month, which draws a red mark. */
  readonly open: boolean;
}

export interface ExplorerChartProps {
  readonly points: readonly ExplorerChartPoint[];
  readonly threshold: number;
  /** The month the handle sits on, an index into `points`. */
  readonly at: number;
  readonly onScrub: (at: number) => void;
  /** The accessible name, which carries the reading in words. */
  readonly name: string;
  /** The band caption, between the two axis labels. */
  readonly caption: string;
  /** Changing this starts the tween. The occupation key. */
  readonly tweenKey: string;
  /** The scrubber's own label, which names the occupation. */
  readonly scrubLabel: string;
}

function ease(progress: number): number {
  return 1 - Math.pow(1 - progress, 3);
}

export function ExplorerChart({
  points,
  threshold,
  at,
  onScrub,
  name,
  caption,
  tweenKey,
  scrubLabel,
}: ExplorerChartProps) {
  const reducedMotion = useReducedMotion();
  const pathRef = useRef<SVGPathElement>(null);
  const previous = useRef<{ key: string; ys: readonly (number | null)[] } | null>(null);
  const dragging = useRef(false);

  const values = points
    .map((point) => point.value)
    .filter((value): value is number => value !== null);
  const scale = buildScale(values, threshold, INNER_WIDTH, INNER_HEIGHT, points.length);
  const ys = points.map((point) => (point.value === null ? null : scale.y(point.value)));
  const runs = contiguousRuns(points);
  const d = runs.map((run) => pathFor(run, scale)).join(' ');
  const bandY = Math.max(0, Math.min(INNER_HEIGHT, scale.y(threshold)));

  const last = points.length - 1;
  const selected = Math.min(Math.max(0, at), Math.max(0, last));
  const month = points[selected];
  const first = points[0];
  const newest = points.at(-1);
  const handleX = scale.x(selected);
  const handleY = ys[selected];

  useEffect(() => {
    const before = previous.current;
    previous.current = { key: tweenKey, ys };
    const node = pathRef.current;
    if (node === null || before === null || before.key === tweenKey) return;
    if (reducedMotion || document.hidden || before.ys.length !== ys.length) return;

    const from = before.ys;
    const to = ys;
    let frame = 0;
    const started = performance.now();
    const step = (now: number) => {
      const progress = Math.min(1, (now - started) / TWEEN_MS);
      const eased = ease(progress);
      const mixed = to.map((target, index) => {
        const origin = from[index];
        if (target === null || origin === undefined || origin === null) return target;
        return origin + (target - origin) * eased;
      });
      node.setAttribute('d', pathOf(mixed, scale));
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      // Whatever happened, the element ends on the path React rendered.
      node.setAttribute('d', d);
    };
    // The tween is started by a change of occupation and by nothing else. A
    // scrub re-renders this component with the same key and must not restart
    // it, so the geometry is read through the refs above rather than listed
    // here as a dependency.
  }, [tweenKey]);

  function scrubFromPointer(event: ReactPointerEvent<SVGSVGElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width === 0 || last <= 0) return;
    const inViewBox = ((event.clientX - box.left) / box.width) * WIDTH;
    const step = INNER_WIDTH / last;
    onScrub(Math.min(last, Math.max(0, Math.round((inViewBox - PAD) / step))));
  }

  return (
    <figure className="m-0 flex flex-col gap-2">
      {/* touch-action none, so a drag across the chart scrubs instead of
          scrolling the page. https://developer.mozilla.org/en-US/docs/Web/CSS/touch-action */}
      <svg
        aria-label={name}
        className="block h-56 w-full touch-none select-none lg:h-75"
        onPointerCancel={() => (dragging.current = false)}
        onPointerDown={(event) => {
          dragging.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          scrubFromPointer(event);
        }}
        onPointerMove={(event) => {
          if (dragging.current) scrubFromPointer(event);
        }}
        onPointerUp={() => (dragging.current = false)}
        preserveAspectRatio="none"
        role="img"
        viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`}
      >
        <g transform={`translate(${String(PAD)} ${String(PAD)})`}>
          <rect
            data-testid="explorer-chart-band"
            fill={BAND_FILL}
            height={bandY}
            width={INNER_WIDTH}
            x={0}
            y={0}
          />
          <line
            shapeRendering="crispEdges"
            stroke={BAND_EDGE}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
            x1={0}
            x2={INNER_WIDTH}
            y1={bandY}
            y2={bandY}
          />
          <path
            d={d}
            data-testid="explorer-chart-line"
            fill="none"
            ref={pathRef}
            stroke="#000"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.75}
            vectorEffect="non-scaling-stroke"
          />
          {points.map((point, index) =>
            point.open && ys[index] !== null && ys[index] !== undefined ? (
              <circle
                cx={scale.x(index)}
                cy={ys[index]}
                data-testid="explorer-chart-open-mark"
                fill="#D13B3B"
                key={point.period}
                r={4}
              />
            ) : null,
          )}
          {handleY === null || handleY === undefined ? null : (
            <>
              <line
                stroke="#A3A7AE"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
                x1={handleX}
                x2={handleX}
                y1={0}
                y2={INNER_HEIGHT}
              />
              <circle
                cx={handleX}
                cy={handleY}
                data-testid="explorer-chart-handle"
                fill={month?.open === true ? '#D13B3B' : '#000'}
                r={5}
              />
            </>
          )}
        </g>
      </svg>

      {/* The sheet's own slider, painted by the `.amount-slider` rules: a 3px
          track and a 28px thumb, which clears the 44px tap target with its
          padding. The label is for a screen reader; the two axis labels under
          it already say what the ends are. */}
      <label className="flex min-h-11 items-center">
        <span className="sr-only">{scrubLabel}</span>
        <input
          aria-valuetext={month === undefined ? undefined : formatPeriod(month.period)}
          className="amount-slider"
          max={Math.max(0, last)}
          min={0}
          onChange={(event) => onScrub(Number(event.target.value))}
          step={1}
          style={{
            ['--amount-slider-filled' as string]: `${String(last <= 0 ? 0 : (selected / last) * 100)}%`,
          }}
          type="range"
          value={selected}
        />
      </label>

      <figcaption className="flex items-baseline justify-between gap-4 text-caption">
        <span className="text-ink-2">{first === undefined ? '' : formatPeriodShort(first.period)}</span>
        <span className="text-triggered">{caption}</span>
        <span className="text-ink-2">
          {newest === undefined ? '' : formatPeriodShort(newest.period)}
        </span>
      </figcaption>
    </figure>
  );
}

function pathOf(ys: readonly (number | null)[], scale: { x: (index: number) => number }): string {
  const runs: string[] = [];
  let current: string[] = [];
  ys.forEach((y, index) => {
    if (y === null) {
      if (current.length > 0) runs.push(current.join(' '));
      current = [];
      return;
    }
    current.push(`${current.length === 0 ? 'M' : 'L'}${scale.x(index).toFixed(2)} ${y.toFixed(2)}`);
  });
  if (current.length > 0) runs.push(current.join(' '));
  return runs.join(' ');
}
