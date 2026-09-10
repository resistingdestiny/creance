import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { investorRoutes } from '../src/investor/index.js';
import { CONFIG, FakeChainReader, OFFICE_SERIES, SERIES, seriesWithoutNote } from './fixtures.js';

/// The routes, driven through Fastify's own injector with a reader that answers
/// from fixtures. No relay, no mirror node, no key.

describe('the investor endpoints', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify();
    await app.register(investorRoutes, { config: CONFIG, reader: new FakeChainReader() });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('lists every series it serves, the demo one first', async () => {
    const listing = Fastify();
    await listing.register(investorRoutes, {
      config: { ...CONFIG, series: [SERIES, OFFICE_SERIES] },
      reader: new FakeChainReader(),
    });
    await listing.ready();
    const response = await listing.inject({ method: 'GET', url: '/v1/series' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.count).toBe(2);
    expect(body.series.map((entry: { series_id: string }) => entry.series_id)).toEqual([
      'ODI-COMP-2026-01',
      'ODI-OFFC-2026-01',
    ]);
    expect(body.series[0].has_note).toBe(true);
    expect(body.series[0].links.self).toBe('/v1/series/ODI-COMP-2026-01');
    // Capacity without a note. The cover is buyable and the list says so
    // rather than hiding the series.
    expect(body.series[1].has_note).toBe(false);
    expect(body.series[1].group).toBe('office_admin_support');
    // What each entry is, so a chooser can name what it covers.
    expect(body.series[0].kind).toBe('occupation');
    await listing.close();
  });

  it('carries the next declared coupon on the series it serves', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/series/ODI-COMP-2026-01' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.kind).toBe('occupation');
    // Coupon 1 settled, so the next payment is the one declared after it.
    expect(body.coupons.next.coupon_id).toBe('4');
    expect(body.coupons.next.execution_date).toBe('2027-01-05T20:16:23Z');
  });

  it('says nothing about a next payment when the schedule cannot be read', async () => {
    const unreadable = Fastify();
    await unreadable.register(investorRoutes, {
      config: CONFIG,
      reader: new FakeChainReader({ schedule: null }),
    });
    await unreadable.ready();
    const response = await unreadable.inject({ method: 'GET', url: '/v1/series/ODI-COMP-2026-01' });
    expect(response.json().coupons.next).toBeNull();
    await unreadable.close();
  });

  it('serves a second series through the same route', async () => {
    const second = Fastify();
    await second.register(investorRoutes, {
      config: { ...CONFIG, series: [SERIES, OFFICE_SERIES] },
      reader: new FakeChainReader(),
    });
    await second.ready();
    const response = await second.inject({ method: 'GET', url: '/v1/series/ODI-OFFC-2026-01' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.series_id).toBe('ODI-OFFC-2026-01');
    expect(body.group).toBe('office_admin_support');
    expect(body.note).toBeNull();
    await second.close();
  });

  it('serves the series by its label', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/series/ODI-COMP-2026-01' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.series_id).toBe('ODI-COMP-2026-01');
    expect(body.series_key).toBe(SERIES.seriesId);
    expect(body.vault.principal_funded.amount).toBe('100000000000');
    expect(body.note.symbol).toBe('CDBN01');
    expect(body.holders).toHaveLength(2);
    expect(body.links.coupons).toBe('/v1/series/ODI-COMP-2026-01/coupons');
  });

  it('serves the same series by its bytes32 key', async () => {
    const response = await app.inject({ method: 'GET', url: `/v1/series/${SERIES.seriesId}` });
    expect(response.statusCode).toBe(200);
    expect(response.json().series_id).toBe('ODI-COMP-2026-01');
  });

  it('serves the coupons with their settlements', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/series/ODI-COMP-2026-01/coupons',
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.coupons).toHaveLength(1);
    expect(body.coupons[0].total.amount).toBe('657534246');
    expect(body.coupons[0].holders[0].settlement.result).toBe('SUCCESS');
    expect(body.payments_topic).toBe('https://hashscan.io/testnet/topic/0.0.10366471');
  });

  it('answers an unknown series with a problem document', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/series/ODI-NOPE-2026-01' });
    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain('application/problem+json');
    const body = response.json();
    expect(body.code).toBe('series_not_found');
    expect(body.status).toBe(404);
    expect(body.retryable).toBe(false);
    expect(body.instance).toBe('/v1/series/ODI-NOPE-2026-01');
  });

  it('answers an unknown series on the coupons route the same way', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/series/nope/coupons' });
    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe('series_not_found');
  });

  it('reports a frozen holding as balance plus frozen', async () => {
    const frozen = Fastify();
    await frozen.register(investorRoutes, {
      config: CONFIG,
      reader: new FakeChainReader({
        holder: { balance: 5_000_000n, frozen: 45_000_000n, subscription: 50_000_000_000n },
      }),
    });
    const response = await frozen.inject({ method: 'GET', url: '/v1/series/ODI-COMP-2026-01' });
    expect(response.json().holders[0].note_position).toBe('50000000');
    await frozen.close();
  });

  it('serves a series whose note is not deployed', async () => {
    const bare = Fastify();
    const withoutNote = seriesWithoutNote();
    await bare.register(investorRoutes, {
      config: { ...CONFIG, series: [withoutNote] },
      reader: new FakeChainReader({ note: null }),
    });
    const response = await bare.inject({ method: 'GET', url: '/v1/series/ODI-COMP-2026-01' });
    expect(response.statusCode).toBe(200);
    expect(response.json().note).toBeNull();
    await bare.close();
  });
});
