import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { buildOpenApiDocument, OPERATIONS } from '../src/openapi.js';
import { renderJson, renderYaml } from '../scripts/openapi.js';
import { buildTestServer } from './policy-fixtures.js';

/// The spec has to match the endpoints, which is the acceptance line for this
/// ticket, so two things are checked here rather than by eye.
///
/// One, the committed files are what the code generates, so nobody can edit the
/// YAML and have it survive. Two, every path and method in the document routes
/// on the running server, so an operation cannot be documented into existence.

const RECIPE_DIR = new URL('../../../recipes/bazantic/', import.meta.url);

function read(name: string): string {
  return readFileSync(fileURLToPath(new URL(name, RECIPE_DIR)), 'utf8');
}

describe('the Bazantic OpenAPI document', () => {
  let app: FastifyInstance | null = null;

  afterEach(async () => {
    await app?.close();
    app = null;
  });

  it('is committed exactly as the code generates it', () => {
    expect(read('openapi.yaml')).toBe(renderYaml());
    expect(read('openapi.json')).toBe(renderJson());
  });

  it('targets OpenAPI 3.0.3, which every importer accepts', () => {
    const document = buildOpenApiDocument({ version: '0.1.0' });
    expect(document.openapi).toBe('3.0.3');
  });

  it('serves only the public origin, never a localhost entry', () => {
    const document = buildOpenApiDocument({ version: '0.1.0' }) as {
      servers: { url: string }[];
    };
    expect(document.servers).toHaveLength(1);
    expect(document.servers[0]?.url).toBe('https://creance.co');
  });

  it('documents exactly the operations it claims to', () => {
    const document = buildOpenApiDocument({ version: '0.1.0' }) as {
      paths: Record<string, Record<string, unknown>>;
    };
    const documented = Object.entries(document.paths).flatMap(([path, methods]) =>
      Object.keys(methods).map((method) => `${method.toUpperCase()} ${path}`),
    );
    expect(documented.sort()).toEqual([...OPERATIONS].sort());
  });

  it('routes every documented operation on the running server', async () => {
    const built = await buildTestServer();
    app = built.app;
    const document = buildOpenApiDocument({ version: '0.1.0' }) as {
      paths: Record<string, Record<string, unknown>>;
    };
    for (const [path, methods] of Object.entries(document.paths)) {
      // OpenAPI writes a path parameter as {name}; Fastify writes it as :name.
      const url = path.replace(/\{(\w+)\}/g, (_match, name: string) => `:${name}`);
      for (const method of Object.keys(methods)) {
        expect(built.app.hasRoute({ method: method.toUpperCase() as 'GET', url })).toBe(true);
      }
    }
  });

  it('documents the 402 and the payment headers on every metered operation', () => {
    const document = buildOpenApiDocument({ version: '0.1.0' }) as {
      paths: Record<string, Record<string, { parameters?: { name?: string }[]; responses: Record<string, unknown> }>>;
    };
    for (const [path, method] of [
      ['/v1/index/{group}', 'get'],
      ['/v1/quote', 'post'],
      ['/v1/bind', 'post'],
    ] as const) {
      const operation = document.paths[path]?.[method];
      expect(operation?.responses['402'], `${method} ${path}`).toBeDefined();
      expect(operation?.parameters?.some((p) => p.name === 'PAYMENT-SIGNATURE')).toBe(true);
    }
  });

  it('requires an eligibility credential on bind and offers it on quote', () => {
    const document = buildOpenApiDocument({ version: '0.1.0' }) as {
      paths: Record<string, Record<string, { security?: unknown[] }>>;
    };
    expect(document.paths['/v1/bind']?.['post']?.security).toEqual([
      { eligibilityCredential: [] },
    ]);
    expect(document.paths['/v1/quote']?.['post']?.security).toEqual([
      {},
      { eligibilityCredential: [] },
    ]);
  });

  it('keeps the schemas free of anything an importer chokes on', () => {
    const text = read('openapi.json');
    expect(text).not.toContain('"oneOf"');
    expect(text).not.toContain('"anyOf"');
    expect(text).not.toContain('"allOf"');
  });

  it('describes every money field as a string in the smallest unit', () => {
    const document = buildOpenApiDocument({ version: '0.1.0' }) as {
      components: { schemas: { Money: { properties: Record<string, { type: string }> } } };
    };
    const money = document.components.schemas.Money.properties;
    expect(money['amount']?.type).toBe('string');
    expect(money['decimals']?.type).toBe('integer');
  });
});
