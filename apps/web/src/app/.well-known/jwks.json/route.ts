import { proxyToApi } from '../../api-proxy';

/**
 * `GET /.well-known/jwks.json`, the keys a credential is verified against.
 *
 * The OpenAPI document tells a holder of a Creance credential to verify it
 * here, and the document's one server is the public origin, so this path has to
 * answer on the origin the document names.
 */

export const dynamic = 'force-dynamic';

export function GET(request: Request): Promise<Response> {
  return proxyToApi(request);
}
