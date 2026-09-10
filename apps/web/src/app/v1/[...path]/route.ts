import { proxyToApi } from '../../api-proxy';

/**
 * Everything under `/v1/`, answered by the API.
 *
 * Both OpenAPI documents name `https://creance.co` as their one server and
 * `llms.txt` links to `/v1/index`, `/v1/index/computer_math`, `/v1/replay` and
 * `/v1/attribution` on it, so an agent that reads either one calls these paths
 * here. The paid ones are the reason the headers pass through untouched: the
 * 402 carries `PAYMENT-REQUIRED`, the retry carries `PAYMENT-SIGNATURE` and the
 * answer carries `PAYMENT-RESPONSE`.
 *
 * Every method the documents use, and the ones they do not, because a caller
 * that sends `DELETE` should be told by the API that it is not allowed rather
 * than by this app that there is no page.
 */

export const dynamic = 'force-dynamic';

export function GET(request: Request): Promise<Response> {
  return proxyToApi(request);
}

export const HEAD = GET;
export const POST = GET;
export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;
export const OPTIONS = GET;
