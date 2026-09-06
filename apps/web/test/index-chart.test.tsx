import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  IndexChart,
  buildScale,
  contiguousRuns,
  type IndexPoint,
} from '../src/components/index-chart.js';

function months(values: readonly (number | null)[], from = 1): IndexPoint[] {
  return values.map((value, index) => ({
    period: `2025-${String(from + index).padStart(2, '0')}`,
    value,
  }));
}

function paths(markup: string): string[] {
  return [...markup.matchAll(/<path[^>]*>/g)]
    .map((match) => match[0])
    .filter((tag) => tag.includes('data-testid="index-chart-line"'))
    .map((tag) => /\sd="([^"]*)"/.exec(tag)?.[1] ?? '');
}

describe('the scale', () => {
  it('always puts the threshold inside the drawn domain', () => {
    for (const [values, threshold] of [
      [[0.1, 0.2, 0.3], 2],
      [[3, 4, 5], 2],
      [[-1.2, -0.9, -0.4], -0.6],
    ] as [number[], number][]) {
      const scale = buildScale(values, threshold, 320, 180, values.length);
      const y = scale.y(threshold);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(180);
    }
  });

  it('does not collapse when every reading is identical', () => {
    const scale = buildScale([1.5, 1.5, 1.5], 1.5, 320, 180, 3);
    expect(Number.isFinite(scale.y(1.5))).toBe(true);
    expect(scale.y(1.5)).toBeCloseTo(90, 5);
  });

  it('never assumes a zero baseline', () => {
    // An all-negative series is a real case for this index: an occupation
    // whose unemployment is usually below average. The line must use the whole
    // plot rather than being squashed against a zero that is not in the data.
    const values = [-1.4, -1.1, -0.7];
    const scale = buildScale(values, -0.9, 320, 180, 3);
    expect(scale.y(-1.4)).toBeGreaterThan(150);
    expect(scale.y(-0.7)).toBeLessThan(30);
  });
});

describe('contiguous runs', () => {
  it('splits on a missing month', () => {
    const runs = contiguousRuns(months([0.1, 0.2, null, 0.4, 0.5]));
    expect(runs).toHaveLength(2);
    expect(runs[0]).toHaveLength(2);
    expect(runs[1]).toHaveLength(2);
  });

  it('keeps the original index so the gap keeps its width', () => {
    const runs = contiguousRuns(months([0.1, null, 0.3]));
    expect(runs[0]?.[0]?.index).toBe(0);
    expect(runs[1]?.[0]?.index).toBe(2);
  });

  it('is one run when nothing is missing', () => {
    expect(contiguousRuns(months([0.1, 0.2, 0.3]))).toHaveLength(1);
  });
});

describe('the band', () => {
  it('renders when the threshold is above every data point', () => {
    const markup = renderToStaticMarkup(
      <IndexChart
        label="Computer and mathematical"
        points={months([0.1, 0.2, 0.15])}
        state="flat"
        threshold={2}
      />,
    );
    expect(markup).toContain('data-testid="index-chart-band"');
    expect(markup).toContain('rgba(209,59,59,0.06)');
    expect(markup).toContain('rgba(209,59,59,0.4)');
  });

  it('renders when the threshold is below every data point and does not clamp at zero', () => {
    const markup = renderToStaticMarkup(
      <IndexChart
        label="Computer and mathematical"
        points={months([-1.4, -1.1, -0.7])}
        state="triggered"
        threshold={-0.9}
      />,
    );
    const edge = /data-testid="index-chart-band-edge"[^>]*y1="([\d.]+)"/.exec(markup);
    const y = Number(edge?.[1]);
    expect(y).toBeGreaterThan(0);
    expect(y).toBeLessThan(180);
    // The lowest reading sits near the floor of the plot, which it cannot do
    // if the domain were anchored to zero.
    expect(paths(markup)[0]).toMatch(/L?0\.00 1[5-8]\d\.\d\d/);
  });

  it('is left off a small chart unless the state is triggered', () => {
    const flat = renderToStaticMarkup(
      <IndexChart label="Sales and related" points={months([0.1, 0.2])} size="small" state="flat" threshold={2} />,
    );
    const fired = renderToStaticMarkup(
      <IndexChart
        label="Sales and related"
        points={months([0.1, 2.4])}
        size="small"
        state="triggered"
        threshold={2}
      />,
    );
    expect(flat).not.toContain('data-testid="index-chart-band"');
    expect(fired).toContain('data-testid="index-chart-band"');
  });
});

describe('the line', () => {
  it('is one path when the series is complete', () => {
    const markup = renderToStaticMarkup(
      <IndexChart label="Legal" points={months([0.1, 0.2, 0.3])} state="rising" threshold={2} />,
    );
    expect(paths(markup)).toHaveLength(1);
  });

  it('is two paths across a missing month, with no bridging segment', () => {
    const markup = renderToStaticMarkup(
      <IndexChart
        label="Legal"
        points={months([0.1, 0.2, null, 0.4, 0.5])}
        state="rising"
        threshold={2}
      />,
    );
    const drawn = paths(markup);
    expect(drawn).toHaveLength(2);
    // Each path starts with its own move, so nothing is drawn across the gap.
    for (const d of drawn) expect(d.startsWith('M')).toBe(true);
    expect(drawn.join(' ').match(/M/g)).toHaveLength(2);
  });

  it('is black with round joins at the sheet width for each size', () => {
    const large = renderToStaticMarkup(
      <IndexChart label="Legal" points={months([0.1, 0.2])} state="flat" threshold={2} />,
    );
    const small = renderToStaticMarkup(
      <IndexChart label="Legal" points={months([0.1, 0.2])} size="small" state="flat" threshold={2} />,
    );
    expect(large).toContain('stroke-width="1.5"');
    expect(small).toContain('stroke-width="1.25"');
    expect(large).toContain('stroke="#000"');
    expect(large).toContain('stroke-linejoin="round"');
    expect(large).toContain('fill="none"');
  });

  it('draws no dots, no gridlines and no area fill', () => {
    const markup = renderToStaticMarkup(
      <IndexChart label="Legal" points={months([0.1, 0.2, 0.3])} state="flat" threshold={2} />,
    );
    expect(markup).not.toContain('<circle');
    expect(markup).not.toContain('<g class="grid"');
  });
});

describe('the accessible name', () => {
  it('carries the latest value and the threshold', () => {
    const markup = renderToStaticMarkup(
      <IndexChart
        label="Computer and mathematical"
        points={months([0.1, 0.2, 2.35])}
        state="triggered"
        threshold={2}
      />,
    );
    const label = /role="img" aria-label="([^"]*)"|aria-label="([^"]*)"[^>]*role="img"/.exec(markup);
    const name = label?.[1] ?? label?.[2] ?? '';
    expect(name).toContain('2.35');
    expect(name).toContain('2.00');
    expect(name).toContain('Computer and mathematical');
  });

  it('says so when there is no reading yet', () => {
    const markup = renderToStaticMarkup(
      <IndexChart label="Legal" points={months([null, null])} state="flat" threshold={2} />,
    );
    expect(markup).toContain('No reading yet');
  });

  it('shows at most two axis labels on the large chart', () => {
    const markup = renderToStaticMarkup(
      <IndexChart
        label="Legal"
        points={months([0.1, 0.2, 0.3, 0.4, 0.5, 0.6])}
        state="flat"
        threshold={2}
      />,
    );
    const caption = /<figcaption[^>]*>(.*?)<\/figcaption>/s.exec(markup)?.[1] ?? '';
    expect(caption).toContain('Jan 2025');
    expect(caption).toContain('Jun 2025');
    expect(caption).not.toContain('Mar 2025');
    expect(caption).toContain('Pays out above 2.00');
  });
});

describe('the landing size', () => {
  const landing = () =>
    renderToStaticMarkup(
      <IndexChart
        bandLabel="Pays out within 0.68 of average"
        label="Computer and mathematical"
        points={months([-1.4, -1.1, -0.7])}
        size="landing"
        state="flat"
        threshold={-0.9}
      />,
    );

  it('draws the sheet landing stroke', () => {
    expect(landing()).toContain('stroke-width="1.75"');
  });

  it('scales to its box and keeps the stroke in device space', () => {
    const markup = landing();
    expect(markup).toContain('viewBox="0 0 1080 300"');
    expect(markup).toContain('preserveAspectRatio="none"');
    // Neither a width nor a height attribute, so the box decides the pixels.
    expect(markup).not.toMatch(/<svg[^>]*\swidth="/);
    expect(markup).not.toMatch(/<svg[^>]*\sheight="/);
    for (const tag of [...markup.matchAll(/<(path|line)[^>]*>/g)].map((match) => match[0])) {
      expect(tag).toContain('vector-effect="non-scaling-stroke"');
    }
  });

  it('carries the band and the two axis labels, like the large chart', () => {
    const markup = landing();
    expect(markup).toContain('data-testid="index-chart-band"');
    expect(markup).toContain('Pays out within 0.68 of average');
    expect(markup).toContain('Jan 2025');
    expect(markup).toContain('Mar 2025');
  });

  it('leaves the two fixed sizes unscaled', () => {
    const large = renderToStaticMarkup(
      <IndexChart label="Legal" points={months([0.1, 0.2])} state="flat" threshold={2} />,
    );
    expect(large).not.toContain('preserveAspectRatio');
    expect(large).not.toContain('non-scaling-stroke');
    expect(large).toContain('width="320"');
  });
});
