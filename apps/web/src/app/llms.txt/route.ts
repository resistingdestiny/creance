import { proxyToApi } from '../api-proxy';

/**
 * `GET /llms.txt`, the one URL an agent is given.
 *
 * The API generates it from the same code the endpoints are built from, so it
 * is fetched rather than copied: one generator, one set of bytes, nothing to
 * drift. See src/app/api-proxy.ts.
 */

export const dynamic = 'force-dynamic';

export function GET(request: Request): Promise<Response> {
  return proxyToApi(request);
}
