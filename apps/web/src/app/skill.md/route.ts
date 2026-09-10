import { proxyToApi } from '../api-proxy';

/** `GET /skill.md`, the skill `llms.txt` links to. Served by the API. */

export const dynamic = 'force-dynamic';

export function GET(request: Request): Promise<Response> {
  return proxyToApi(request);
}
