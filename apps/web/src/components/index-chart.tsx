import { formatIndexValue, formatPeriodShort } from '../lib/format';

/**
 * The index line, hand-rolled SVG.
 *
 * docs/DESIGN-TOKENS.md section 5 turns off almost everything a chart library
 * provides: no gridlines, no dots, no legend, no area fill, two axis labels and
 * one band. What is left is a path and a rectangle, so there is no library
 * here. The band above a threshold with a one pixel lower edge would be a
 * custom shape in any library anyway.
 *
 * The data shape is local to the web app. The API's index payload does not
 * exist yet; T15 maps it onto this type rather than this component learning
 * about an endpoint.
 */

export interface IndexPoint {
  /** An index period, "2026-04". */
  readonly period: string;
  /** The reading, or null for a month with no observation. */
  readonly value: number | null;
}

export type IndexChartState = 'flat' | 'rising' | 'triggered';

export interface IndexChartProps {
  readonly points: readonly IndexPoint[];
  /** The attachment for this series. Always inside the drawn y domain. */
  readonly threshold: number;
  readonly state: IndexChartState;
  /** What the chart is of, for the accessible name: "Computer and mathematical". */
  readonly label: string;
  readonly size?: 'small' | 'large';
  readonly width?: number;
  readonly height?: number;
  /** The large chart's data table, which is the chart's text alternative. */
  readonly showTable?: boolean;
}

const BAND_FILL = 'rgba(209,59,59,0.06)';
const BAND_EDGE = 'rgba(209,59,59,0.4)';

const DEFAULTS = {
  small: { width: 64, height: 20, stroke: 1.25 },
  large: { width: 320, height: 180, stroke: 1.5 },
} as const;

interface Scale {
  readonly x: (index: number) => number;
  readonly y: (value: number) => number;
  readonly top: number;
}

/**
 * The y domain is min and max over the data and the threshold together, padded
 * by a tenth of the range, so the threshold is always inside the drawn domain
 * and the band is always visible. Nothing is clamped to zero: a negative line
 * with a negative threshold is a real case for this index and it has to draw.
 */
export function buildScale(
  values: readonly number[],
  threshold: number,
  width: number,
  height: number,
  count: number,
): Scale {
  const all = [...values, threshold];
  const low = Math.min(...all);
  const high = Math.max(...all);
  const spread = high - low;
  const pad = spread > 0 ? spread * 0.1 : Math.max(Math.abs(high) * 0.1, 0.1);
  const domainLow = low - pad;
  const domainHigh = high + pad;
  const span = domainHigh - domainLow || 1;
  const steps = Math.max(1, count - 1);

  return {
    x: (index) => (index / steps) * width,
    y: (value) => height - ((value - domainLow) / span) * height,
    top: 0,
  };
}

/**
 * Contiguous runs of observed months. A gap breaks the path in two rather than
 * bridging it, because a straight line across a missing month is a claim about
 * a number nobody published.
 */
export function contiguousRuns(
  points: readonly IndexPoint[],
): { index: number; value: number }[][] {
  const runs: { index: number; value: number }[][] = [];
  let current: { index: number; value: number }[] = [];

  points.forEach((point, index) => {
    if (point.value === null) {
      if (current.length > 0) runs.push(current);
      current = [];
      return;
    }
    current.push({ index, value: point.value });
  });

  if (current.length > 0) runs.push(current);
  return runs;
}

function pathFor(run: { index: number; value: number }[], scale: Scale): string {
  return run
    .map((point, position) => {
      const command = position === 0 ? 'M' : 'L';
      return `${command}${scale.x(point.index).toFixed(2)} ${scale.y(point.value).toFixed(2)}`;
    })
    .join(' ');
}

export function IndexChart({
  points,
  threshold,
  state,
  label,
  size = 'large',
  width,
  height,
  showTable = false,
}: IndexChartProps) {
  const defaults = DEFAULTS[size];
  const w = width ?? defaults.width;
  const h = height ?? defaults.height;

  const observed = points.filter((point): point is IndexPoint & { value: number } =>
    point.value !== null,
  );
  const latest = observed.at(-1);
  const scale = buildScale(
    observed.map((point) => point.value),
    threshold,
    w,
    h,
    points.length,
  );

  // Small charts carry the band only when the state is triggered. Large charts
  // always carry it: the band is what the chart is about.
  const showBand = size === 'large' || state === 'triggered';
  const bandY = Math.max(0, Math.min(h, scale.y(threshold)));

  const first = points[0];
  const last = points.at(-1);
  const bandLabel = `Pays out above ${formatIndexValue(threshold)}`;
  const ariaLabel = latest
    ? `${label}. Latest reading ${formatIndexValue(latest.value)}, ${formatPeriodShort(latest.period)}. Pays out above ${formatIndexValue(threshold)}.`
    : `${label}. No reading yet. Pays out above ${formatIndexValue(threshold)}.`;

  return (
    <figure className="m-0 flex flex-col gap-2">
      <div aria-label={ariaLabel} role="img">
        {/* The viewBox is in pixels, not in data coordinates, and the data is
            mapped to pixels above. Nothing is scaled non-uniformly, so the
            stroke width is the width it says it is. */}
        <svg className="block" height={h} viewBox={`0 0 ${w} ${h}`} width={w}>
          {showBand ? (
            <>
              <rect
                data-testid="index-chart-band"
                fill={BAND_FILL}
                height={bandY}
                width={w}
                x={0}
                y={0}
              />
              <line
                data-testid="index-chart-band-edge"
                shapeRendering="crispEdges"
                stroke={BAND_EDGE}
                strokeWidth={1}
                x1={0}
                x2={w}
                y1={bandY}
                y2={bandY}
              />
            </>
          ) : null}
          {contiguousRuns(points).map((run, position) => (
            <path
              d={pathFor(run, scale)}
              data-testid="index-chart-line"
              fill="none"
              key={run[0]?.index ?? position}
              stroke="#000"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={defaults.stroke}
            />
          ))}
        </svg>
      </div>
      {size === 'large' && first && last ? (
        <figcaption className="flex items-baseline justify-between text-caption">
          <span className="text-ink-2">{formatPeriodShort(first.period)}</span>
          <span className="text-triggered">{bandLabel}</span>
          <span className="text-ink-2">{formatPeriodShort(last.period)}</span>
        </figcaption>
      ) : null}
      {showTable ? (
        <details className="text-secondary text-ink-2">
          <summary className="min-h-11 cursor-pointer py-3 text-ink">The readings</summary>
          <table className="w-full border-collapse">
            <caption className="sr-only">{`Monthly readings for ${label}`}</caption>
            <thead>
              <tr className="border-b border-hairline">
                <th className="h-10 text-left text-secondary font-normal text-ink-2" scope="col">
                  Month
                </th>
                <th className="h-10 text-right text-secondary font-normal text-ink-2" scope="col">
                  Reading
                </th>
              </tr>
            </thead>
            <tbody>
              {points.map((point) => (
                <tr className="border-b border-hairline" key={point.period}>
                  <td className="h-12 text-left text-ink">{formatPeriodShort(point.period)}</td>
                  <td className="h-12 text-right tabular-nums text-ink">
                    {point.value === null ? 'No reading' : formatIndexValue(point.value)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ) : null}
    </figure>
  );
}
