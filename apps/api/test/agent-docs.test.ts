import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { renderLlmsTxt, renderSkillMd } from '../src/agent-docs.js';
import { GROUP_KEYS } from '../src/openapi-shared.js';
import { buildTestServer } from './policy-fixtures.js';

/// The description files.
///
/// An agent that has never seen this API is given one URL, `/llms.txt`, and
/// nothing else. Everything it needs to make a correct paid call has to be
/// reachable from there, so what is checked here is that the file says the
/// price, the asset, the network, the flow and the route, that the group keys
/// in it are the ones the API accepts, and that the file the API serves is the
/// file the repository committed.

const AGENTIFY_DIR = new URL('../../../recipes/bazantic/agentify/', import.meta.url);

function read(name: string): string {
  return readFileSync(fileURLToPath(new URL(name, AGENTIFY_DIR)), 'utf8');
}

describe('the agent description files', () => {
  let app: FastifyInstance | null = null;

  afterEach(async () => {
    await app?.close();
    app = null;
  });

  it('are committed exactly as the code generates them', () => {
    expect(read('llms.txt')).toBe(renderLlmsTxt());
    expect(read('SKILL.md')).toBe(renderSkillMd());
  });

  it('are served by the API, as the same bytes', async () => {
    const built = await buildTestServer();
    app = built.app;
    const llms = await built.app.inject({ method: 'GET', url: '/llms.txt' });
    expect(llms.statusCode).toBe(200);
    expect(llms.headers['content-type']).toContain('text/plain');
    expect(llms.body).toBe(read('llms.txt'));

    const skill = await built.app.inject({ method: 'GET', url: '/skill.md' });
    expect(skill.statusCode).toBe(200);
    expect(skill.headers['content-type']).toContain('text/markdown');
    expect(skill.body).toBe(read('SKILL.md'));
  });

  it('serves the index OpenAPI document too, so one URL leads to all of it', async () => {
    const built = await buildTestServer();
    app = built.app;
    const response = await built.app.inject({ method: 'GET', url: '/openapi/index.json' });
    expect(response.statusCode).toBe(200);
    const document = response.json() as { info: { title: string }; paths: Record<string, unknown> };
    expect(document.info.title).toBe('Occupation Displacement Index');
    expect(Object.keys(document.paths).sort()).toEqual([
      '/v1/index',
      '/v1/index/{group}',
      '/v1/replay',
    ]);
  });

  it('state the payment terms in words, in both files', () => {
    for (const [name, text] of [
      ['llms.txt', renderLlmsTxt()],
      ['SKILL.md', renderSkillMd()],
    ] as const) {
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
        'PAYMENT-SIGNATURE',
        'Testnet only',
      ]) {
        expect(text, `${name} ${term}`).toContain(term);
      }
    }
  });

  it('name the free route to call first and the paid route it leads to', () => {
    for (const text of [renderLlmsTxt(), renderSkillMd()]) {
      expect(text).toContain('/v1/index');
      expect(text).toContain('/v1/index/computer_math');
      expect(text).toContain('/v1/replay');
    }
  });

  it('list only group keys the API accepts', async () => {
    const built = await buildTestServer();
    app = built.app;
    const listed = [...renderLlmsTxt().matchAll(/^- `([a-z_]+)`$/gm)].map((match) => match[1]);
    expect(listed).toEqual([...GROUP_KEYS]);
    // And the one the worked example uses is a real key, not a plausible one.
    expect(listed).toContain('computer_math');
  });

  it('explain both trigger forms and that a level line can be negative', () => {
    for (const text of [renderLlmsTxt(), renderSkillMd()]) {
      expect(text).toContain('odi >= attachment_shock');
      expect(text).toContain('ebar >= level_line');
      expect(text).toContain('A level line can be negative');
    }
  });

  it('point only at the public origin, never at a localhost or a tunnel', () => {
    for (const text of [renderLlmsTxt(), renderSkillMd()]) {
      for (const url of [...text.matchAll(/https?:\/\/[^\s)]+/g)].map((match) => match[0])) {
        expect(url, url).not.toContain('localhost');
        expect(url, url).not.toContain('127.0.0.1');
        expect(url, url).not.toContain('ngrok');
      }
    }
  });

  it('opens the skill with frontmatter a loader can read', () => {
    const lines = renderSkillMd().split('\n');
    expect(lines[0]).toBe('---');
    expect(lines[1]).toBe('name: occupation-displacement-index');
    expect(lines[2]?.startsWith('description: ')).toBe(true);
    expect(lines[3]).toBe('---');
    // One line, because a folded YAML scalar is where a frontmatter parser and
    // a loader most often disagree.
    expect(lines[2]?.includes('\n')).toBe(false);
  });

  it('opens llms.txt with the title and blockquote the format asks for', () => {
    const lines = renderLlmsTxt().split('\n');
    expect(lines[0]?.startsWith('# ')).toBe(true);
    expect(lines[2]?.startsWith('> ')).toBe(true);
  });
});
