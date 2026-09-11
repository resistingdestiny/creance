import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { SeriesChooser } from '../src/app/invest/series-chooser.js';
import type { SeriesListEntry } from '../src/lib/investor-api.js';

/**
 * The series chooser as one row with a disclosure under it (T52), where it was
 * sixteen pills wrapping four rows deep at the top of the investor page. What
 * is asserted: it is server markup with no script, the row names the series
 * on screen, every series is still a plain link inside it with the one on
 * screen marked, and the identifier is still on every link for anyone who
 * came with one.
 */

function entry(id: string, group: string): SeriesListEntry {
  return {
    series_id: id,
    series_key: '0x00',
    group,
    kind: 'occupation',
    matures_at: '2027-09-04T00:00:00.000Z',
    has_note: true,
    links: { self: `/v1/series/${id}`, coupons: `/v1/series/${id}/coupons` },
  } as SeriesListEntry;
}

const CHOICES = [
  entry('ODI-COMP-2026-01', 'computer_math'),
  entry('ODI-OFFC-2026-01', 'office_admin_support'),
  entry('ODI-LEGL-2026-01', 'legal'),
];

function visibleText(markup: string): string {
  return markup.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

describe('the series chooser', () => {
  const markup = renderToStaticMarkup(
    <SeriesChooser base="/invest" choices={CHOICES} current="ODI-OFFC-2026-01" />,
  );

  it('is a native disclosure, shut, with no script of its own', () => {
    expect(markup).toMatch(/^<details class="group relative mt-6">/);
    expect(markup).not.toContain(' open');
    expect(markup).not.toContain('onClick');
    expect(markup).toContain('<summary');
  });

  it('names the series on screen in the row, by what it covers', () => {
    const summary = /<summary[^>]*>([\s\S]*?)<\/summary>/.exec(markup);
    expect(visibleText(summary?.[1] ?? '')).toBe('Office and administrative support');
    expect(summary?.[0]).toContain('title="ODI-OFFC-2026-01"');
  });

  it('keeps every series a link, in the order the API listed, marking the one on screen', () => {
    const links = [...markup.matchAll(/<a ([^>]*)>([\s\S]*?)<\/a>/g)];
    expect(links).toHaveLength(3);
    expect(links.map((link) => visibleText(link[2] ?? ''))).toStrictEqual([
      'Computer and mathematical',
      'Office and administrative support',
      'Legal',
    ]);
    expect(links[1]?.[1]).toContain('aria-current="page"');
    expect(links[0]?.[1]).not.toContain('aria-current');
    for (const [, attributes] of links) {
      expect(attributes).toMatch(/href="\/invest\?series=ODI-[A-Z]+-2026-01"/);
      expect(attributes).toMatch(/title="ODI-[A-Z]+-2026-01"/);
    }
    expect(markup).toContain('aria-label="Series"');
  });

  it('is the first thing under the row and floats over the page, on a hairline and no shadow', () => {
    expect(markup).toMatch(/<\/summary><nav aria-label="Series" class="absolute [^"]*border-hairline bg-canvas/);
    expect(markup).not.toContain('shadow');
    expect(markup).not.toContain('flex-wrap');
  });

  it('is nothing at all with one series to choose from', () => {
    expect(
      renderToStaticMarkup(<SeriesChooser base="/invest" choices={[CHOICES[0]!]} current="ODI-COMP-2026-01" />),
    ).toBe('');
  });
});
