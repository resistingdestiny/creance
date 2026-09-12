import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { buildTestServer, type TestHarness } from './policy-fixtures.js';

/// POST /v1/newsletter.
///
/// Three of these are about what the endpoint refuses to say rather than about
/// what it stores. A sign up form on a public page is a public write, and the
/// two ways one leaks are answering differently for an address it already holds
/// and printing back what it was sent. Both are asserted here, because both are
/// the kind of thing a later change reintroduces without noticing.

const ADDRESS = 'Reader@Example.COM';

describe('the newsletter endpoint', () => {
  let app: FastifyInstance | null = null;

  afterEach(async () => {
    await app?.close();
    app = null;
  });

  async function harness(): Promise<TestHarness & { app: FastifyInstance }> {
    const built = await buildTestServer();
    app = built.app;
    return built;
  }

  async function post(built: { app: FastifyInstance }, payload: Record<string, unknown>) {
    return await built.app.inject({ method: 'POST', url: '/v1/newsletter', payload });
  }

  it('stores the address, folded, with the moment it was given', async () => {
    const built = await harness();
    const response = await post(built, { email: ADDRESS });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({ status: 'accepted' });

    const rows = await built.services.repository.newsletterSignups();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.email).toBe('reader@example.com');
    expect(Date.parse(rows[0]?.createdAt ?? '')).toBeGreaterThan(0);
  });

  it('says what happens to the address in the answer as well as on the page', async () => {
    const built = await harness();
    const { notice } = (await post(built, { email: 'a@b.co' })).json() as { notice: string };
    expect(notice).toContain('nothing is sent');
    expect(notice).toContain('no mailing list');
  });

  it('answers a repeat exactly as it answered the first, and keeps one row', async () => {
    const built = await harness();
    const first = await post(built, { email: ADDRESS });
    const given = (await built.services.repository.newsletterSignups())[0]?.createdAt;
    const second = await post(built, { email: 'reader@example.com' });

    expect(second.statusCode).toBe(first.statusCode);
    expect(second.json()).toStrictEqual(first.json());

    const rows = await built.services.repository.newsletterSignups();
    expect(rows).toHaveLength(1);
    // The first submission's moment, not the second's. A moved timestamp would
    // be a record that somebody came back, which this table does not keep.
    expect(rows[0]?.createdAt).toBe(given);
  });

  it('refuses what is not an address, and never prints it back', async () => {
    const built = await harness();
    for (const rubbish of ['hello', 'reader@', '@example.com', 'a b@c.com', 'reader@example']) {
      const response = await post(built, { email: rubbish });
      expect(response.statusCode).toBe(400);
      const problem = response.json() as { code: string; detail: string; type: string };
      expect(problem.code).toBe('email_invalid');
      expect(response.headers['content-type']).toContain('application/problem+json');
      expect(`${problem.detail}${problem.type}`).not.toContain(rubbish);
    }
    expect(await built.services.repository.newsletterSignups()).toHaveLength(0);
  });

  it('refuses a body with no address in it at all', async () => {
    const built = await harness();
    const response = await post(built, { address: 'reader@example.com' });
    expect(response.statusCode).toBe(400);
    expect((response.json() as { code: string }).code).toBe('validation_failed');
  });

  it('refuses an address longer than any mail system carries', async () => {
    const built = await harness();
    const long = `${'a'.repeat(70)}@example.com`;
    expect((await post(built, { email: long })).statusCode).toBe(400);
    expect(await built.services.repository.newsletterSignups()).toHaveLength(0);
  });
});
