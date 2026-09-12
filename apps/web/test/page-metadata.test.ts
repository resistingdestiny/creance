import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { Metadata } from 'next';
import { describe, expect, it } from 'vitest';

import { PUBLIC_ROUTES } from '../src/app/sitemap.js';

/**
 * Every public page says what it is (T53).
 *
 * A shared link unfurls from the page's title and description, so each route
 * the sitemap lists is read here for a title of its own, a description in a
 * sentence, and a canonical that names the route. The root layout is read for
 * the site wide Open Graph and Twitter blocks, and for carrying no title,
 * description or image of its own in them, which is what lets each page's
 * own words become the preview. The layout is not imported: it pulls in the
 * font switch, so the source is read for the two blocks instead.
 */

const PAGES: Record<(typeof PUBLIC_ROUTES)[number], () => Promise<{ metadata: Metadata }>> = {
  '/': () => import('../src/app/page.js'),
  '/index': () => import('../src/app/index/page.js'),
  '/activity': () => import('../src/app/activity/page.js'),
  '/invest': () => import('../src/app/invest/page.js'),
  '/occupation': () => import('../src/app/occupation/page.js'),
  '/home': () => import('../src/app/home/page.js'),
};

function titleOf(metadata: Metadata): string {
  const title = metadata.title;
  if (typeof title === 'string') return title;
  if (title !== null && typeof title === 'object' && 'absolute' in title) {
    return title.absolute ?? '';
  }
  return '';
}

describe.each(PUBLIC_ROUTES)('%s', (path) => {
  it('has a title, a description in a sentence and a canonical of its own', async () => {
    const { metadata } = await PAGES[path]();
    const title = titleOf(metadata);
    expect(title.length).toBeGreaterThan(0);
    expect(title).not.toBe('Creance');
    const description = metadata.description ?? '';
    expect(description.length).toBeGreaterThan(40);
    expect(description.length).toBeLessThan(320);
    expect(description).toMatch(/\.$/);
    expect(metadata.alternates?.canonical).toBe(path);
  });

  it('names no price and no figure that lives on the page', async () => {
    const { metadata } = await PAGES[path]();
    const text = `${titleOf(metadata)} ${metadata.description ?? ''}`;
    expect(text).not.toMatch(/\d+\.\d\d/);
    expect(text).not.toMatch(/percent/);
  });

  it('is written in the deck\'s voice, without dashes', async () => {
    const { metadata } = await PAGES[path]();
    const text = `${titleOf(metadata)} ${metadata.description ?? ''}`;
    expect(text).not.toMatch(/[\u2013\u2014]/);
    for (const banned of ['policy bound', 'bind', 'parametric', 'nullifier', 'on-chain']) {
      expect(text.toLowerCase(), banned).not.toContain(banned);
    }
  });

  it('does not say noindex', async () => {
    const { metadata } = await PAGES[path]();
    expect(metadata.robots).toBeUndefined();
  });
});

describe('the front door', () => {
  it('carries an absolute title, so the site template does not follow its full stop', async () => {
    const { metadata } = await PAGES['/']();
    expect(metadata.title).toEqual({ absolute: 'Creance: cover for the day your job is automated' });
  });
});

describe('the root layout', () => {
  const source = readFileSync(fileURLToPath(new URL('../src/app/layout.tsx', import.meta.url)), 'utf8');

  it('carries the site wide Open Graph and Twitter blocks', () => {
    expect(source).toContain("openGraph: {");
    expect(source).toContain("type: 'website'");
    expect(source).toContain("siteName: 'Creance'");
    expect(source).toContain("card: 'summary_large_image'");
    expect(source).toContain('metadataBase: new URL(siteUrl)');
  });

  it('leaves the title, the description and the image to each page and to the image route', () => {
    const openGraph = /openGraph: \{[\s\S]*?\},/.exec(source)?.[0] ?? '';
    const twitter = /twitter: \{[\s\S]*?\},/.exec(source)?.[0] ?? '';
    for (const block of [openGraph, twitter]) {
      expect(block.length).toBeGreaterThan(0);
      expect(block).not.toContain('title');
      expect(block).not.toContain('description');
      expect(block).not.toContain('images');
    }
  });
});

describe('the two pages that stay out of the indexes', () => {
  it('still say so', async () => {
    const { metadata: demo } = await import('../src/app/home/demo/page.js');
    const { metadata: gallery } = await import('../src/app/gallery/page.js');
    expect(demo.robots).toEqual({ index: false, follow: false });
    expect(gallery.robots).toEqual({ index: false, follow: false });
  });
});
