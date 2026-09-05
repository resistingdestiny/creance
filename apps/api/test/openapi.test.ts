import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import SwaggerParser from '@apidevtools/swagger-parser';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { buildOpenApiDocument, OPERATIONS } from '../src/openapi.js';
import { renderJson, renderYaml } from '../scripts/openapi.js';
import { buildTestServer } from './policy-fixtures.js';

/// The spec has to match the endpoints, which is the acceptance line for this
/// ticket, so three things are checked here rather than by eye.
///
/// One, the committed YAML parses and validates as OpenAPI 3.0, so "validated"
/// is a command anyone can run and not an assurance. Two, the committed files
/// are what the code generates, so nobody can edit the YAML and have it
/// survive. Three, every path and method in the document routes on the running
/// server, so an operation cannot be documented into existence.

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

  it('validates as OpenAPI 3.0, from the committed file', async () => {
    // The file, not the object the generator returns, because the file is what
    // an importer is given. swagger-parser reads it, resolves every $ref and
    // checks the document against the OpenAPI 3.0 schema, and it also refuses a
    // path parameter that the path template declares and the operation does
    // not, which is the failure this document is most likely to grow.
    const validated = (await SwaggerParser.validate(
      fileURLToPath(new URL('openapi.yaml', RECIPE_DIR)),
    )) as { info: { title: string } };
    expect(validated.info.title).toBe('Creance');
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

  it('promises nothing on the free reads the server does not send', async () => {
    const built = await buildTestServer();
    app = built.app;
    const document = buildOpenApiDocument({ version: '0.1.0' }) as {
      components: { schemas: Record<string, { required?: string[] }> };
    };

    // The two series reads are the ones an investor screen and the renewal
    // recipe read, and they were `type: object` in this document until T19, so
    // what they promise is new and worth holding to the running server.
    for (const [url, schema] of [
      ['/v1/series/ODI-COMP-2026-01', 'Series'],
      ['/v1/series/ODI-COMP-2026-01/coupons', 'SeriesCoupons'],
    ] as const) {
      const response = await built.app.inject({ method: 'GET', url });
      expect(response.statusCode, url).toBe(200);
      const body = response.json() as Record<string, unknown>;
      for (const field of document.components.schemas[schema]?.required ?? []) {
        expect(body[field], `${url} ${field}`).toBeDefined();
      }
    }
  });

  it('documents the status a wrong request actually comes back with', async () => {
    const built = await buildTestServer();
    app = built.app;
    const document = buildOpenApiDocument({ version: '0.1.0' }) as {
      paths: Record<string, Record<string, { responses: Record<string, unknown> }>>;
    };

    // An agent switches on the status before it reads the body, so a refusal
    // this document does not list is a refusal the agent handles by crashing.
    // Each case is a mistake a caller makes, not an exhaustive sweep: the ones
    // that need a payment, a chain write or a credential are proved by the
    // gate, bind and credential suites.
    const cases = [
      { method: 'GET' as const, url: '/v1/policy/bad', path: '/v1/policy/{policyId}' },
      {
        method: 'GET' as const,
        url: '/v1/policy/pol_01K4YB9X3M8Q0RZ7T2VD6C5H9E',
        path: '/v1/policy/{policyId}',
      },
      { method: 'GET' as const, url: '/v1/audit/bad', path: '/v1/audit/{policyId}' },
      { method: 'GET' as const, url: '/v1/series/NOT-A-SERIES', path: '/v1/series/{seriesId}' },
      {
        method: 'GET' as const,
        url: '/v1/series/NOT-A-SERIES/coupons',
        path: '/v1/series/{seriesId}/coupons',
      },
      { method: 'POST' as const, url: '/v1/quote', payload: {}, path: '/v1/quote' },
      {
        method: 'POST' as const,
        url: '/v1/quote',
        payload: { group: 'not_an_occupation', limit: '5000000000', wallet: '0.0.10366453' },
        path: '/v1/quote',
      },
      {
        method: 'POST' as const,
        url: '/v1/quote',
        payload: { group: 'computer_math', limit: '1', wallet: '0.0.10366453' },
        path: '/v1/quote',
      },
      { method: 'POST' as const, url: '/v1/bind', payload: { quote_id: 'qte_nope' }, path: '/v1/bind' },
    ];

    for (const testCase of cases) {
      const response = await built.app.inject({
        method: testCase.method,
        url: testCase.url,
        ...('payload' in testCase ? { payload: testCase.payload } : {}),
      });
      const documented = Object.keys(
        document.paths[testCase.path]?.[testCase.method.toLowerCase()]?.responses ?? {},
      );
      expect(documented, `${testCase.method} ${testCase.url}`).toContain(
        String(response.statusCode),
      );
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

  it('requires an eligibility credential on bind and asks for none on quote', () => {
    const document = buildOpenApiDocument({ version: '0.1.0' }) as {
      paths: Record<string, Record<string, { security?: unknown[] }>>;
    };
    expect(document.paths['/v1/bind']?.['post']?.security).toEqual([
      { eligibilityCredential: [] },
    ]);
    // Not `[{}, { eligibilityCredential: [] }]`, which read as "a credential is
    // one of the ways in" and is not true of the quote: the gate never looks at
    // the `Authorization` header there. See the T19 section of
    // docs/DECISIONS.md and the gate test that holds it.
    expect(document.paths['/v1/quote']?.['post']?.security).toBeUndefined();
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
