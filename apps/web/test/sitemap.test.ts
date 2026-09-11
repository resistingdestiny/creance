import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { isApiPath } from '../src/app/api-proxy.js';
import robots from '../src/app/robots.js';
import sitemap, { PUBLIC_ROUTES } from '../src/app/sitemap.js';

/**
 * The sitemap names real pages and nothing else (T53).
 *
 * robots.ts promised a sitemap for months that nothing served. Now that one
 * exists, what is held here is that every address in it is a page.tsx under
 * src/app that answers without a session, that none of the routes the ticket
 * excludes has crept in, that no API path is listed as if it were a page, and
 * that the two files name the same origin.
 */

const APP_DIR = new URL('../src/app/', import.meta.url);

/** Routes that render only for one person, redirect without a session, or say noindex. */
const EXCLUDED = [
  '/gallery',
  '/home/demo',
  '/amount',
  '/verify',
  '/pay',
  '/claim',
  '/claim/job',
  '/claim/proof',
  '/claim/review',
  '/claim/confirm',
  '/claim/status',
  '/cover/index',
  '/receipt',
  '/admin/claims',
  '/invest/subscribe',
];

function pathnames(): string[] {
  return sitemap().map((entry) => new URL(entry.url).pathname);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the sitemap', () => {
  it('lists only pages that exist', () => {
    for (const path of pathnames()) {
      const page = new URL(`.${path === '/' ? '' : path}/page.tsx`, APP_DIR);
      expect(existsSync(fileURLToPath(page)), path).toBe(true);
    }
  });

  it('lists the five public routes and no more', () => {
    expect(pathnames()).toEqual([...PUBLIC_ROUTES]);
    expect(pathnames()).toHaveLength(5);
  });

  it('lists none of the excluded routes', () => {
    for (const path of pathnames()) {
      for (const excluded of EXCLUDED) {
        expect(path === excluded || path.startsWith(`${excluded}/`), path).toBe(false);
      }
    }
  });

  it('lists no API path and no description file', () => {
    for (const path of pathnames()) {
      expect(isApiPath(path), path).toBe(false);
      expect(path, path).not.toMatch(/\.(txt|md|json)$/);
    }
  });

  it('carries only addresses, no dates and no guessed frequencies', () => {
    for (const entry of sitemap()) {
      expect(Object.keys(entry)).toEqual(['url']);
    }
  });

  it('is what robots.txt points at, on the same origin', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://example.test');
    const promised = robots().sitemap;
    expect(promised).toBe('https://example.test/sitemap.xml');
    const site = new URL(promised as string);
    for (const entry of sitemap()) {
      expect(new URL(entry.url).origin).toBe(site.origin);
    }
    expect(existsSync(fileURLToPath(new URL('sitemap.ts', APP_DIR)))).toBe(true);
  });

  it('keeps the default origin robots.txt has, when nothing is configured', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
    // An empty string is a configured value to `??`, so unset it outright.
    delete process.env.NEXT_PUBLIC_SITE_URL;
    expect(new URL(robots().sitemap as string).origin).toBe('https://creance.co');
    expect(new URL(sitemap()[0]?.url as string).origin).toBe('https://creance.co');
  });

  it('never lists a route that robots.txt disallows', () => {
    const disallowed = robots().rules;
    const rules = Array.isArray(disallowed) ? disallowed : [disallowed];
    const banned = rules.flatMap((rule) =>
      Array.isArray(rule.disallow) ? rule.disallow : rule.disallow ? [rule.disallow] : [],
    );
    expect(banned).toContain('/gallery');
    for (const path of pathnames()) {
      expect(banned, path).not.toContain(path);
    }
  });

  it('is served by a file convention the framework knows, at the promised path', () => {
    // A metadata route: src/app/sitemap.ts answers /sitemap.xml. The name is
    // what makes it one, so a rename would silently break robots.txt again.
    const source = readFileSync(fileURLToPath(new URL('sitemap.ts', APP_DIR)), 'utf8');
    expect(source).toContain('MetadataRoute.Sitemap');
  });
});
