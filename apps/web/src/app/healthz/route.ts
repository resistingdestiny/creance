import { proxyToApi } from '../api-proxy';

/** `GET /healthz`, the liveness check beside `/health`. Served by the API. */

export const dynamic = 'force-dynamic';

export function GET(request: Request): Promise<Response> {
  return proxyToApi(request);
}
