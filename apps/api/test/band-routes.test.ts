import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { buildTestServer, POLICYHOLDER_1, type TestHarness } from './policy-fixtures.js';

/// The band endpoints, and what the price does when capital moves.
///
/// The point of every test here is that no figure comes from a table of band
/// multipliers, because there is no such table. A band is dearer, cheaper or
/// unavailable because real capital did or did not commit to it, and the only
/// way capital commits is the write path these tests use.

const ADMIN = { authorization: 'Bearer test-admin-token' };
const ADMIN_TOKENS = { admin: 'test-admin-token', adjuster: undefined, reviewerName: 'test' };

describe('the band endpoints', () => {
  let app: FastifyInstance | null = null;

  afterEach(async () => {
    await app?.close();
    app = null;
  });

  async function harness(): Promise<TestHarness & { app: FastifyInstance }> {
    const built = await buildTestServer({ adminTokens: ADMIN_TOKENS });
    app = built.app;
    return built;
  }

  async function bands(built: TestHarness & { app: FastifyInstance }, limit = '5000000000') {
    const response = await built.app.inject({
      method: 'GET',
      url: `/v1/cover/bands?group=computer_math&limit=${limit}`,
    });
    expect(response.statusCode).toBe(200);
    return response.json();
  }

  async function commit(
    built: TestHarness & { app: FastifyInstance },
    band: string,
    amount: string,
  ) {
    return await built.app.inject({
      method: 'POST',
      url: '/v1/series/ODI-COMP-2026-01/bands',
      headers: ADMIN,
      payload: { band, amount, holder: POLICYHOLDER_1.address },
    });
  }

  async function quote(
    built: TestHarness & { app: FastifyInstance },
    body: Record<string, unknown>,
  ) {
    return await built.app.inject({
      method: 'POST',
      url: '/v1/quote',
      payload: { group: 'computer_math', limit: '5000000000', wallet: POLICYHOLDER_1.accountId, ...body },
    });
  }

  it('offers three bands at one price while no capital has named one', () => {
    return harness().then(async (built) => {
      const body = await bands(built);
      expect(body.bands.map((row: { band: string }) => row.band)).toEqual([
        '0_5',
        '5_25',
        '25_plus',
      ]);
      // The same price in all three, because the risk measured is one risk and
      // the capital behind them is the same unallocated capital.
      const premiums = new Set(body.bands.map((row: { premium: { amount: string } }) => row.premium.amount));
      expect(premiums.size).toBe(1);
      // And the same guide rate, which is the half of the price the index sets
      // and the half a band may never touch.
      const guides = new Set(body.bands.map((row: { guide_rate_bps: number }) => row.guide_rate_bps));
      expect(guides.size).toBe(1);
      expect(body.unallocated.amount).toBe(body.principal_remaining.amount);
    });
  });

  it('prices a band the moment capital chooses it, and leaves the rest alone', async () => {
    const built = await harness();
    const before = await bands(built);
    const seniorBefore = before.bands.find((row: { band: string }) => row.band === '25_plus');

    expect((await commit(built, '25_plus', '50000000000')).statusCode).toBe(201);

    const after = await bands(built);
    const senior = after.bands.find((row: { band: string }) => row.band === '25_plus');
    const junior = after.bands.find((row: { band: string }) => row.band === '0_5');
    // Capital behind the band it chose goes up; the band it did not choose has
    // only what is left unallocated.
    expect(BigInt(senior.capital.amount)).toBeGreaterThan(BigInt(junior.capital.amount));
    expect(senior.capital.amount).toBe(before.principal_remaining.amount);
    expect(BigInt(junior.capital.amount)).toBe(
      BigInt(before.principal_remaining.amount) - 50_000_000_000n,
    );
    // Nothing about the risk changed, so the guide rate did not.
    expect(senior.guide_rate_bps).toBe(seniorBefore.guide_rate_bps);
  });

  it('has no price for a band capital has passed over, and says why', async () => {
    const built = await harness();
    // The whole principal committed to the two senior bands. There is nothing
    // left unallocated, so the youngest band has nothing behind it.
    expect((await commit(built, '5_25', '40000000000')).statusCode).toBe(201);
    expect((await commit(built, '25_plus', '60000000000')).statusCode).toBe(201);

    const body = await bands(built);
    const junior = body.bands.find((row: { band: string }) => row.band === '0_5');
    expect(junior.available).toBe(false);
    expect(junior.reason).toBe('no_capital');
    // Not a zero and not a floor price. There is no price.
    expect(junior.premium).toBeNull();
    expect(junior.utilisation).toBeNull();
    expect(junior.annual_rate_bps).toBeNull();

    const refused = await quote(built, { band: '0_5' });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().code).toBe('band_not_funded');

    // And the bands capital did choose are unaffected.
    const senior = body.bands.find((row: { band: string }) => row.band === '25_plus');
    expect(senior.available).toBe(true);
    expect((await quote(built, { band: '25_plus' })).statusCode).toBe(201);
  });

  it('refuses to record more capital than the vault holds', async () => {
    const built = await harness();
    expect((await commit(built, '0_5', '100000000000')).statusCode).toBe(201);
    const over = await commit(built, '5_25', '1');
    expect(over.statusCode).toBe(409);
    expect(over.json().code).toBe('over_allocated');
  });

  it('takes no allocation from a caller with no admin token', async () => {
    const built = await harness();
    const response = await built.app.inject({
      method: 'POST',
      url: '/v1/series/ODI-COMP-2026-01/bands',
      payload: { band: '0_5', amount: '1000', holder: POLICYHOLDER_1.address },
    });
    expect(response.statusCode).toBe(401);
  });

  it('prices a quote that names no band exactly as it did before bands existed', async () => {
    const built = await harness();
    const banded = (await quote(built, { band: '5_25' })).json();
    const unbanded = (await quote(built, {})).json();
    expect(unbanded.band).toBeNull();
    expect(unbanded.premium.amount).toBe(banded.premium.amount);
    expect(banded.band).toBe('5_25');
  });

  it('refuses a band it does not offer rather than quoting something else', async () => {
    const built = await harness();
    const response = await quote(built, { band: 'senior' });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('validation_failed');
  });
});
