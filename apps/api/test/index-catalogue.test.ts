import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { TRIGGER_FORMS } from '../src/routes/index-feed.js';
import { buildTestServer, observation } from './policy-fixtures.js';

/// The free catalogue, `GET /v1/index`.
///
/// It exists so an agent can find a valid group key, read the two trigger forms
/// and see the price before it spends anything. So what is checked here is that
/// it answers all three, that it gives away no index value, and that a group
/// with no observation is visible as such rather than costing a payment to
/// discover.
///
/// That it stays free with the gate configured is held in x402-routes.test.ts,
/// beside the rule it could break.

describe('the index catalogue', () => {
  let app: FastifyInstance | null = null;

  afterEach(async () => {
    await app?.close();
    app = null;
  });

  async function catalogue(): Promise<Record<string, unknown>> {
    const built = await buildTestServer({ observations: [observation()] });
    app = built.app;
    const response = await built.app.inject({ method: 'GET', url: '/v1/index' });
    expect(response.statusCode).toBe(200);
    return response.json() as Record<string, unknown>;
  }

  it('lists every group the index covers, with its frozen trigger lines', async () => {
    const body = (await catalogue()) as {
      groups: {
        group: string;
        label: string;
        bls_series: string;
        attachment_shock: string | null;
        level_line: string | null;
      }[];
    };
    const computer = body.groups.find((entry) => entry.group === 'computer_math');
    expect(computer).toBeDefined();
    expect(computer?.label).toBe('Computer and mathematical');
    expect(computer?.bls_series).toBe('LNU04032215');
    // Two decimals as strings, the same form the reading and the topic carry,
    // because these are the numbers a contract compared.
    expect(computer?.attachment_shock).toBe('2.00');
    expect(computer?.level_line).toBe('-0.68');
  });

  it('says which groups have a reading, so a caller does not pay for a 503', async () => {
    const body = (await catalogue()) as {
      groups: { group: string; latest_period: string | null }[];
    };
    const byGroup = new Map(body.groups.map((entry) => [entry.group, entry.latest_period]));
    expect(byGroup.get('computer_math')).toBe('2026-07');
    // The fixture publishes nothing for `legal`, and a paid call for it would
    // be refused with 503 after the payment.
    expect(byGroup.get('legal')).toBeNull();
  });

  it('carries no index value, so the free route does not give away the paid one', async () => {
    // The field names appear once, under `reading.fields`, where they are the
    // glossary an agent reads before it buys. What must not appear is a value:
    // the group entries carry the frozen lines and the newest period and
    // nothing that was computed from the source rows.
    const body = (await catalogue()) as { groups: Record<string, unknown>[] };
    for (const entry of body.groups) {
      expect(Object.keys(entry).sort()).toEqual([
        'attachment_shock',
        'bls_series',
        'group',
        'label',
        'latest_period',
        'level_line',
        'series_id',
      ]);
    }
  });

  it('describes both trigger forms and says a level line can be negative', async () => {
    const body = (await catalogue()) as { trigger_forms: { form: string; test: string }[] };
    expect(body.trigger_forms.map((entry) => entry.form)).toEqual(['shock', 'level']);
    expect(body.trigger_forms.map((entry) => entry.test)).toEqual([
      'odi >= attachment_shock',
      'ebar >= level_line',
    ]);
    expect(TRIGGER_FORMS[1].means).toContain('can be negative');
  });

  it('names the topic the same observations are published to', async () => {
    const body = (await catalogue()) as { index: { topic_id: string | null } };
    expect(body.index.topic_id).toBe('0.0.10366470');
  });

  it('reports no price when this deployment serves the feed open', async () => {
    // The fixtures build the server with no gate, which is what a clone with no
    // Hedera keys gets. Saying null is the honest answer; quoting a price the
    // gate is not charging would be worse than saying nothing.
    const body = (await catalogue()) as { price: unknown };
    expect(body.price).toBeNull();
  });
});
