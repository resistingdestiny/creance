import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { explorerData } from './explorer-fixtures.js';
import { LIVE } from './landing-fixtures.js';

/**
 * Every public page has one h1 and a heading outline with no level skipped
 * (T53).
 *
 * The index page had its h1 followed by the explorer's four h3 method steps:
 * the panel was written for the landing page, where it sits under an h2, and
 * carried that level with it. Its step heading is a prop now, so both pages
 * are read here from the same markup a crawler gets, and the landing's
 * outline is held where it was.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  redirect: vi.fn(),
}));

vi.mock('../src/app/purchase-actions.js', () => ({
  connectWallet: vi.fn(),
  useDemoWallet: vi.fn(),
  beginPurchase: vi.fn(),
  chooseOccupation: vi.fn(),
  completeWorldCheck: vi.fn(),
  openWithCoverKey: vi.fn(),
  priceCover: vi.fn(),
  signInWithWorld: vi.fn(),
  startSignInCheck: vi.fn(),
  startWorldCheck: vi.fn(),
  verifyPerson: vi.fn(),
}));

const { ExplorerScreen } = await import('../src/app/index/explorer-screen.js');
const { LandingScreen } = await import('../src/components/landing/landing-screen.js');
const { OccupationPicker } = await import('../src/app/occupation/occupation-picker.js');
const { SignInScreen } = await import('../src/app/home/sign-in-screen.js');
const { OCCUPATIONS } = await import('../src/lib/occupations.js');

/** The heading levels of a document, in source order. */
function outline(markup: string): number[] {
  return [...markup.matchAll(/<h([1-6])[\s>]/g)].map((match) => Number(match[1]));
}

/** True when no heading is more than one level deeper than the one before it. */
function noSkips(levels: number[]): boolean {
  let deepest = 0;
  for (const level of levels) {
    if (level > deepest + 1) return false;
    deepest = level;
  }
  return true;
}

const pages = {
  '/': () => renderToStaticMarkup(<LandingScreen data={LIVE} />),
  '/index': () => renderToStaticMarkup(<ExplorerScreen attribution={null} data={explorerData()} />),
  '/occupation': () => renderToStaticMarkup(<OccupationPicker chosen={null} rows={OCCUPATIONS} />),
  '/home': () => renderToStaticMarkup(<SignInScreen world />),
};

describe.each(Object.entries(pages))('%s', (_path, render) => {
  const levels = outline(render());

  it('has one h1', () => {
    expect(levels.filter((level) => level === 1)).toHaveLength(1);
    expect(levels[0]).toBe(1);
  });

  it('skips no heading level', () => {
    expect(noSkips(levels), levels.join(' ')).toBe(true);
  });
});

describe('the explorer steps', () => {
  it('are h2s on the index page, straight under its h1', () => {
    const markup = pages['/index']();
    expect(markup.match(/<h2[^>]*>(Your job|Compared with everyone else|Smoothed over three months|The line)<\/h2>/g)).toHaveLength(4);
    expect(markup).not.toContain('<h3');
  });

  it('stay h3s on the landing page, under its h2', () => {
    const markup = pages['/']();
    expect(markup.match(/<h3[^>]*>(Your job|Compared with everyone else|Smoothed over three months|The line)<\/h3>/g)).toHaveLength(4);
  });
});

describe('images', () => {
  it('all carry alt text on the public pages', () => {
    for (const [path, render] of Object.entries(pages)) {
      for (const img of render().matchAll(/<img[^>]*>/g)) {
        expect(img[0], `${path}: ${img[0]}`).toMatch(/\balt="/);
      }
    }
  });
});
