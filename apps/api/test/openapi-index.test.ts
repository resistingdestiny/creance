import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import SwaggerParser from '@apidevtools/swagger-parser';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { buildIndexOpenApiDocument, INDEX_OPERATIONS } from '../src/openapi-index.js';
import { renderIndexJson, renderIndexYaml } from '../scripts/openapi.js';
import { buildTestServer } from './policy-fixtures.js';

/// The index feed's own document, held to the same rules as the gateway one.
///
/// It validates as OpenAPI 3.0 from the committed file, it is exactly what the
/// code generates, and every operation in it routes on the running server. On
/// top of that there are two rules that matter only for this document. It must
/// describe the index and nothing else, because it is imported as a gateway of
/// its own and an operation that quotes cover has no business in it. And every
/// operation must carry the agent hint and the payment terms, because the whole
/// point of it is that an agent decides whether to call the feed from this file
/// without asking anyone.

const AGENTIFY_DIR = new URL('../../../recipes/bazantic/agentify/', import.meta.url);

function read(name: string): string {
  return readFileSync(fileURLToPath(new URL(name, AGENTIFY_DIR)), 'utf8');
}

describe('the index feed OpenAPI document', () => {
  let app: FastifyInstance | null = null;

  afterEach(async () => {
    await app?.close();
    app = null;
  });

  it('validates as OpenAPI 3.0, from the committed file', async () => {
    const validated = (await SwaggerParser.validate(
      fileURLToPath(new URL('openapi.yaml', AGENTIFY_DIR)),
    )) as { info: { title: string } };
    expect(validated.info.title).toBe('Occupation Displacement Index');
  });

  it('is committed exactly as the code generates it', () => {
    expect(read('openapi.yaml')).toBe(renderIndexYaml());
    expect(read('openapi.json')).toBe(renderIndexJson());
  });

  it('serves only the public origin, never a localhost entry', () => {
    const document = buildIndexOpenApiDocument({ version: '0.1.0' }) as {
      openapi: string;
      servers: { url: string }[];
    };
    expect(document.openapi).toBe('3.0.3');
    expect(document.servers).toHaveLength(1);
    expect(document.servers[0]?.url).toBe('https://creance.co');
  });

  it('documents exactly the four public index routes', () => {
    const document = buildIndexOpenApiDocument({ version: '0.1.0' }) as {
      paths: Record<string, Record<string, unknown>>;
    };
    const documented = Object.entries(document.paths).flatMap(([path, methods]) =>
      Object.keys(methods).map((method) => `${method.toUpperCase()} ${path}`),
    );
    expect(documented.sort()).toEqual([...INDEX_OPERATIONS].sort());
  });

  it('carries nothing from the cover gateway', () => {
    // The two documents describe the same API and are imported as two
    // gateways. This one is the feed, so quoting, binding, policies, series,
    // claims and the credential all belong to the other one. An index gateway
    // that could bind a policy is not an index gateway.
    const text = read('openapi.json');
    for (const forbidden of ['/v1/quote', '/v1/bind', '/v1/policy', '/v1/series', '/v1/claims']) {
      expect(text, forbidden).not.toContain(forbidden);
    }
    expect(text).not.toContain('eligibilityCredential');
  });

  it('routes every documented operation on the running server', async () => {
    const built = await buildTestServer();
    app = built.app;
    const document = buildIndexOpenApiDocument({ version: '0.1.0' }) as {
      paths: Record<string, Record<string, unknown>>;
    };
    for (const [path, methods] of Object.entries(document.paths)) {
      const url = path.replace(/\{(\w+)\}/g, (_match, name: string) => `:${name}`);
      for (const method of Object.keys(methods)) {
        expect(built.app.hasRoute({ method: method.toUpperCase() as 'GET', url }), url).toBe(true);
      }
    }
  });

  it('tells an agent when to call each operation', () => {
    const document = buildIndexOpenApiDocument({ version: '0.1.0' }) as {
      paths: Record<string, Record<string, Record<string, unknown>>>;
    };
    for (const [path, methods] of Object.entries(document.paths)) {
      for (const [method, operation] of Object.entries(methods)) {
        const hint = operation['x-agent-hint'];
        expect(typeof hint, `${method} ${path}`).toBe('string');
        expect((hint as string).length, `${method} ${path}`).toBeGreaterThan(40);
      }
    }
  });

  it('states the price, the asset, the network and the flow in the description', () => {
    const document = buildIndexOpenApiDocument({ version: '0.1.0' }) as {
      info: { description: string };
    };
    for (const term of [
      '0.01 TUSD',
      '`10000`',
      '0.0.10366463',
      'hedera:testnet',
      '`exact`',
      'x402 version 2',
      'api.testnet.blocky402.com',
      '0.0.10366450',
      'PAYMENT-REQUIRED',
      'Testnet only',
    ]) {
      expect(document.info.description, term).toContain(term);
    }
  });

  it('explains both trigger forms and that a level line can be negative', () => {
    const document = buildIndexOpenApiDocument({ version: '0.1.0' }) as {
      info: { description: string };
    };
    expect(document.info.description).toContain('odi >= attachment_shock');
    expect(document.info.description).toContain('ebar >= level_line');
    expect(document.info.description).toContain('A level line can be negative');
  });

  it('documents the 402 and the payment headers on the metered operation only', () => {
    const document = buildIndexOpenApiDocument({ version: '0.1.0' }) as {
      paths: Record<
        string,
        Record<string, { parameters?: { name?: string }[]; responses: Record<string, unknown> }>
      >;
    };
    const metered = document.paths['/v1/index/{group}']?.['get'];
    expect(metered?.responses['402']).toBeDefined();
    expect(metered?.parameters?.some((entry) => entry.name === 'PAYMENT-SIGNATURE')).toBe(true);

    // The two free routes are free, and a 402 documented on either of them
    // would tell an agent to pay for the thing that tells it what to pay.
    expect(document.paths['/v1/index']?.['get']?.responses['402']).toBeUndefined();
    expect(document.paths['/v1/index/health']?.['get']?.responses['402']).toBeUndefined();
    expect(document.paths['/v1/replay']?.['get']?.responses['402']).toBeUndefined();
  });

  it('keeps the schemas free of anything an importer chokes on', () => {
    const text = read('openapi.json');
    expect(text).not.toContain('"oneOf"');
    expect(text).not.toContain('"anyOf"');
    expect(text).not.toContain('"allOf"');
  });

  it('promises the catalogue fields the server actually sends', async () => {
    const built = await buildTestServer();
    app = built.app;
    const document = buildIndexOpenApiDocument({ version: '0.1.0' }) as {
      components: { schemas: Record<string, { required?: string[] }> };
    };
    const response = await built.app.inject({ method: 'GET', url: '/v1/index' });
    expect(response.statusCode).toBe(200);
    const body = response.json() as Record<string, unknown>;
    for (const field of document.components.schemas['IndexCatalogue']?.required ?? []) {
      expect(body[field], field).toBeDefined();
    }
  });
});
