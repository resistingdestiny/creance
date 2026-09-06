import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import type { ObservationRow } from '../src/db/types.js';
import {
  buildTestServer,
  issueCredential,
  observation,
  POLICYHOLDER_1,
  type TestHarness,
} from './policy-fixtures.js';

/// The four endpoints, driven through Fastify's own injector against a memory
/// repository and a recorded chain. No Postgres, no relay, no key, no testnet:
/// the testnet path is its own file and its own command.

describe('the policy endpoints', () => {
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

  async function quoted(built: TestHarness & { app: FastifyInstance }, limit = '5000000000') {
    return await built.app.inject({
      method: 'POST',
      url: '/v1/quote',
      payload: { group: 'computer_math', limit, wallet: POLICYHOLDER_1.accountId },
    });
  }

  describe('POST /v1/quote', () => {
    it('prices a 5,000 limit from the index and the capacity', async () => {
      const built = await harness();
      const response = await quoted(built);
      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.series_id).toBe('ODI-COMP-2026-01');
      expect(body.limit.amount).toBe('5000000000');
      expect(body.limit.decimals).toBe(6);
      // Every monetary field is a string, in minor units, never a JSON number.
      expect(typeof body.premium.amount).toBe('string');
      expect(BigInt(body.premium.amount) > 0n).toBe(true);
      expect(body.capacity.free_before).toBe('100000000000');
      expect(body.capacity.free_after).toBe('95000000000');
      expect(body.level_line).toBe('-0.68');
      expect(body.waiting_period_days).toBe(60);
      expect(body.term_months).toBe(12);
    });

    it('computes the premium as the rate times the limit over twelve, in minor units', async () => {
      const built = await harness();
      const body = (await quoted(built)).json();
      const expected =
        (BigInt(body.limit.amount) * BigInt(body.annual_rate_bps) + 60_000n) / 120_000n;
      expect(body.premium.amount).toBe(expected.toString());
    });

    it('refuses a limit that is not a step on the slider', async () => {
      const built = await harness();
      const response = await quoted(built, '5300000000');
      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe('limit_out_of_range');
    });

    it('says there is no capacity behind a group with no series', async () => {
      const built = await harness();
      const response = await built.app.inject({
        method: 'POST',
        url: '/v1/quote',
        payload: { group: 'legal', limit: '5000000000', wallet: POLICYHOLDER_1.accountId },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json().code).toBe('no_capacity_for_group');
    });

    it('refuses an occupation the index does not cover', async () => {
      const built = await harness();
      const response = await built.app.inject({
        method: 'POST',
        url: '/v1/quote',
        payload: { group: 'armed_forces', limit: '5000000000', wallet: POLICYHOLDER_1.accountId },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe('group_unknown');
    });

    it('refuses a limit past the free capacity', async () => {
      const built = await harness();
      built.chain.set({ activeExposure: 99_000_000_000n });
      const response = await quoted(built, '5000000000');
      expect(response.statusCode).toBe(409);
      expect(response.json().code).toBe('insufficient_capacity');
    });
  });

  describe('POST /v1/bind', () => {
    async function bound(built: TestHarness & { app: FastifyInstance }) {
      const quote = (await quoted(built)).json();
      const token = await issueCredential(built);
      return await built.app.inject({
        method: 'POST',
        url: '/v1/bind',
        headers: { authorization: `Bearer ${token}` },
        payload: { quote_id: quote.quote_id },
      });
    }

    it('binds, mints the receipt and records the sequence number', async () => {
      const built = await harness();
      const response = await bound(built);
      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.status).toBe('bound');
      expect(body.nft.token_id).toBe('0.0.10366468');
      expect(body.nft.serial).toBe(1);
      expect(body.hcs_receipt.topic_id).toBe('0.0.10366471');
      expect(body.hcs_receipt.sequence_number).toBe(41);
      expect(body.chain.bind_transaction).toMatch(/^0x/);
    });

    it('passes the receipt sequence number into the contract call', async () => {
      const built = await harness();
      await bound(built);
      expect(built.chain.binds).toHaveLength(1);
      const call = built.chain.binds[0];
      expect(call?.hcsReceiptSeq).toBe(41);
      expect(call?.holder).toBe(POLICYHOLDER_1.address);
      expect(call?.limit).toBe(5_000_000_000n);
    });

    it('mints to the principal wallet and never to an agent', async () => {
      const built = await harness();
      await bound(built);
      expect(built.hedera.minted).toHaveLength(1);
      expect(built.hedera.minted[0]?.holder).toBe(POLICYHOLDER_1.accountId);
      const metadata = built.hedera.minted[0]?.metadata ?? '';
      expect(Buffer.byteLength(metadata, 'utf8')).toBeLessThanOrEqual(100);
    });

    it('writes a binding receipt before the chain call and an outcome after it', async () => {
      const built = await harness();
      await bound(built);
      const messages = built.hedera.published.map((entry) => JSON.parse(entry.message));
      expect(messages).toHaveLength(2);
      expect(messages[0]).toMatchObject({ v: 1, kind: 'policy', status: 'binding' });
      expect(messages[1]).toMatchObject({ v: 1, kind: 'policy', status: 'bound', receiptSeq: 41 });
      expect(messages[1].serial).toBe(1);
    });

    it('dates the receipt at the moment the price was struck, not at its expiry', async () => {
      // The receipt is a permanent public record. quotedAt carrying the expiry
      // would state the price was struck QUOTE_TTL_SECONDS after the cover began.
      const built = await harness();
      const quote = (await quoted(built)).json();
      const token = await issueCredential(built);
      const response = await built.app.inject({
        method: 'POST',
        url: '/v1/bind',
        headers: { authorization: `Bearer ${token}` },
        payload: { quote_id: quote.quote_id },
      });
      expect(response.statusCode).toBe(201);

      const row = await built.repository.quote(quote.quote_id);
      const receipt = JSON.parse(built.hedera.published[0]?.message ?? '{}');
      expect(receipt.quotedAt).toBe(row?.createdAt);
      expect(receipt.quotedAt).not.toBe(row?.expiresAt);
      expect(Date.parse(row?.expiresAt ?? '') - Date.parse(receipt.quotedAt)).toBe(
        built.services.config.quoteTtlSeconds * 1000,
      );
      expect(Date.parse(receipt.quotedAt)).toBeLessThanOrEqual(Date.parse(receipt.startAt));
    });

    it('records the first premium as uncollected, ready for the x402 gate', async () => {
      const built = await harness();
      const body = (await bound(built)).json();
      const payments = built.repository.paymentsFor(body.policy_id);
      expect(payments).toHaveLength(1);
      expect(payments[0]?.status).toBe('uncollected');
      expect(payments[0]?.facilitatorTx).toBeNull();
      expect(payments[0]?.hcsSeq).toBe(41);
    });

    it('refuses a second policy for the same person in the same series', async () => {
      const built = await harness();
      expect((await bound(built)).statusCode).toBe(201);
      const second = await bound(built);
      expect(second.statusCode).toBe(409);
      expect(second.json().code).toBe('already_covered');
      expect(built.chain.binds).toHaveLength(1);
    });

    it('refuses a credential that has already bought a policy', async () => {
      const built = await harness();
      const token = await issueCredential(built);
      const first = (await quoted(built)).json();
      const second = (await quoted(built)).json();
      const one = await built.app.inject({
        method: 'POST',
        url: '/v1/bind',
        headers: { authorization: `Bearer ${token}` },
        payload: { quote_id: first.quote_id },
      });
      expect(one.statusCode).toBe(201);
      // The credential is consumed, so the second attempt is refused before it
      // can reach the one-active-policy rule.
      const two = await built.app.inject({
        method: 'POST',
        url: '/v1/bind',
        headers: { authorization: `Bearer ${token}` },
        payload: { quote_id: second.quote_id },
      });
      expect(two.statusCode).toBe(409);
      expect(['credential_consumed', 'already_covered']).toContain(two.json().code);
    });

    it('needs a credential', async () => {
      const built = await harness();
      const quote = (await quoted(built)).json();
      const response = await built.app.inject({
        method: 'POST',
        url: '/v1/bind',
        payload: { quote_id: quote.quote_id },
      });
      expect(response.statusCode).toBe(401);
      expect(response.json().code).toBe('credential_missing');
    });

    it('refuses a credential this API did not sign', async () => {
      const built = await harness();
      const quote = (await quoted(built)).json();
      const response = await built.app.inject({
        method: 'POST',
        url: '/v1/bind',
        headers: { authorization: 'Bearer not.a.token' },
        payload: { quote_id: quote.quote_id },
      });
      expect(response.statusCode).toBe(401);
      expect(response.json().code).toBe('credential_invalid');
    });

    it('passes an expired credential through as 403, not 401', async () => {
      const built = await harness();
      const quote = (await quoted(built)).json();
      // Issued two hours ago, so it expired ninety minutes ago at the
      // thirty minute lifetime. The status matters: 403 sends a person back to
      // verify again, 401 tells them their check was never valid.
      const stale = await built.services.issuer.issue(
        {
          nullifier: '999',
          group: 'computer_math',
          series_id: 'ODI-COMP-2026-01',
          wallet: POLICYHOLDER_1.accountId,
          wallet_evm: POLICYHOLDER_1.address,
          scope: 'bind',
          world: {
            action: 'occupation-cover-eligibility',
            environment: 'demo',
            credential: 'demo-issuer',
            verified_at: 1_757_000_000,
            presence: false,
          },
        },
        new Date(Date.now() - 2 * 60 * 60 * 1000),
      );
      const response = await built.app.inject({
        method: 'POST',
        url: '/v1/bind',
        headers: { authorization: `Bearer ${stale.token}` },
        payload: { quote_id: quote.quote_id },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().code).toBe('credential_expired');
    });

    it('refuses when the quote and the credential name different wallets', async () => {
      const built = await harness();
      const quote = (await quoted(built)).json();
      const token = await issueCredential(built, { wallet: '0.0.10366457' });
      const response = await built.app.inject({
        method: 'POST',
        url: '/v1/bind',
        headers: { authorization: `Bearer ${token}` },
        payload: { quote_id: quote.quote_id },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json().code).toBe('wallet_mismatch');
    });

    it('refuses two different credentials in the header and the body', async () => {
      const built = await harness();
      const quote = (await quoted(built)).json();
      const token = await issueCredential(built);
      const response = await built.app.inject({
        method: 'POST',
        url: '/v1/bind',
        headers: { authorization: `Bearer ${token}` },
        payload: { quote_id: quote.quote_id, eligibility: 'a.different.token' },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe('credential_ambiguous');
    });

    it('takes the credential from the body when there is no header', async () => {
      const built = await harness();
      const quote = (await quoted(built)).json();
      const token = await issueCredential(built);
      const response = await built.app.inject({
        method: 'POST',
        url: '/v1/bind',
        payload: { quote_id: quote.quote_id, eligibility: token },
      });
      expect(response.statusCode).toBe(201);
    });

    it('maps a CapacityExceeded revert to insufficient_capacity, not a 502', async () => {
      const built = await harness();
      const quote = (await quoted(built)).json();
      const token = await issueCredential(built);
      built.chain.bindError = Object.assign(new Error('reverted'), {
        revert: { name: 'CapacityExceeded' },
      });
      const response = await built.app.inject({
        method: 'POST',
        url: '/v1/bind',
        headers: { authorization: `Bearer ${token}` },
        payload: { quote_id: quote.quote_id },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json().code).toBe('insufficient_capacity');
      // The orphaned receipt is resolved rather than left to be read as a
      // policy that exists.
      const messages = built.hedera.published.map((entry) => JSON.parse(entry.message));
      expect(messages[1]).toMatchObject({ status: 'failed', reason: 'insufficient_capacity' });
    });

    it('keeps the cover when the receipt fails to mint, and resolves the message', async () => {
      const built = await harness();
      const quote = (await quoted(built)).json();
      const token = await issueCredential(built);
      built.hedera.mintError = new Error('TOKEN_WAS_DELETED');

      const response = await built.app.inject({
        method: 'POST',
        url: '/v1/bind',
        headers: { authorization: `Bearer ${token}` },
        payload: { quote_id: quote.quote_id },
      });

      // CoverPool holds the policy and the exposure is committed, so this is a
      // bind that worked with a receipt that did not, never a failed bind.
      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.status).toBe('bound');
      expect(body.nft.serial).toBeNull();
      expect(body.chain.bind_transaction).toMatch(/^0x/);

      // The binding message is still resolved, so nothing on the topic is left
      // claiming a policy whose outcome nobody wrote.
      const messages = built.hedera.published.map((entry) => JSON.parse(entry.message));
      expect(messages).toHaveLength(2);
      expect(messages[1]).toMatchObject({
        status: 'bound',
        receiptSeq: 41,
        reason: 'nft_mint_failed',
      });
      expect(messages[1].serial).toBeUndefined();

      // The stored policy agrees with what was returned, so the poll the web
      // app makes sees the same thing.
      const stored = await built.repository.policy(body.policy_id);
      expect(stored?.status).toBe('bound');
      expect(stored?.nftSerial).toBeNull();
    });

    it('keeps the cover when the outcome message fails to publish', async () => {
      const built = await harness();
      const quote = (await quoted(built)).json();
      const token = await issueCredential(built);
      // The second publish is the outcome message. A 500 here would send a
      // person who already has cover back to a bind that answers already_covered.
      built.hedera.failPublishAt = 2;

      const response = await built.app.inject({
        method: 'POST',
        url: '/v1/bind',
        headers: { authorization: `Bearer ${token}` },
        payload: { quote_id: quote.quote_id },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().status).toBe('bound');
      expect(response.json().nft.serial).toBe(1);
    });

    it('refuses an expired quote', async () => {
      const built = await harness();
      const quote = (await quoted(built)).json();
      const token = await issueCredential(built);
      const stored = await built.repository.quote(quote.quote_id);
      await built.repository.insertQuote({
        ...(stored as NonNullable<typeof stored>),
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      });
      const response = await built.app.inject({
        method: 'POST',
        url: '/v1/bind',
        headers: { authorization: `Bearer ${token}` },
        payload: { quote_id: quote.quote_id },
      });
      expect(response.statusCode).toBe(410);
      expect(response.json().code).toBe('quote_expired');
    });
  });

  describe('GET /v1/policy/:id', () => {
    it('is free and carries nothing that identifies the person', async () => {
      const built = await harness();
      const quote = (await quoted(built)).json();
      const token = await issueCredential(built);
      const bound = await built.app.inject({
        method: 'POST',
        url: '/v1/bind',
        headers: { authorization: `Bearer ${token}` },
        payload: { quote_id: quote.quote_id },
      });
      const policyId = bound.json().policy_id;

      const response = await built.app.inject({ method: 'GET', url: `/v1/policy/${policyId}` });
      expect(response.statusCode).toBe(200);
      // Asserted against the serialised JSON, not the object: a field that
      // reaches the wire is a field that leaked.
      const text = response.body;
      expect(text).not.toContain('nullifier');
      expect(text).not.toContain(POLICYHOLDER_1.address);
      expect(text).not.toContain('employer');
      const body = response.json();
      expect(body.holder_account).toBe(POLICYHOLDER_1.accountId);
      expect(body.nft.serial).toBe(1);
    });

    it('answers 400 for an id with the wrong prefix', async () => {
      const built = await harness();
      const response = await built.app.inject({ method: 'GET', url: '/v1/policy/clm_01ABC' });
      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe('bad_id_prefix');
    });

    it('answers 404 for an id nobody issued', async () => {
      const built = await harness();
      const response = await built.app.inject({
        method: 'GET',
        url: '/v1/policy/pol_01K4YB9X3M8Q0RZ7T2VD6C5H9E',
      });
      expect(response.statusCode).toBe(404);
      expect(response.json().code).toBe('policy_not_found');
    });
  });

  describe('GET /v1/index/:group', () => {
    it('serves the latest reading, the history and both margins', async () => {
      const built = await buildTestServer({
        observations: [
          observation({ period: 202606, ebar: -0.7, odi: 0.2 }),
          observation({ period: 202607 }),
        ],
      });
      app = built.app;
      const response = await built.app.inject({ method: 'GET', url: '/v1/index/computer_math' });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.as_of).toBe('2026-07');
      expect(body.reading.ebar).toBe('-0.60');
      expect(body.trigger.level_line).toBe('-0.68');
      expect(body.trigger.attachment_shock).toBe('2.00');
      expect(body.trigger.level_margin).toBe('0.08');
      expect(body.trigger.shock_margin).toBe('-1.70');
      // The nearer form is chosen here so two screens cannot choose differently.
      expect(body.headline.form).toBe('level');
      expect(body.headline.distance).toBe('-0.08');
      expect(body.history).toHaveLength(2);
      expect(body.history[0].period).toBe('2026-06');
      expect(body.publication.sequence_number).toBeNull();
    });

    it('refuses an occupation the index does not cover', async () => {
      const built = await harness();
      const response = await built.app.inject({ method: 'GET', url: '/v1/index/armed_forces' });
      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe('group_unknown');
    });

    /// Thirty published months to July 2026, so the default and a longer ask
    /// differ. `period` is the YYYYMM integer the observations table stores.
    function thirtyMonths(): ObservationRow[] {
      const july2026 = 2026 * 12 + 6;
      return Array.from({ length: 30 }, (_unused, offset) => {
        const absolute = july2026 - 29 + offset;
        const period = Math.floor(absolute / 12) * 100 + (absolute % 12) + 1;
        return observation({ period, ebar: -0.6 - offset / 100 });
      });
    }

    it('carries twenty-four months, and more when the caller asks for more', async () => {
      const built = await buildTestServer({ observations: thirtyMonths() });
      app = built.app;

      const fallback = await built.app.inject({ method: 'GET', url: '/v1/index/computer_math' });
      expect(fallback.statusCode).toBe(200);
      expect(fallback.json().history).toHaveLength(24);

      const longer = await built.app.inject({
        method: 'GET',
        url: '/v1/index/computer_math?months=30',
      });
      expect(longer.statusCode).toBe(200);
      expect(longer.json().history).toHaveLength(30);
      // Oldest first either way, so a chart draws it in the order it arrives.
      expect(longer.json().history[29].period).toBe(fallback.json().history[23].period);
    });

    it('takes fewer months than the default when asked for fewer', async () => {
      const built = await buildTestServer({ observations: thirtyMonths() });
      app = built.app;
      const response = await built.app.inject({
        method: 'GET',
        url: '/v1/index/computer_math?months=6',
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().history).toHaveLength(6);
    });

    it('refuses a months that is not a whole number inside the ceiling', async () => {
      const built = await harness();
      for (const months of ['0', '121', 'six', '12.5', '-1', '']) {
        const response = await built.app.inject({
          method: 'GET',
          url: `/v1/index/computer_math?months=${months}`,
        });
        expect(response.statusCode, `months=${months}`).toBe(400);
        expect(response.json().code).toBe('months_invalid');
      }
    });
  });

  describe('the envelope', () => {
    it('answers every refusal as application/problem+json with a code', async () => {
      const built = await harness();
      const response = await built.app.inject({ method: 'GET', url: '/v1/nowhere' });
      expect(response.statusCode).toBe(404);
      expect(response.headers['content-type']).toContain('application/problem+json');
      const body = response.json();
      expect(body.code).toBe('route_not_found');
      expect(body.retryable).toBe(false);
      expect(typeof body.request_id).toBe('string');
    });
  });

  describe('the credential issuer', () => {
    it('publishes a JWKS with no private key material', async () => {
      const built = await harness();
      const response = await built.app.inject({
        method: 'GET',
        url: '/.well-known/jwks.json',
      });
      expect(response.statusCode).toBe(200);
      expect(response.body).not.toContain('"d"');
      const body = response.json();
      expect(body.keys[0].kty).toBe('OKP');
      expect(body.keys[0].crv).toBe('Ed25519');
    });

    it('mints a labelled demo credential a bind can use', async () => {
      const built = await harness();
      const response = await built.app.inject({
        method: 'POST',
        url: '/v1/demo/eligibility',
        payload: {
          group: 'computer_math',
          wallet: POLICYHOLDER_1.accountId,
          wallet_evm: POLICYHOLDER_1.address,
          nullifier: '123456789',
        },
      });
      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.issuer).toBe('demo');
      expect(body.warning).toContain('Demo only');
      const verified = await built.services.issuer.verify(body.eligibility);
      expect(verified.nullifier).toBe('123456789');
      expect(verified.series_id).toBe('ODI-COMP-2026-01');
    });

    it('refuses a hex nullifier, because casing would make one person two', async () => {
      const built = await harness();
      const response = await built.app.inject({
        method: 'POST',
        url: '/v1/demo/eligibility',
        payload: {
          group: 'computer_math',
          wallet: POLICYHOLDER_1.accountId,
          wallet_evm: POLICYHOLDER_1.address,
          nullifier: '0xAbC123',
        },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe('validation_failed');
    });
  });

  describe('GET /healthz', () => {
    it('returns the git SHA the definition of done asks for', async () => {
      const built = await harness();
      const response = await built.app.inject({ method: 'GET', url: '/healthz' });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.status).toBe('ok');
      expect(body.sha).toBe('testsha');
      expect(body.network).toBe('testnet');
    });
  });
});
