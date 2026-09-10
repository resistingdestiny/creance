import { proxyToApi } from '../api-proxy';

/**
 * `GET /health`, the commit the running API was built from.
 *
 * docs/SUBMISSION.md points a judge at this URL on the public origin, and
 * deploy/deploy.sh checks it, so it answers here as well as on the API.
 */

export const dynamic = 'force-dynamic';

export function GET(request: Request): Promise<Response> {
  return proxyToApi(request);
}
