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
 * One product, not a set of pages (T50), and one header, not three (T52).
 *
 * Before T50 the landing, the explorer, the worker screens and the investor
 * screens shared nothing: two headers of their own, two with none, and a 390
 * column centred on bare canvas. T50 made the header one component in two
 * tones, and Root still saw three headers: a dark one with "Get a quote", a
 * light one with "Get cover", a light one with nothing. What is asserted here
 * is that every frame renders the one header, that it is the night ground with
 * the same action on every one of them, what ground each frame stands on, and
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

describe('the header', () => {
  it('carries the mark as the way back, the two other places and the action', () => {
    const mark = /<a[^>]*href="\/"[^>]*>Creance<\/a>/.exec(day)?.[0] ?? '';
    expect(mark).toContain('font-semibold');
    expect(day.match(/href="\/index"/g)).toHaveLength(1);
    expect(day.match(/href="\/invest"/g)).toHaveLength(1);
    expect(visibleText(day)).toBe('Creance The index Earn yield Get a quote');
  });

  it('is the night ground, with the text rules for that ground', () => {
    // One tone. The day tone went with T52: the header band is night on every
    // route, and the content under it is what stays light.
    expect(day).toContain('bg-night');
    expect(day).toContain('data-tone="night"');
    expect(day).toContain('text-white');
    expect(day).not.toContain('text-ink-2');
    expect(day).not.toContain('bg-canvas"');
  });

  it('draws the action inverted for the ground, as a link to the front door', () => {
    // A primary pill is bg-ink, which is black on #0A0D12 and invisible. The
    // action is the night variant, and it is a link because from any route but
    // the landing there is nothing to open in place.
    const action = /<a[^>]*href="\/"[^>]*>Get a quote<\/a>/.exec(day)?.[0] ?? '';
    expect(action).toContain('bg-canvas');
    expect(action).toContain('text-ink');
    expect(action).not.toContain('bg-ink');
  });

  it('stands at the token height with the chrome margins inside the 1280 frame', () => {
    expect(day).toContain('h-chrome');
    expect(day).toContain('max-w-[1280px] px-5 lg:px-10');
  });

  it('hides the two links below the medium breakpoint rather than wrapping', () => {
    for (const label of ['The index', 'Earn yield']) {
      const link = new RegExp(`<a[^>]*>${label}</a>`).exec(day)?.[0] ?? '';
      expect(link, label).toContain('max-md:hidden');
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
    expect(day).not.toContain('IntersectionObserver');
    expect(day).not.toContain('onScroll');
    expect(day).not.toMatch(/animate-/);
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

  it('is the night ground on every one of them, and the content under it is not', () => {
    for (const [name, markup] of [
      ['worker', worker],
      ['investor', investor],
      ['explorer', explorer],
      ['landing', landing],
    ] as const) {
      expect(header(markup), name).toContain('bg-night');
    }
    // The night ground travelled to the header band and to nothing else: the
    // three product frames carry it once, in the header, and stay light below.
    for (const markup of [worker, investor, explorer]) {
      expect(markup.match(/bg-night/g)).toHaveLength(1);
      expect(markup).not.toContain('bg-night-2');
    }
  });

  it('carries the same action with the same words on every one of them', () => {
    for (const markup of [worker, investor, explorer]) {
      const head = header(markup);
      expect(/<a[^>]*href="\/"[^>]*>Get a quote<\/a>/.test(head)).toBe(true);
      expect(head).not.toContain('Get cover');
    }
    // The landing's is a button, because there the quote opens in place; the
    // words and the treatment are the same.
    const button = /(<button[^>]*>)<span>Get a quote<\/span>/.exec(header(landing))?.[1] ?? '';
    expect(button).toContain('bg-canvas');
    expect(button).not.toContain('bg-ink');
    expect(/<a[^>]*aria-current="page"[^>]*>The index<\/a>/.test(header(explorer))).toBe(true);
    expect(/<a[^>]*aria-current="page"[^>]*>Earn yield<\/a>/.test(header(investor))).toBe(true);
  });

  it('stands the worker column on its sheet and the desktop page on continuous canvas', () => {
    // The 390 column is a canvas sheet on surface with hairline sides, because
    // beside it the ground is most of the screen. The desktop page has no
    // sheet since T52: canvas from the header to the footer, and the 1280
    // frame is a measure for the content, as it is for the header.
    expect(worker).toContain('flex flex-1 justify-center bg-surface');
    expect(worker).toContain('max-w-[390px] bg-canvas sm:border-x sm:border-hairline');
    for (const markup of [investor, explorer]) {
      expect(markup).toContain('flex flex-1 flex-col bg-canvas');
      expect(markup).toContain('min-h-frame py-12 mx-auto w-full max-w-[1280px] px-5 lg:px-10');
      expect(markup).not.toContain('justify-center bg-surface');
      expect(markup).not.toContain('border-x');
    }
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
