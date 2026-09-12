import { buildScale, contiguousRuns, pathFor, type IndexPoint } from './index-chart';

/**
 * A rate over time: one black line, no band, no axis, no dots.
 *
 * It is the index chart of docs/DESIGN-TOKENS.md section 5 with the band taken
 * off, because there is no threshold here. A rate has nothing to cross: the
 * band and its two reds mean "claims open" everywhere else in this app, and
 * drawing them over a chart that is not about a trigger would give the colour
 * a second meaning.
 *
 * It exists beside src/components/plain-chart.tsx rather than inside it for
 * one reason: the domain is a prop. PlainChart scales to its own points, which
 * is right for a chart standing alone and wrong for a column of sixteen. An
 * occupation whose rate never left the floor and one that went to eight
 * percent would draw the same shape at the same height, and the column would
 * say they moved alike. Handed one low and one high, every row is drawn
 * against the same ruler and the flat ones read as flat.
 *
 * The point type is the chart's own, so a gap is a null and a null breaks the
 * path rather than bridging it. A month nobody published is not a rate of
 * nought and it is not a straight line across the months either side of it.
 */

export interface RateChartProps {
  readonly points: readonly IndexPoint[];
  /** The bottom of the drawn domain, before its padding. */
  readonly low: number;
  /** The top of it. Equal to `low` for a rate that never moved. */
  readonly high: number;
  readonly width: number;
  readonly height: number;
  readonly strokeWidth?: number;
  /**
   * The accessible name. Without one the chart is decoration for whatever
   * figure stands beside it and is hidden, which is what a table cell wants
   * when the row already carries the numbers in words.
   */
  readonly label?: string;
}

export function RateChart({
  points,
  low,
  high,
  width,
  height,
  strokeWidth = 1.3,
  label,
}: RateChartProps) {
  const runs = contiguousRuns(points);
  if (runs.length === 0) return null;

  // The domain is the two bounds and nothing else, so the same two bounds give
  // the same ruler whatever a particular row's own readings happen to be. The
  // padding and the flat-series case are buildScale's, which is where every
  // other chart in this app gets them.
  const scale = buildScale([low, high], low, width, height, points.length);

  return (
    <svg
      aria-hidden={label === undefined ? 'true' : undefined}
      aria-label={label}
      className="block size-full"
      preserveAspectRatio="none"
      role={label === undefined ? undefined : 'img'}
      viewBox={`0 0 ${String(width)} ${String(height)}`}
    >
      {runs.map((run, position) =>
        // A single observed month between two gaps has no segment to draw and
        // a zero length path with a round cap paints nothing, so it is a dot.
        // One reading is still a reading and dropping it would be the only
        // silent hole on the chart.
        run.length === 1 ? (
          <circle
            cx={scale.x(run[0]!.index)}
            cy={scale.y(run[0]!.value)}
            data-testid="rate-chart-point"
            fill="#000"
            key={run[0]!.index}
            r={strokeWidth}
          />
        ) : (
          <path
            d={pathFor(run, scale)}
            data-testid="rate-chart-line"
            fill="none"
            key={run[0]?.index ?? position}
            stroke="#000"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={strokeWidth}
            vectorEffect="non-scaling-stroke"
          />
        ),
      )}
    </svg>
  );
}
