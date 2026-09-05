import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { dump } from 'js-yaml';

import { buildOpenApiDocument } from '../src/openapi.js';
import { buildIndexOpenApiDocument } from '../src/openapi-index.js';

/// `pnpm api:openapi` writes every generated agent-facing artifact.
///
///     recipes/bazantic/openapi.yaml           the cover gateway
///     recipes/bazantic/openapi.json           the same document as JSON
///     recipes/bazantic/agentify/openapi.yaml  the index feed gateway
///     recipes/bazantic/agentify/openapi.json  the same document as JSON
///
/// Both documents come from code in src, and a test regenerates them and
/// compares, so the committed files cannot drift from the API they describe.
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

export function renderIndexYaml(): string {
  return dump(buildIndexOpenApiDocument({ version: VERSION }), { lineWidth: 100, noRefs: true });
}

export function renderIndexJson(): string {
  return `${JSON.stringify(buildIndexOpenApiDocument({ version: VERSION }), null, 2)}\n`;
}

const target = new URL('../../../recipes/bazantic/', import.meta.url);
const agentify = new URL('agentify/', target);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(fileURLToPath(new URL('openapi.yaml', target)), renderYaml());
  writeFileSync(fileURLToPath(new URL('openapi.json', target)), renderJson());
  writeFileSync(fileURLToPath(new URL('openapi.yaml', agentify)), renderIndexYaml());
  writeFileSync(fileURLToPath(new URL('openapi.json', agentify)), renderIndexJson());
  console.log('wrote recipes/bazantic/openapi.yaml and openapi.json');
  console.log('wrote recipes/bazantic/agentify/openapi.yaml and openapi.json');
}
