import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { API_PATHS, isApiPath, proxyToApi } from '../src/app/api-proxy.js';

/**
 * The paths this origin promises an agent.
 *
 * The description files and both OpenAPI documents carry one origin, the public
 * one, in every URL and in their single `servers` entry. This app is what
 * answers on that origin, so what is checked here is that every address those
 * files teach is an address this app routes: an agent which follows a link out
 * of `llms.txt` and gets the framework's not-found page has been given a
 * description file worse than none, and that is what T46 found in production.
 *
 * The generated files are read from the repository rather than restated, so a
 * new link in `llms.txt` that nothing serves fails here.
 */

const REPO = new URL('../../../', import.meta.url);
const AGENTIFY = new URL('recipes/bazantic/agentify/', REPO);
const PUBLIC_DIR = new URL('apps/web/public/', REPO);
const APP_DIR = new URL('apps/web/src/app/', REPO);

function read(url: URL): string {
  return readFileSync(fileURLToPath(url), 'utf8');
}

/** The origin the generator writes into every file, taken from a file. */
const ORIGIN = (
  JSON.parse(read(new URL('openapi.json', AGENTIFY))) as { servers: { url: string }[] }
).servers[0]?.url as string;

/** Every path on the public origin that a generated file points a caller at. */
function promisedPaths(): string[] {
  const found = new Set<string>();
  const texts = [
    read(new URL('llms.txt', AGENTIFY)),
    read(new URL('SKILL.md', AGENTIFY)),
    read(new URL('README.md', AGENTIFY)),
    // The cover gateway's README, which names /health as the check to point a
    // judge at. docs/SUBMISSION.md names URLs too and is deliberately not read
    // here: it is written by hand outside this app and a test that fails on
    // somebody else's sentence is a test nobody keeps.
    read(new URL('recipes/bazantic/README.md', REPO)),
  ];
  for (const text of texts) {
    for (const match of text.matchAll(/https?:\/\/[^\s)`,"]+/g)) {
      const url = match[0].replace(/[.,]$/, '');
      if (!url.startsWith(`${ORIGIN}/`)) continue;
      const { pathname } = new URL(url);
      // `https://creance.co/errors/<code>` is the `type` of a problem document.
      // RFC 9457 section 3.1.1 makes that an identifier and tells a consumer not
      // to dereference it, so it is not an address this origin owes an answer at.
      if (pathname.startsWith('/errors/')) continue;
      found.add(pathname);
    }
  }
  // Both documents describe their paths against the same one server.
  for (const file of [
    new URL('openapi.json', AGENTIFY),
    new URL('recipes/bazantic/openapi.json', REPO),
  ]) {
    const document = JSON.parse(read(file)) as {
      servers: { url: string }[];
      paths: Record<string, unknown>;
    };
    expect(document.servers[0]?.url).toBe(ORIGIN);
    for (const path of Object.keys(document.paths)) {
      found.add(path.replace(/\{[^}]+\}/g, 'computer_math'));
    }
  }
  return [...found].sort();
}

/** Where a path is answered from, or null when nothing here answers it. */
function servedBy(pathname: string): string | null {
  if (isApiPath(pathname)) return 'the API';
  const file = new URL(`.${pathname}`, PUBLIC_DIR);
  if (existsSync(fileURLToPath(file))) return 'public/';
  const route = new URL(`.${pathname}/route.ts`, APP_DIR);
  const page = new URL(`.${pathname}/page.tsx`, APP_DIR);
  if (existsSync(fileURLToPath(route)) || existsSync(fileURLToPath(page))) return 'a route';
  return null;
}

describe('the URLs the generated files promise', () => {
  it('are all answered on this origin', () => {
    const unanswered = promisedPaths().filter((path) => servedBy(path) === null);
    expect(unanswered).toEqual([]);
  });

  it('include the three description files and the index feed', () => {
    // A guard on the guard: if the extraction above ever stopped finding URLs
    // the assertion would pass on an empty list.
    const paths = promisedPaths();
    for (const path of [
      '/llms.txt',
      '/skill.md',
      '/openapi/index.json',
      '/v1/index',
      '/v1/replay',
      '/v1/attribution',
    ]) {
      expect(paths, path).toContain(path);
    }
  });

  it('reach the cover document from public/, not from the API', () => {
    expect(servedBy('/openapi.json')).toBe('public/');
    expect(servedBy('/openapi/index.json')).toBe('the API');
  });
});

describe('the API paths this app routes', () => {
  it('each have a route file, so deleting one fails here', () => {
    for (const pattern of API_PATHS) {
      const segment = pattern.endsWith('/*') ? `${pattern.slice(0, -2)}/[...path]` : pattern;
      const route = new URL(`.${segment}/route.ts`, APP_DIR);
      expect(existsSync(fileURLToPath(route)), pattern).toBe(true);
    }
  });

  it('are all paths the site file also hands to the API at the edge', () => {
    // Two places route the same split, one in front of the other, and they have
    // to agree: a path this app proxies but Caddy sends to the web app would
    // loop, and a path Caddy sends to the API but this app owns would answer
    // differently depending on which deployment is in front of it.
    const caddy = read(new URL('deploy/Caddyfile', REPO));
    const matcher = (/@api path (.+)/.exec(caddy)?.[1] ?? '').trim().split(/\s+/);
    expect(matcher.length).toBeGreaterThan(1);
    const covers = (pattern: string, path: string): boolean =>
      pattern.endsWith('/*')
        ? path === pattern.slice(0, -2) || path.startsWith(pattern.slice(0, -1))
        : path === pattern;
    for (const pattern of API_PATHS) {
      const path = pattern.endsWith('/*') ? `${pattern.slice(0, -2)}/index` : pattern;
      expect(matcher.some((edge) => covers(edge, path)), pattern).toBe(true);
    }
  });

  it('do not claim a path a screen owns', () => {
    for (const pathname of ['/', '/home', '/index', '/pay', '/openapi.json']) {
      expect(isApiPath(pathname), pathname).toBe(false);
    }
  });
});

describe('the proxy', () => {
  const original = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = original;
    delete process.env.CREANCE_API_URL;
    vi.restoreAllMocks();
  });

  /** What the proxy passes to fetch, named so the assertions below can read it. */
  type Call = { method: string; headers: Headers; body?: ArrayBuffer };

  function answer(response: Response) {
    const stub = vi.fn<(target: string, init: Call) => Promise<Response>>(async () => response);
    globalThis.fetch = stub as unknown as typeof fetch;
    return stub;
  }

  it('asks the API for the same path and query, on the configured origin', async () => {
    process.env.CREANCE_API_URL = 'http://api:3210';
    const stub = answer(new Response('ok'));
    await proxyToApi(new Request('https://creance.co/v1/index?group=computer_math'));
    expect(stub.mock.calls[0]?.[0]).toBe('http://api:3210/v1/index?group=computer_math');
  });

  it('passes the payment headers up and the answer back untouched', async () => {
    const stub = answer(
      new Response('{"code":"payment_required"}', {
        status: 402,
        headers: { 'content-type': 'application/problem+json', 'payment-required': 'a challenge' },
      }),
    );
    const response = await proxyToApi(
      new Request('https://creance.co/v1/index/computer_math', {
        headers: { 'payment-signature': 'a signature', accept: 'application/json' },
      }),
    );
    const sent = stub.mock.calls[0]?.[1];
    expect(sent?.headers.get('payment-signature')).toBe('a signature');
    expect(sent?.headers.get('host')).toBeNull();
    expect(response.status).toBe(402);
    expect(response.headers.get('payment-required')).toBe('a challenge');
    expect(response.headers.get('content-type')).toBe('application/problem+json');
    expect(await response.text()).toBe('{"code":"payment_required"}');
  });

  it('sends the method and the body a paid call needs', async () => {
    const stub = answer(new Response('{}', { status: 201 }));
    await proxyToApi(
      new Request('https://creance.co/v1/bind', {
        method: 'POST',
        body: '{"quote_id":"q_1"}',
        headers: { 'content-type': 'application/json' },
      }),
    );
    const sent = stub.mock.calls[0]?.[1];
    expect(sent?.method).toBe('POST');
    expect(new TextDecoder().decode(sent?.body)).toBe('{"quote_id":"q_1"}');
  });

  it('answers a problem document, not a page, when the API is down', async () => {
    globalThis.fetch = (async () => {
      throw new Error('connect ECONNREFUSED');
    }) as unknown as typeof fetch;
    const response = await proxyToApi(new Request('https://creance.co/llms.txt'));
    expect(response.status).toBe(502);
    expect(response.headers.get('content-type')).toContain('application/problem+json');
    const body = (await response.json()) as { code: string; retryable: boolean };
    expect(body.code).toBe('api_unreachable');
    expect(body.retryable).toBe(true);
  });
});
