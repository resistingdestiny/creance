import { apiBaseUrl } from '../lib/api';

/**
 * The API's paths, answered on the web app's origin.
 *
 * Every URL in the description files an agent reads is the public origin,
 * `https://creance.co`, and so is the single `servers` entry of both OpenAPI
 * documents and the `resource` an x402 challenge names. The API also runs on an
 * origin of its own. Without something joining the two, `llms.txt` teaches an
 * agent six addresses that do not answer, which is the failure the file exists
 * to prevent. See docs/DECISIONS.md, "The API's paths answer on the web origin".
 *
 * The same split `deploy/Caddyfile` makes at the edge, made here in the app, so
 * it holds wherever the app runs and not only behind that one site file. A
 * request that reaches Caddy first never gets here: Caddy hands these paths to
 * the API and this app is not asked.
 *
 * `/openapi.json` is deliberately not in the list. It is the cover gateway's
 * document and it is a real file in `public/`, which the framework serves
 * before any of this. `/openapi/index.json` is the index feed's, and it is the
 * API's.
 */
export const API_PATHS = [
  '/llms.txt',
  '/skill.md',
  '/openapi/index.json',
  '/health',
  '/healthz',
  '/.well-known/jwks.json',
  '/v1/*',
] as const;

/** Whether a path on this origin belongs to the API rather than to a screen. */
export function isApiPath(pathname: string): boolean {
  return API_PATHS.some((pattern) =>
    pattern.endsWith('/*')
      ? pathname === pattern.slice(0, -2) || pathname.startsWith(pattern.slice(0, -1))
      : pathname === pattern,
  );
}

/**
 * Headers that describe one hop and must not be forwarded to the next.
 *
 * `accept-encoding` and `content-length` go with them because fetch sets both
 * for the request it makes, and on the way back it has already decoded the
 * body, so the origin's `content-encoding` and `content-length` would describe
 * bytes the caller is not being given.
 */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

const DROP_FROM_REQUEST = new Set([...HOP_BY_HOP, 'host', 'accept-encoding', 'content-length']);
const DROP_FROM_RESPONSE = new Set([...HOP_BY_HOP, 'content-encoding', 'content-length']);

function forward(headers: Headers, drop: Set<string>): Headers {
  const kept = new Headers();
  headers.forEach((value, name) => {
    if (!drop.has(name.toLowerCase())) kept.append(name, value);
  });
  return kept;
}

/**
 * Hand a request to the API and return its answer unchanged.
 *
 * Everything but the hop headers is passed both ways, because a caller of these
 * paths is an agent paying for a reading: `PAYMENT-SIGNATURE` goes up,
 * `PAYMENT-REQUIRED` and `PAYMENT-RESPONSE` come back with the 402 and the 200,
 * and a content type is what tells an importer whether it has a spec or a page.
 *
 * The body is read whole rather than streamed. Every request these paths take
 * is a small JSON document or nothing at all, and a stream would need the
 * half-duplex flag and buy nothing here.
 */
export async function proxyToApi(request: Request): Promise<Response> {
  const { pathname, search } = new URL(request.url);
  const target = `${apiBaseUrl()}${pathname}${search}`;
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';

  let response: Response;
  try {
    response = await fetch(target, {
      method: request.method,
      headers: forward(request.headers, DROP_FROM_REQUEST),
      body: hasBody ? await request.arrayBuffer() : undefined,
      redirect: 'manual',
      cache: 'no-store',
    });
  } catch (error) {
    return unreachable(pathname, error);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: forward(response.headers, DROP_FROM_RESPONSE),
  });
}

/**
 * The API did not answer at all.
 *
 * RFC 9457, the shape every error from these paths already has, so a client
 * that switches on `code` is not handed a framework error page in HTML when the
 * one thing between it and the API is down.
 */
function unreachable(pathname: string, error: unknown): Response {
  const detail = error instanceof Error ? error.message : 'The API did not answer.';
  return new Response(
    JSON.stringify({
      type: 'about:blank',
      title: 'Bad Gateway',
      status: 502,
      detail,
      instance: pathname,
      code: 'api_unreachable',
      request_id: 'none',
      retryable: true,
    }),
    { status: 502, headers: { 'content-type': 'application/problem+json; charset=utf-8' } },
  );
}
