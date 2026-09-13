import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { alt, contentType, size } from '../src/app/opengraph-image.js';

/**
 * The link preview image is static and carries fixed words (T53).
 *
 * An unfurl is a page view a bot makes many times, and the landing figures
 * come from paid reads behind a hold, so the image route may read nothing
 * live and must be prerendered. It is not rendered here, because Satori
 * fetches its fonts and the suite runs without a network; what is held is
 * the route's own contract, and that its source touches no data module, no
 * request time API and no price.
 */

const source = readFileSync(
  fileURLToPath(new URL('../src/app/opengraph-image.tsx', import.meta.url)),
  'utf8',
);

describe('the preview image route', () => {
  it('is 1200 by 630 PNG with alt text in the deck\'s words', () => {
    expect(size).toEqual({ width: 1200, height: 630 });
    expect(contentType).toBe('image/png');
    expect(alt).toBe('Creance. Cover for the day your job is automated.');
  });

  it('is static: no dynamic config and no request time API', () => {
    expect(source).not.toContain('force-dynamic');
    expect(source).not.toContain('revalidate');
    expect(source).not.toMatch(/from 'next\/headers'/);
    expect(source).not.toMatch(/cookies\(|headers\(|searchParams/);
  });

  it('reads no feed, no price and no environment', () => {
    expect(source).not.toMatch(/from '\.\.\/lib\//);
    expect(source).not.toMatch(/from '\.\.\/components\//);
    expect(source).not.toContain('process.env');
    expect(source).not.toMatch(/\/v1\//);
    expect(source).not.toMatch(/a month/);
  });

  it('carries the hero headline and the card at rest, with no price', () => {
    expect(source).toContain("'Cover for the day your job is automated.'");
    expect(source).toContain("'Covered'");
    expect(source).toContain("'5,000'");
    expect(source).not.toMatch(/From \d/);
  });

  it('says the headline and nothing under it', () => {
    // The lead was 27px at 66 percent white. It holds on an unfurl at 500
    // wide and disappears when the same file is a thumbnail in a gallery, so
    // the headline carries the image alone.
    expect(source).not.toContain('A monthly payment now.');
  });

  /**
   * The card here is a redrawing and not a render of CoverCard, so it can fall
   * behind the stylesheet without anything failing. It had: the shimmer was
   * T52's narrow band with a white core, which was rejected, and the edge was
   * the plain hairline rather than the metal modifier's. These are the four
   * rules it redraws, and a change to any of them in globals.css has to land
   * here too.
   */
  it('draws the card the stylesheet draws', () => {
    const sheet = readFileSync(
      fileURLToPath(new URL('../src/app/globals.css', import.meta.url)),
      'utf8',
    );
    const stops = (text: string): string[] =>
      [...text.matchAll(/rgba\(\d+, ?\d+, ?\d+, ?[\d.]+\)|#[0-9a-f]{6}/g)].map((match) =>
        match[0].replaceAll(' ', ''),
      );

    // The metal gradient, the sheen and the shimmer, each against its rule.
    for (const [ours, theirs] of [
      [
        /const METAL = '([^']+)'/.exec(source)?.[1],
        /\.cover-card \{[^}]*background: (linear-gradient\([^;]+)\);/.exec(sheet)?.[1],
      ],
      [
        /const SHEEN =\s*'([^']+)'/.exec(source)?.[1],
        /\.cover-card::before \{[^}]*background: (linear-gradient\([^;]+)\);/.exec(sheet)?.[1],
      ],
      [
        /const SHIMMER =\s*'([^']+)'/.exec(source)?.[1],
        /\.cover-card__shimmer::before \{[^}]*background: (linear-gradient\([\s\S]*?)\);/.exec(
          sheet,
        )?.[1],
      ],
    ]) {
      expect(ours).toBeDefined();
      expect(theirs).toBeDefined();
      expect(stops(ours ?? '')).toEqual(stops(theirs ?? ''));
    }

    // And the metal modifier's edge colour.
    const edge = /\.cover-card--metal \{\s*border-color: (#[0-9a-f]{6});/.exec(sheet)?.[1];
    expect(edge).toBeDefined();
    expect(source).toContain(`const EDGE = '${edge ?? ''}'`);
  });

  it('fetches only the two families of option A, as TrueType, from Google Fonts', () => {
    expect(source.match(/googleFont\('Inter Tight'/g)).toHaveLength(1);
    expect(source.match(/googleFont\('Inter'/g)).toHaveLength(2);
    expect(source).toContain('fonts.googleapis.com/css2');
    expect(source).toContain("format\\('(?:opentype|truetype)'\\)");
  });
});
