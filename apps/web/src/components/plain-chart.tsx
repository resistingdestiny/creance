import {
  BAND_EDGE,
  BAND_FILL,
  buildScale,
  contiguousRuns,
  pathFor,
  type IndexPoint,
} from './index-chart';

/**
 * A line, a band and nothing else.
 *
 * The same drawing appears twice on the index explorer at two sizes: under each
 * of the four steps that explain how the number is built, and in each of the
 * fifteen cells that rank the occupations. Both want a black line, an optional
 * second line in ink-3 for a comparison, and an optional trigger band, and
 * neither wants an axis, a caption or a data table, because the block around it
 * already says what it is.
 *
 * docs/DESIGN-TOKENS.md section 5 applies here as it does to the index chart:
 * no fill, no dots, no gridlines, no legend, and the band is the same two reds
 * as everywhere else in the app.
 */

export interface PlainChartProps {
  readonly points: readonly IndexPoint[];
  /** A second series, drawn in ink-3 behind the first. */
  readonly against?: readonly IndexPoint[];
  /** The threshold, and its band, when the chart is about one. */
  readonly threshold?: number;
  readonly width: number;
  readonly height: number;
  readonly strokeWidth?: number;
  /**
   * The accessible name. Without one the chart is decoration for the sentence
   * beside it and is hidden, which is what the four steps want: each of them
   * says in words what its own chart shows.
   */
  readonly label?: string;
}

export function PlainChart({
  points,
  against,
  threshold,
  width,
  height,
  strokeWidth = 1.3,
  label,
}: PlainChartProps) {
  const values = [...points, ...(against ?? [])]
    .map((point) => point.value)
    .filter((value): value is number => value !== null);
  if (values.length === 0) return null;

  // The threshold has to be inside the drawn domain or the band is invisible.
  // Where there is none, the series decides the domain on its own.
  const scale = buildScale(
    values,
    threshold ?? (values[0] as number),
    width,
    height,
    points.length,
  );
  const bandY = threshold === undefined ? null : Math.max(0, Math.min(height, scale.y(threshold)));

  return (
    <svg
      aria-hidden={label === undefined ? 'true' : undefined}
      aria-label={label}
      className="block size-full"
      preserveAspectRatio="none"
      role={label === undefined ? undefined : 'img'}
      viewBox={`0 0 ${String(width)} ${String(height)}`}
    >
      {bandY === null ? null : (
        <>
          <rect
            data-testid="plain-chart-band"
            fill={BAND_FILL}
            height={bandY}
            width={width}
            x={0}
            y={0}
          />
          <line
            shapeRendering="crispEdges"
            stroke={BAND_EDGE}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
            x1={0}
            x2={width}
            y1={bandY}
            y2={bandY}
          />
        </>
      )}
      {(against ?? []).length === 0
        ? null
        : contiguousRuns(against ?? []).map((run, position) => (
            <path
              d={pathFor(run, scale)}
              data-testid="plain-chart-against"
              fill="none"
              key={run[0]?.index ?? position}
              stroke="#A3A7AE"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={strokeWidth}
              vectorEffect="non-scaling-stroke"
            />
          ))}
      {contiguousRuns(points).map((run, position) => (
        <path
          d={pathFor(run, scale)}
          data-testid="plain-chart-line"
          fill="none"
          key={run[0]?.index ?? position}
          stroke="#000"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={strokeWidth}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}
