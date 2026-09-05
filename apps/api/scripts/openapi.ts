import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { dump } from 'js-yaml';

import { buildOpenApiDocument } from '../src/openapi.js';

/// `pnpm --filter @creance/api openapi` writes recipes/bazantic/openapi.yaml
/// and the JSON beside it. Both come from one document in src/openapi.ts, and
/// a test regenerates them and compares, so the committed files cannot drift
/// from the code.
///
/// Both formats, because Bazantic's import requirements are not published and
/// an importer that wants JSON should not need a second run to get it.

export const VERSION = '0.1.0';

export function renderYaml(): string {
  return dump(buildOpenApiDocument({ version: VERSION }), { lineWidth: 100, noRefs: true });
}

export function renderJson(): string {
  return `${JSON.stringify(buildOpenApiDocument({ version: VERSION }), null, 2)}\n`;
}

const target = new URL('../../../recipes/bazantic/', import.meta.url);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(fileURLToPath(new URL('openapi.yaml', target)), renderYaml());
  writeFileSync(fileURLToPath(new URL('openapi.json', target)), renderJson());
  console.log('wrote recipes/bazantic/openapi.yaml and openapi.json');
}
