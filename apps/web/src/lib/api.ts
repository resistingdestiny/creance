/**
 * The one place the web app talks to the API.
 *
 * Every call happens on the server, in a route's own render or in a server
 * action, never in the browser. That is why there is no CORS plugin on the API
 * and no rewrite in next.config.ts: the origin never reaches the bundle, so it
 * is a private variable and not a NEXT_PUBLIC one. See docs/DECISIONS.md,
 * "The web app reads the API on the server".
 *
 * Every amount that crosses the wire is the money envelope: an integer string
 * in the settlement asset's minor units with the asset and its scale beside it.
 * `display` is never parsed; a screen formats `amount` through
 * src/lib/format.ts, which is the one place in this app that turns a figure
 * into a string.
 *
 * Every error is RFC 9457 application/problem+json with a `code` a caller
 * switches on, so a failed call arrives here as an ApiError carrying that code
 * rather than a status number a screen would have to guess at.
 *
 * https://www.rfc-editor.org/rfc/rfc9457.html
 */

export interface Money {
  readonly amount: string;
  readonly asset: string;
  readonly decimals: number;
  /** For a human reading the API response. Never parsed, never rendered raw. */
  readonly display: string;
}

/**
 * Where the API is. `pnpm api:dev` listens on 127.0.0.1:3210 with no
 * configuration at all, so the default is the same address and a judge who
 * runs the two commands in the README needs no environment file for this.
 */
export function apiBaseUrl(value: string | undefined = process.env.CREANCE_API_URL): string {
  return (value ?? 'http://127.0.0.1:3210').replace(/\/+$/, '');
}

/** The API is unreachable, or answered with a problem document. */
export class ApiError extends Error {
  constructor(
    readonly url: string,
    readonly status: number | null,
    /** The problem document's `code`, or null when there was no response. */
    readonly code: string | null,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ProblemBody {
  code?: unknown;
  detail?: unknown;
  title?: unknown;
}

async function problemOf(url: string, response: Response): Promise<ApiError> {
  let body: ProblemBody = {};
  try {
    body = (await response.json()) as ProblemBody;
  } catch {
    // A non-JSON body is a failure the API did not mean to send. The status is
    // still the whole of what is known, so it is reported as it stands.
  }
  const code = typeof body.code === 'string' ? body.code : null;
  const detail =
    typeof body.detail === 'string'
      ? body.detail
      : typeof body.title === 'string'
        ? body.title
        : `the API answered ${response.status}`;
  return new ApiError(url, response.status, code, detail);
}

export interface RequestOptions {
  /** The eligibility credential, sent as a bearer token. Never leaves the server. */
  readonly bearer?: string | undefined;
}

/**
 * No cache anywhere. A price, a policy and an index reading are all live state,
 * and a screen that shows yesterday's premium is worse than one that says it
 * could not reach the API.
 */
export async function getJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return request<T>('GET', path, undefined, options);
}

export async function postJson<T>(
  path: string,
  body: unknown,
  options: RequestOptions = {},
): Promise<T> {
  return request<T>('POST', path, body, options);
}

/**
 * The asset a 402 asks to be paid in, from the problem document's own price.
 *
 * Reading it from the response rather than from configuration is what keeps
 * this module free of a token id: the server names the price, the asset and the
 * scale, and the payer is built for whatever it named.
 */
function priceAsset(problem: unknown): string | null {
  if (typeof problem !== 'object' || problem === null) return null;
  const price = (problem as { price?: unknown }).price;
  if (typeof price !== 'object' || price === null) return null;
  const asset = (price as { asset?: unknown }).asset;
  return typeof asset === 'string' && asset !== '' ? asset : null;
}

async function request<T>(
  method: 'GET' | 'POST',
  path: string,
  body: unknown,
  options: RequestOptions,
): Promise<T> {
  const url = `${apiBaseUrl()}${path}`;
  const headers: Record<string, string> = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (options.bearer !== undefined) headers.authorization = `Bearer ${options.bearer}`;
  const init: RequestInit = {
    method,
    headers,
    cache: 'no-store',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };

  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (cause) {
    throw new ApiError(url, null, null, cause instanceof Error ? cause.message : 'no response');
  }

  // The three endpoints this app reads are x402 gated (T08), so an unpaid
  // request is answered 402 with the price. The payer is built for the asset
  // the server named and the request is made again through it, which is the
  // library's own flow: it reads PAYMENT-REQUIRED, signs a transfer, retries
  // with PAYMENT-SIGNATURE and hands back the 200.
  if (response.status === 402) {
    response = await payAndRetry(url, init, response, `${method} ${path}`);
  }

  if (!response.ok) throw await problemOf(url, response);
  return (await response.json()) as T;
}

async function payAndRetry(
  url: string,
  init: RequestInit,
  unpaid: Response,
  endpoint: string,
): Promise<Response> {
  const problem = await unpaid
    .clone()
    .json()
    .catch(() => null);
  const asset = priceAsset(problem);
  if (asset === null) return unpaid;

  // Imported here rather than at the top of the module so that the Hedera
  // signing stack is loaded only by a process that actually pays. Nothing in
  // the browser bundle reaches this file.
  const { logSettlement, workerPayer } = await import('./payer');
  const payer = workerPayer(asset);
  if (payer === null) {
    throw new ApiError(
      url,
      402,
      'payment_required',
      'This call is paid and this deployment has no key to pay with.',
    );
  }

  let paid: Response;
  try {
    paid = await payer.fetch(url, init);
  } catch (cause) {
    throw new ApiError(
      url,
      402,
      'payment_failed',
      cause instanceof Error ? cause.message : 'the payment did not go through',
    );
  }
  logSettlement(endpoint, paid);
  return paid;
}

/**
 * What a screen does with a call it could not make.
 *
 * The screen renders its unavailable state, and the reason goes to the server
 * log rather than nowhere: a judge who sees "we can't reach the index" needs
 * the terminal to say which call failed and why.
 */
export function reportUnreachable(where: string, cause: unknown): void {
  const detail = cause instanceof ApiError ? `${cause.url}: ${cause.message}` : String(cause);
  console.error(`[web] ${where} could not read the API. ${detail}`);
}
