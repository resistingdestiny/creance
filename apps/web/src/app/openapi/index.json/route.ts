import { proxyToApi } from '../../api-proxy';

/**
 * `GET /openapi/index.json`, the index feed's OpenAPI document.
 *
 * The cover gateway's document is `/openapi.json`, a file in public/. This one
 * is the API's, because the API serves it at runtime as well as writing it.
 */

export const dynamic = 'force-dynamic';

export function GET(request: Request): Promise<Response> {
  return proxyToApi(request);
}
