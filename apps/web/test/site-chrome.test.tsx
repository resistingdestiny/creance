import { readFileSync } from 'node:fs';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AppFrame } from '../src/components/app-frame.js';
import { DesktopFrame } from '../src/components/desktop-frame.js';
import { LandingScreen } from '../src/components/landing/landing-screen.js';
import { SiteFooter, SiteHeader } from '../src/components/site-chrome.js';
import { ExplorerScreen } from '../src/app/index/explorer-screen.js';

import { explorerData } from './explorer-fixtures.js';
import { LIVE } from './landing-fixtures.js';

/**
 * One product, not a set of pages (T50).
 *
 * Before this ticket the landing, the explorer, the worker screens and the
 * investor screens shared nothing: two headers of their own, two with none,
 * and a 390 column centred on bare canvas. What is asserted here is that every
 * frame renders the one header, that the header is the same markup in both of
 * its tones, that the worker and investor frames stand on the same ground, and
 * that the footer is the root layout's and no page's own.
 */

function visibleText(markup: string): string {
  return markup
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function header(markup: string): string {
  return /<header[\s\S]*?<\/header>/.exec(markup)?.[0] ?? '';
}

const day = renderToStaticMarkup(<SiteHeader />);
const night = renderToStaticMarkup(<SiteHeader tone="night" />);

describe('the header', () => {
  it('carries the mark as the way back, and the two other places', () => {
    const mark = /<a[^>]*href="\/"[^>]*>Creance<\/a>/.exec(day)?.[0] ?? '';
    expect(mark).toContain('font-semibold');
    expect(day.match(/href="\/index"/g)).toHaveLength(1);
    expect(day.match(/href="\/invest"/g)).toHaveLength(1);
    expect(visibleText(day)).toBe('Creance The index Investors');
  });

  it('is the same header in both tones, differing only in colour', () => {
    const strip = (markup: string) =>
      markup.replace(/\b(bg|border|text)-(night|canvas|hairline|ink-2|ink|white)(\/\d+)?\b/g, '');
    expect(strip(day)).toBe(strip(night));
    expect(day).toContain('bg-canvas');
    expect(day).toContain('border-hairline');
    expect(night).toContain('bg-night');
    expect(night).toContain('text-white');
    expect(night).not.toContain('text-ink');
  });

  it('stands at the token height with the chrome margins inside the 1280 frame', () => {
    expect(day).toContain('h-chrome');
    expect(day).toContain('max-w-[1280px] px-5 lg:px-10');
  });

  it('hides the two links below the medium breakpoint rather than wrapping', () => {
    for (const label of ['The index', 'Investors']) {
      const link = new RegExp(`<a[^>]*>${label}</a>`).exec(day)?.[0] ?? '';
      expect(link, label).toContain('hidden md:inline-flex');
    }
    expect(day).not.toContain('flex-wrap');
  });

  it('says which place this is, and nothing when it is neither', () => {
    expect(day).not.toContain('aria-current');
    const index = renderToStaticMarkup(<SiteHeader current="index" />);
    expect(/<a[^>]*aria-current="page"[^>]*>The index<\/a>/.test(index)).toBe(true);
    expect(index.match(/aria-current/g)).toHaveLength(1);
  });

  it('runs nothing on scroll and needs no script', () => {
    for (const markup of [day, night]) {
      expect(markup).not.toContain('IntersectionObserver');
      expect(markup).not.toContain('onScroll');
      expect(markup).not.toMatch(/animate-/);
    }
  });
});

describe('the frames', () => {
  const worker = renderToStaticMarkup(
    <AppFrame>
      <main>worker</main>
    </AppFrame>,
  );
  const investor = renderToStaticMarkup(
    <DesktopFrame current="invest">
      <main>investor</main>
    </DesktopFrame>,
  );
  const explorer = renderToStaticMarkup(<ExplorerScreen data={explorerData()} />);
  const landing = renderToStaticMarkup(<LandingScreen data={LIVE} />);

  it('every one of them opens with the header', () => {
    for (const [name, markup] of [
      ['worker', worker],
      ['investor', investor],
      ['explorer', explorer],
      ['landing', landing],
    ] as const) {
      const head = header(markup);
      expect(head, name).toContain('h-chrome');
      expect(head, name).toContain('href="/"');
      expect(head, name).toContain('href="/index"');
      expect(head, name).toContain('href="/invest"');
      expect(markup.match(/<header/g), name).toHaveLength(1);
    }
  });

  it('is the night tone on the landing and the day tone everywhere else', () => {
    expect(header(landing)).toContain('bg-night');
    for (const markup of [worker, investor, explorer]) {
      expect(header(markup)).toContain('bg-canvas');
      expect(markup).not.toContain('bg-night');
    }
  });

  it('stands the worker column and the investor sheet on the same ground', () => {
    // No screen floats a bare column on white: the ground beside the column
    // is surface, the column is a canvas sheet on it with hairline sides, and
    // the investor frame is the same sheet at 1280.
    for (const markup of [worker, investor, explorer]) {
      expect(markup).toContain('flex flex-1 justify-center bg-surface');
    }
    expect(worker).toContain('max-w-[390px] bg-canvas sm:border-x sm:border-hairline');
    expect(investor).toContain('max-w-[1280px] bg-canvas');
    expect(investor).toContain('xl:border-x xl:border-hairline');
    expect(investor).toContain('min-h-frame');
  });

  it('gives the explorer "Get cover" as the header action and marks it current', () => {
    const head = header(explorer);
    expect(/<a[^>]*href="\/"[^>]*>Get cover<\/a>/.test(head)).toBe(true);
    expect(/<a[^>]*aria-current="page"[^>]*>The index<\/a>/.test(head)).toBe(true);
    expect(/<a[^>]*aria-current="page"[^>]*>Investors<\/a>/.test(header(investor))).toBe(true);
  });

  it('gives the landing "Get a quote" as the header action, inverted for the ground', () => {
    const button = /<header[\s\S]*?(<button[^>]*>)/.exec(landing)?.[1] ?? '';
    expect(button).toContain('bg-canvas');
    expect(button).not.toContain('bg-ink');
  });

  it('puts no footer of its own on any of them', () => {
    for (const markup of [worker, investor, explorer, landing]) {
      expect(markup).not.toContain('<footer');
      expect(markup).not.toContain('How the index works');
    }
  });
});

describe('the footer', () => {
  const footer = renderToStaticMarkup(<SiteFooter />);

  it('carries the mark, the two links and the disclosure', () => {
    expect(footer).toContain('href="/index"');
    expect(footer).toContain('href="/invest"');
    expect(visibleText(footer)).toBe(
      'Creance How the index works Investors This is a testnet prototype built for a hackathon. It is not an offer of insurance or securities in any jurisdiction and no real funds are involved.',
    );
    expect(footer).toContain('max-w-[1280px] px-5 lg:px-10');
  });

  it('is rendered by the root layout, under every route, which draws no header', () => {
    // The layout imports the active font through a module alias the framework
    // resolves, so it is read as source rather than rendered here.
    const layout = readFileSync(new URL('../src/app/layout.tsx', import.meta.url), 'utf8');
    expect(layout).toContain('<SiteFooter />');
    expect(layout).not.toContain('SiteHeader');
    expect(layout).not.toContain('<footer');
    expect(layout.indexOf('{children}')).toBeLessThan(layout.indexOf('<SiteFooter />'));
  });
});
