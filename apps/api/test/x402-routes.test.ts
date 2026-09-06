import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import type { FacilitatorClient } from '@x402/core/server';
import type {
  PaymentPayload,
  PaymentRequired,
  PaymentRequirements,
  SettleResponse,
  SupportedResponse,
  VerifyResponse,
} from '@x402/core/types';

import { buildOpenApiDocument } from '../src/openapi.js';
import { buildServer } from '../src/server.js';
import type { Services } from '../src/services.js';
import { X402Gate } from '../src/x402/gate.js';
import { TopicOutbox } from '../src/x402/settlement.js';
import type { X402Config } from '../src/x402/config.js';
import type { SettlementMessage } from '../src/x402/receipts.js';
import {
  buildTestServices,
  CONFIG,
  FakeHedera,
  issueCredential,
  POLICYHOLDER_1,
  type TestHarness,
} from './policy-fixtures.js';

/// The gate, with a stub facilitator standing in for Blocky402.
///
/// No unit test reaches the facilitator, signs a Hedera transaction or spends a
/// token: the real settlement is the testnet run in scripts/testnet/x402.ts and
/// its transaction id is in the pull request. What is checked here is
/// everything around it, which is where the mistakes live. That the three paid
/// endpoints refuse an unpaid request with a 402, a `PAYMENT-REQUIRED` header
/// and the price a payer needs. That the free ones are untouched. That a bind
/// is priced at the quote's premium and not at a table value. That a settled
/// payment reaches the `payments` table once and the payments topic once, with
/// the facilitator's transaction id on both.

const FEE_PAYER = '0.0.7162784';
const STEWARD = '0.0.10366451';

const X402_CONFIG: X402Config = {
  facilitatorUrl: 'https://api.testnet.blocky402.com',
  network: 'hedera:testnet',
  payTo: CONFIG.api.accountId,
  asset: CONFIG.settlementToken.tokenId,
  assetDecimals: 6,
  assetSymbol: 'TUSD',
  maxTimeoutSeconds: 60,
  index: { amount: '10000', display: '0.01' },
  quote: { amount: '50000', display: '0.05' },
  publicBaseUrl: CONFIG.publicBaseUrl,
};

class StubFacilitator implements FacilitatorClient {
  verifyResponse: VerifyResponse = { isValid: true, payer: STEWARD };
  settleFailure: Partial<SettleResponse> | null = null;
  readonly verified: PaymentRequirements[] = [];
  readonly settled: PaymentRequirements[] = [];
  private nanos = 0;

  async getSupported(): Promise<SupportedResponse> {
    return {
      kinds: [
        {
          x402Version: 2,
          scheme: 'exact',
          network: 'hedera:testnet',
          extra: { feePayer: FEE_PAYER },
        },
      ],
      extensions: [],
      signers: { 'hedera:*': [FEE_PAYER] },
    };
  }

  async verify(
    _payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    this.verified.push(requirements);
    return this.verifyResponse;
  }

  async settle(
    _payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<SettleResponse> {
    this.settled.push(requirements);
    this.nanos += 1;
    if (this.settleFailure !== null) {
      return {
        success: false,
        transaction: '',
        network: 'hedera:testnet',
        errorReason: 'transaction_failed',
        ...this.settleFailure,
      } as SettleResponse;
    }
    return {
      success: true,
      // Blocky402 names the field `transaction` and puts the paying wallet in
      // `payer`, which is what the testnet run saw.
      transaction: `${FEE_PAYER}@178860000${this.nanos}.000000000`,
      network: 'hedera:testnet',
      payer: STEWARD,
    };
  }
}

interface Gated extends TestHarness {
  app: FastifyInstance;
  gate: X402Gate;
  facilitator: StubFacilitator;
}

async function gated(): Promise<Gated> {
  const harness = await buildTestServices();
  const facilitator = new StubFacilitator();
  const gate = new X402Gate({
    config: X402_CONFIG,
    repository: harness.repository,
    hedera: harness.hedera,
    paymentsTopicId: CONFIG.paymentsTopicId,
    facilitatorClient: facilitator,
    // No test waits on a real timer, and no retry outlives its test.
    outbox: new TopicOutbox({ delay: async () => undefined }),
  });
  const services: Services = { ...harness.services, x402: gate };
  const app = await buildServer({ services });
  await app.ready();
  return { ...harness, app, gate, facilitator };
}

/** The requirements a 402 advertised, which a payer copies verbatim. */
function required(headers: Record<string, unknown>): PaymentRequired {
  const header = headers['payment-required'];
  expect(typeof header).toBe('string');
  return JSON.parse(Buffer.from(String(header), 'base64').toString('utf8')) as PaymentRequired;
}

/** A payment header for requirements the server just advertised. */
function paymentHeader(accepted: PaymentRequirements): string {
  const payload: PaymentPayload = {
    x402Version: 2,
    accepted,
    payload: { transaction: Buffer.from('a partially signed transfer').toString('base64') },
  };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

describe('the x402 gate', () => {
  let app: FastifyInstance | null = null;

  afterEach(async () => {
    await app?.close();
    app = null;
  });

  async function harness(): Promise<Gated> {
    const built = await gated();
    app = built.app;
    return built;
  }

  async function payFor(
    built: Gated,
    request: InjectOptions & { headers?: Record<string, string> },
  ): Promise<LightMyRequestResponse> {
    const unpaid = await built.app.inject(request);
    expect(unpaid.statusCode).toBe(402);
    const accepted = required(unpaid.headers)?.accepts[0] as PaymentRequirements;
    return await built.app.inject({
      ...request,
      headers: { ...request.headers, 'payment-signature': paymentHeader(accepted) },
    });
  }

  describe('an unpaid request', () => {
    it('refuses the index feed with a 402 and the price in the header', async () => {
      const built = await harness();
      const response = await built.app.inject({ method: 'GET', url: '/v1/index/computer_math' });

      expect(response.statusCode).toBe(402);
      const paymentRequired = required(response.headers);
      expect(paymentRequired.x402Version).toBe(2);
      const accepts = paymentRequired.accepts[0] as PaymentRequirements;
      expect(accepts.scheme).toBe('exact');
      expect(accepts.network).toBe('hedera:testnet');
      expect(accepts.amount).toBe('10000');
      expect(accepts.asset).toBe(CONFIG.settlementToken.tokenId);
      expect(accepts.payTo).toBe(CONFIG.api.accountId);
      // Not configured anywhere: the scheme copies it out of the facilitator's
      // supported kinds, and a payer cannot build a transaction without it.
      expect(accepts.extra?.['feePayer']).toBe(FEE_PAYER);
    });

    it('answers with the same problem document as every other refusal', async () => {
      const built = await harness();
      const response = await built.app.inject({ method: 'GET', url: '/v1/index/computer_math' });

      expect(response.headers['content-type']).toContain('application/problem+json');
      const body = response.json();
      expect(body.code).toBe('payment_required');
      expect(body.status).toBe(402);
      expect(body.retryable).toBe(false);
      expect(body.request_id).not.toBe('');
      expect(body.price).toEqual({
        amount: '10000',
        asset: CONFIG.settlementToken.tokenId,
        decimals: 6,
        display: '0.01',
      });
      expect(body.pay_to).toBe(CONFIG.api.accountId);
      expect(body.facilitator).toBe('https://api.testnet.blocky402.com');
    });

    it('carries every field the OpenAPI document promises a 402 carries', async () => {
      const built = await harness();
      const response = await built.app.inject({ method: 'GET', url: '/v1/index/computer_math' });

      // The document is imported into somebody else's product, so an agent that
      // reads it and never reads this repository has to be able to find the
      // price and the payment terms in the body it actually gets back.
      const documented = (
        buildOpenApiDocument({ version: '0.1.0' }) as {
          components: { schemas: { PaymentRequired: { required: string[] } } };
        }
      ).components.schemas.PaymentRequired.required;
      const body = response.json() as Record<string, unknown>;
      for (const field of documented) {
        expect(body[field], field).toBeDefined();
      }
    });

    it('refuses a quote at the quote price', async () => {
      const built = await harness();
      const response = await built.app.inject({
        method: 'POST',
        url: '/v1/quote',
        payload: { group: 'computer_math', limit: '5000000000', wallet: POLICYHOLDER_1.accountId },
      });
      expect(response.statusCode).toBe(402);
      expect((required(response.headers).accepts[0] as PaymentRequirements).amount).toBe('50000');
    });

    it('refuses a quote at the same price when the caller carries a credential', async () => {
      const built = await harness();
      const credential = await issueCredential(built);

      const response = await built.app.inject({
        method: 'POST',
        url: '/v1/quote',
        headers: { authorization: `Bearer ${credential}` },
        payload: { group: 'computer_math', limit: '5000000000', wallet: POLICYHOLDER_1.accountId },
      });

      // A quote is a plain paid call, DESIGN.md 3.7. The gate is an onRequest
      // hook over a route map of prices and it never reads `authorization`, so
      // an eligibility credential buys nothing here. The OpenAPI document said
      // otherwise until T19, and this is what holds the two together.
      expect(response.statusCode).toBe(402);
      expect((required(response.headers).accepts[0] as PaymentRequirements).amount).toBe('50000');
      expect(response.json().price.amount).toBe('50000');
    });

    it('leaves the free endpoints alone', async () => {
      const built = await harness();
      expect((await built.app.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200);
      const policy = await built.app.inject({ method: 'GET', url: '/v1/policy/policy_missing' });
      expect(policy.statusCode).not.toBe(402);
      expect(
        (await built.app.inject({ method: 'GET', url: '/.well-known/jwks.json' })).statusCode,
      ).toBe(200);
      // The attribution feed is the caveats on the paid product: what the
      // index cannot tell you and how weakly the AI attribution lines up with
      // it. Charging for that would be the wrong way round. It sits outside
      // the metered prefix so it needs no carve out, and this is what says so.
      const attribution = await built.app.inject({ method: 'GET', url: '/v1/attribution' });
      expect(attribution.statusCode).toBe(200);
    });

    // The catalogue is the discovery route: it is what tells an agent which
    // group keys exist and what a reading costs, so metering it would mean a
    // caller had to pay to find out how to pay. It sits at `/v1/index` with no
    // trailing segment, one character away from the `GET /v1/index/*` glob, and
    // this is the test that says so.
    it('does not meter the catalogue, which is how a caller learns the price', async () => {
      const built = await harness();
      const response = await built.app.inject({ method: 'GET', url: '/v1/index' });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { price: { amount: string; pay_to: string } };
      // With the gate on it quotes the gate's own price, not a second copy of
      // it: one number, read from the configuration the 402 is built from.
      expect(body.price.amount).toBe('10000');
      expect(body.price.pay_to).toBe(CONFIG.api.accountId);
    });

    // The replay badge sat at GET /v1/index/replay until T12 merged this gate.
    // The route map pattern is a glob, `GET /v1/index/*`, so it matched, and a
    // configured gate answered the badge with a 402. The endpoint moved out
    // from under the prefix rather than being carved out of the glob. T26's
    // health endpoint has the same constraint.
    // server.ts registers the plugin with no options, so the route reads
    // ORACLE_STATE_PATH. Point it at a path that does not exist for the length
    // of this test: otherwise the body is whatever a local `pnpm oracle:replay`
    // last left in var/oracle, and the test passes or fails by accident.
    it('does not meter the oracle run state, which is not an index reading', async () => {
      const previous = process.env.ORACLE_STATE_PATH;
      process.env.ORACLE_STATE_PATH = join(tmpdir(), 'no-such-creance-state.json');
      try {
        const built = await harness();
        const response = await built.app.inject({ method: 'GET', url: '/v1/replay' });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({ mode: 'live', running: false });
      } finally {
        if (previous === undefined) delete process.env.ORACLE_STATE_PATH;
        else process.env.ORACLE_STATE_PATH = previous;
      }
    });
    // The one route this gate exempts by name. It sits under the metered
    // prefix, which is where docs/INDEX-SPEC.md section 9 puts it, and the
    // route map pattern matches one non-empty segment, so `health` matches as
    // readily as `computer_math`. An operations endpoint that answers 402 to an
    // operator is not an operations endpoint, and this is the test that says
    // the exemption is still there.
    it('does not meter the index health endpoint, which is operations and not a reading', async () => {
      const previous = {
        state: process.env.ORACLE_STATE_PATH,
        runs: process.env.ORACLE_RUNS_PATH,
      };
      process.env.ORACLE_STATE_PATH = join(tmpdir(), 'no-such-creance-state.json');
      process.env.ORACLE_RUNS_PATH = join(tmpdir(), 'no-such-creance-runs.json');
      try {
        const built = await harness();
        const response = await built.app.inject({ method: 'GET', url: '/v1/index/health' });

        expect(response.statusCode).toBe(200);
        expect(response.headers['payment-required']).toBeUndefined();
        expect(response.json()).toMatchObject({ status: 'never_run', mode: 'live' });
      } finally {
        if (previous.state === undefined) delete process.env.ORACLE_STATE_PATH;
        else process.env.ORACLE_STATE_PATH = previous.state;
        if (previous.runs === undefined) delete process.env.ORACLE_RUNS_PATH;
        else process.env.ORACLE_RUNS_PATH = previous.runs;
      }
    });

    // Fastify matches a static segment before a parameter, so the reading route
    // never sees `health`. The gate exempts the path and the router keeps the
    // two apart; both have to hold, and this is the second one.
    it('still meters a reading for a group, which is what the exemption must not widen', async () => {
      const built = await harness();
      const response = await built.app.inject({ method: 'GET', url: '/v1/index/computer_math' });
      expect(response.statusCode).toBe(402);
    });
  });

  describe('a paid request', () => {
    it('serves the index feed and returns the settlement receipt', async () => {
      const built = await harness();
      const response = await payFor(built, { method: 'GET', url: '/v1/index/computer_math' });

      expect(response.statusCode).toBe(200);
      expect(response.json().group).toBe('computer_math');
      const receipt = response.headers['payment-response'];
      const settlement = JSON.parse(
        Buffer.from(String(receipt), 'base64').toString('utf8'),
      ) as SettleResponse;
      expect(settlement.success).toBe(true);
      expect(settlement.transaction).toMatch(/^0\.0\.7162784@/);
    });

    it('writes one payments row and one topic message', async () => {
      const built = await harness();
      await payFor(built, { method: 'GET', url: '/v1/index/computer_math' });
      await built.gate.outbox.drain();

      const rows = built.repository.paymentsFor('computer_math');
      expect(rows).toHaveLength(1);
      const row = rows[0]!;
      expect(row.endpoint).toBe('GET /v1/index/:group');
      expect(row.status).toBe('settled');
      expect(row.payer).toBe(STEWARD);
      expect(row.payTo).toBe(CONFIG.api.accountId);
      expect(row.amount).toBe('10000');
      expect(row.asset).toBe(CONFIG.settlementToken.tokenId);
      expect(row.facilitatorTx).toMatch(/^0\.0\.7162784@/);
      expect(row.settledAt).not.toBeNull();

      const published = built.hedera.published;
      expect(published).toHaveLength(1);
      expect(published[0]!.topicId).toBe(CONFIG.paymentsTopicId);
      const message = JSON.parse(published[0]!.message) as SettlementMessage;
      expect(message).toMatchObject({
        v: 1,
        kind: 'settlement',
        endpoint: 'GET /v1/index/:group',
        x402: 2,
        scheme: 'exact',
        network: 'hedera:testnet',
        payer: STEWARD,
        payTo: CONFIG.api.accountId,
        amount: '10000',
        asset: CONFIG.settlementToken.tokenId,
        decimals: 6,
        facilitator: 'api.testnet.blocky402.com',
        ref: 'computer_math',
      });
      expect(message.tx).toBe(row.facilitatorTx);
      // The row points at its own receipt, which is what a reconciliation reads.
      expect(row.hcsSeq).toBe(41);
    });

    it('records a paid quote as issued over x402 and refers to the quote it bought', async () => {
      const built = await harness();
      const response = await payFor(built, {
        method: 'POST',
        url: '/v1/quote',
        payload: { group: 'computer_math', limit: '5000000000', wallet: POLICYHOLDER_1.accountId },
      });
      expect(response.statusCode).toBe(201);
      await built.gate.outbox.drain();

      const quoteId = response.json().quote_id;
      expect((await built.repository.quote(quoteId))?.issuedVia).toBe('x402');
      const rows = built.repository.paymentsFor(quoteId);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.endpoint).toBe('POST /v1/quote');
      expect(rows[0]!.amount).toBe('50000');
    });
  });

  describe('the bind', () => {
    async function quoted(built: Gated): Promise<{ quoteId: string; premium: string }> {
      const response = await payFor(built, {
        method: 'POST',
        url: '/v1/quote',
        payload: { group: 'computer_math', limit: '5000000000', wallet: POLICYHOLDER_1.accountId },
      });
      expect(response.statusCode).toBe(201);
      return { quoteId: response.json().quote_id, premium: response.json().premium.amount };
    }

    it('is priced at the quote premium, not at a table price', async () => {
      const built = await harness();
      const { quoteId, premium } = await quoted(built);
      const credential = await issueCredential(built);

      const response = await built.app.inject({
        method: 'POST',
        url: '/v1/bind',
        headers: { authorization: `Bearer ${credential}` },
        payload: { quote_id: quoteId },
      });
      expect(response.statusCode).toBe(402);
      const accepts = required(response.headers).accepts[0] as PaymentRequirements;
      expect(accepts.amount).toBe(premium);
      expect(BigInt(premium) > 0n).toBe(true);
      expect(response.json().price.amount).toBe(premium);
    });

    it('settles the uncollected row the bind wrote rather than writing a second', async () => {
      const built = await harness();
      const { quoteId, premium } = await quoted(built);
      const credential = await issueCredential(built);
      const response = await payFor(built, {
        method: 'POST',
        url: '/v1/bind',
        headers: { authorization: `Bearer ${credential}` },
        payload: { quote_id: quoteId },
      });
      expect(response.statusCode).toBe(201);
      await built.gate.outbox.drain();

      const policyId = response.json().policy_id;
      const rows = built.repository.paymentsFor(policyId);
      expect(rows).toHaveLength(1);
      const row = rows[0]!;
      expect(row.endpoint).toBe('POST /v1/bind');
      expect(row.status).toBe('settled');
      expect(row.amount).toBe(premium);
      // T07 wrote the row with the holder on it; the account that signed the
      // transfer is the one filed as the payer.
      expect(row.payer).toBe(STEWARD);
      expect(row.facilitator).toBe('https://api.testnet.blocky402.com');
      expect(row.facilitatorTx).toMatch(/^0\.0\.7162784@/);

      const settlements = built.hedera.published
        .map((entry) => JSON.parse(entry.message) as { kind: string; ref?: string })
        .filter((message) => message.kind === 'settlement');
      // Two payments in this run, the quote and the bind, and one message each.
      expect(settlements.map((message) => message.ref)).toEqual([quoteId, policyId]);
    });

    it('never reaches the facilitator for a quote that cannot be bound', async () => {
      const built = await harness();
      const credential = await issueCredential(built);
      const response = await built.app.inject({
        method: 'POST',
        url: '/v1/bind',
        headers: { authorization: `Bearer ${credential}` },
        payload: { quote_id: 'quote_not_a_quote' },
      });
      expect(response.statusCode).toBe(404);
      expect(response.json().code).toBe('quote_not_found');
      expect(built.facilitator.verified).toHaveLength(0);
    });

    it('takes no payment when the bind itself fails', async () => {
      const built = await harness();
      const { quoteId } = await quoted(built);
      built.chain.bindError = new Error('execution reverted: SeriesPaused()');
      const credential = await issueCredential(built);

      const response = await payFor(built, {
        method: 'POST',
        url: '/v1/bind',
        headers: { authorization: `Bearer ${credential}` },
        payload: { quote_id: quoteId },
      });
      expect(response.statusCode).toBeGreaterThanOrEqual(400);
      // Verified, because the gate checks the payment before it does the work,
      // and never settled, because the work did not happen.
      expect(built.facilitator.verified.length).toBeGreaterThan(0);
      expect(built.facilitator.settled.filter((r) => r.amount !== '50000')).toHaveLength(0);
    });

    it('marks the premium failed when the settlement fails after the policy is real', async () => {
      const built = await harness();
      const { quoteId } = await quoted(built);
      const credential = await issueCredential(built);
      built.facilitator.settleFailure = { errorMessage: 'TOKEN_NOT_ASSOCIATED_TO_ACCOUNT' };

      const response = await payFor(built, {
        method: 'POST',
        url: '/v1/bind',
        headers: { authorization: `Bearer ${credential}` },
        payload: { quote_id: quoteId },
      });
      expect(response.statusCode).toBe(201);
      await built.gate.outbox.drain();

      const policyId = response.json().policy_id;
      expect(built.repository.paymentsFor(policyId)[0]!.status).toBe('failed');
      // Nothing on the topic for the premium: the audit trail may not carry a
      // payment that did not happen. The quote's own settlement is still there.
      const settlements = built.hedera.published
        .map((entry) => JSON.parse(entry.message) as { kind: string; ref?: string })
        .filter((message) => message.kind === 'settlement');
      expect(settlements.map((message) => message.ref)).toEqual([quoteId]);
    });
  });

  describe('when the payments topic refuses the message', () => {
    async function withPublisher(failures: number, attempts: number) {
      const harnessed = await buildTestServices();
      const hedera = harnessed.hedera as FakeHedera;
      let refused = 0;
      const publish = hedera.publish.bind(hedera);
      hedera.publish = async (topicId: string, message: string) => {
        if (refused < failures) {
          refused += 1;
          throw new Error('the topic refused the message');
        }
        return await publish(topicId, message);
      };
      const gate = new X402Gate({
        config: X402_CONFIG,
        repository: harnessed.repository,
        hedera,
        paymentsTopicId: CONFIG.paymentsTopicId,
        facilitatorClient: new StubFacilitator(),
        outbox: new TopicOutbox({ attempts, delay: async () => undefined }),
      });
      const built = await buildServer({ services: { ...harnessed.services, x402: gate } });
      app = built;
      await built.ready();

      const unpaid = await built.inject({ method: 'GET', url: '/v1/index/computer_math' });
      const accepted = required(unpaid.headers).accepts[0] as PaymentRequirements;
      const paid = await built.inject({
        method: 'GET',
        url: '/v1/index/computer_math',
        headers: { 'payment-signature': paymentHeader(accepted) },
      });
      expect(paid.statusCode).toBe(200);
      await gate.outbox.drain();
      return { hedera, repository: harnessed.repository };
    }

    it('retries and carries the message on the second attempt', async () => {
      const { hedera, repository } = await withPublisher(1, 3);
      const row = repository.paymentsFor('computer_math')[0]!;
      expect(row.status).toBe('settled');
      expect(row.hcsSeq).not.toBeNull();
      expect(hedera.published).toHaveLength(1);
    });

    it('keeps the settled row when every attempt fails, so it can be reconciled', async () => {
      const { hedera, repository } = await withPublisher(5, 2);
      const row = repository.paymentsFor('computer_math')[0]!;
      // The money moved and the row says so. A settled row with no sequence
      // number is the reconciliation list, and it is a query rather than a hunt
      // through the log.
      expect(row.status).toBe('settled');
      expect(row.facilitatorTx).not.toBeNull();
      expect(row.hcsSeq).toBeNull();
      expect(hedera.published).toHaveLength(0);
    });
  });
});
