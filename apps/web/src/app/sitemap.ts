import type { MetadataRoute } from 'next';

/**
 * The pages a crawler is sent to (T53). robots.ts has promised this file since
 * T29 and nothing served it, which is a worse promise than none.
 *
 * What is here is every route that answers a request with no session and no
 * cover: the front door, the index, the investor overview, the occupation
 * picker and the sign in screen. What is not here, and why:
 *
 * - /gallery and /home/demo say noindex themselves, the one because it is a
 *   component sheet and the other because it prints cover keys in its markup.
 * - /amount, /verify and /pay redirect to /occupation without a purchase
 *   session, /claim and everything under it redirects without a cover, and
 *   /cover/index redirects to the front door, so a crawler would never see a
 *   page at any of them.
 * - /receipt/[policyId] and /admin/claims belong to one person.
 * - /invest/subscribe is a step inside the investor flow, reached from the
 *   overview, and the overview is what a search should land on.
 * - /invest?series=<id> is not listed because the series come from
 *   GET /v1/series at request time and an id baked in here could name a
 *   series the list no longer carries.
 * - /llms.txt, /skill.md, /openapi/*, /v1/*, /health, /healthz and
 *   /.well-known/jwks.json are the API's paths, proxied by api-proxy.ts.
 *   They are documents for agents, not pages, and they have llms.txt as their
 *   index already.
 *
 * The origin is the same setting robots.ts reads, with the same default, so
 * the two files cannot name different hosts. test/sitemap.test.ts holds every
 * entry to an existing page.tsx and to the exclusions above.
 */

/** The public routes, as paths. Each is a page.tsx under src/app. */
export const PUBLIC_ROUTES = ['/', '/index', '/invest', '/occupation', '/home'] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://creance.co';
  // No lastModified and no changeFrequency: the first would be a build time
  // stamp pretending to be an edit date, and the second is a guess a crawler
  // does not act on. A list of addresses is the honest file.
  return PUBLIC_ROUTES.map((path) => ({ url: path === '/' ? `${site}/` : `${site}${path}` }));
}
