import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import {
  mapSubscribeRevert,
  type SubscriptionGateway,
  type SubscriptionWrite,
  type VaultSeriesTerms,
} from '../src/chain/vault.js';
import { registerErrorHandling } from '../src/errors.js';
import { subscribeRoutes } from '../src/routes/subscribe.js';
import { buildTestServer, buildTestServices, CONFIG, DEMO_SERIES_KEY } from './policy-fixtures.js';

/// POST /v1/subscribe, driven through Fastify's own injector with a vault that
/// answers from recorded values. No relay, no mirror node, no key: the rule for
/// every test outside the testnet stage.
///
/// The two facts worth holding are the ones a reader is most likely to assume
/// the other way round. The amount is added to what the holder already carries,
/// which is what `subscribe` on the vault does. And the money comes out of the
/// api account, so the holder is refused unless this deployment already speaks
/// for it.

const INVESTOR_1 = '0xb6c2ff466e3c73f1a49a3f1b936f8e3837112931';
const API_ACCOUNT = '0x7c02879d6b95f923681f517b0487aa45af2b8fdf';

/** Far enough ahead that the maturity gate is not what a test is measuring. */
const MATURES_AT = Math.floor(Date.parse('2027-09-05T00:00:00Z') / 1000);

const SUBSCRIBED = 50_000_000_000n;
const AMOUNT = '25000000000';

interface Call {
  seriesKey: string;
  holder: string;
  amount: bigint;
}

class FakeVault implements SubscriptionGateway {
  readonly calls: Call[] = [];
  canSign = true;
  payer: string | null = API_ACCOUNT;
  maturityAt = MATURES_AT;
  balance = 1_000_000_000_000n;
  error: Error | null = null;
  /** What the vault carries for the holder, moved on by a subscription. */
  private subscription = SUBSCRIBED;

  async seriesTerms(): Promise<VaultSeriesTerms> {
    return { maturityAt: this.maturityAt, principalFunded: 100_000_000_000n };
  }

  async subscriptionOf(): Promise<bigint> {
    return this.subscription;
  }

  async settlementBalanceOf(): Promise<bigint> {
    return this.balance;
  }

  async subscribe(seriesKey: string, holder: string, amount: bigint): Promise<SubscriptionWrite> {
    if (this.error !== null) throw this.error;
    this.calls.push({ seriesKey, holder, amount });
    // The vault adds. A fake that replaced the figure would let the route claim
    // an idempotency it does not have.
    this.subscription += amount;
    return {
      approveTx: `0x${'aa'.repeat(32)}`,
      subscribeTx: `0x${'bb'.repeat(32)}`,
      gasUsed: '141378',
    };
  }
}

/** A revert as ethers hands one back, decoded against the vault ABI. */
function reverted(name: string): Error {
  return Object.assign(new Error(`execution reverted`), { revert: { name } });
}

async function serve(vault: FakeVault): Promise<FastifyInstance> {
  const { services } = await buildTestServices();
  const app = Fastify();
  registerErrorHandling(app);
  await app.register(subscribeRoutes, { services, vault });
  await app.ready();
  return app;
}

describe('POST /v1/subscribe', () => {
  let app: FastifyInstance | null = null;

  afterEach(async () => {
    await app?.close();
    app = null;
  });

  async function post(vault: FakeVault, payload: Record<string, unknown>) {
    app = await serve(vault);
    return await app.inject({ method: 'POST', url: '/v1/subscribe', payload });
  }

  it('approves and subscribes, and reports both transactions', async () => {
    const vault = new FakeVault();
    const response = await post(vault, {
      series: 'ODI-COMP-2026-01',
      holder: 'investor-1',
      amount: AMOUNT,
    });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.transactions).toEqual({
      approve: `0x${'aa'.repeat(32)}`,
      subscribe: `0x${'bb'.repeat(32)}`,
    });
    expect(body.gas_used).toBe('141378');
    expect(body.series_key).toBe(DEMO_SERIES_KEY);
    expect(body.holder.address).toBe(INVESTOR_1);
    // The money left the api account and not the holder's, and the response
    // says so rather than leaving it to be inferred.
    expect(body.paid_by.address).toBe(API_ACCOUNT);
    expect(body.paid_by.account_id).toBe(CONFIG.api.accountId);
    expect(vault.calls).toEqual([
      { seriesKey: DEMO_SERIES_KEY, holder: INVESTOR_1, amount: BigInt(AMOUNT) },
    ]);
  });

  it('adds to a subscription the holder already carries rather than topping up to it', async () => {
    const vault = new FakeVault();
    const response = await post(vault, {
      series: 'ODI-COMP-2026-01',
      holder: INVESTOR_1,
      amount: AMOUNT,
    });
    const body = response.json();
    expect(body.subscription_before.amount).toBe('50000000000');
    expect(body.subscription_after.amount).toBe('75000000000');
    expect(body.amount.display).toBe('25000.00');
  });

  it('takes a holder by role, account id or address, and names the one it credited', async () => {
    for (const holder of ['investor-1', '0.0.10366460', INVESTOR_1.toUpperCase()]) {
      const vault = new FakeVault();
      const response = await post(vault, { series: 'computer_math', holder, amount: AMOUNT });
      expect(response.statusCode, holder).toBe(201);
      expect(response.json().holder.role).toBe('investor-1');
      await app?.close();
      app = null;
    }
  });

  it('refuses an account this deployment does not pay for, and signs nothing', async () => {
    const vault = new FakeVault();
    const response = await post(vault, {
      series: 'ODI-COMP-2026-01',
      holder: '0x1111111111111111111111111111111111111111',
      amount: AMOUNT,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('holder_unknown');
    expect(vault.calls).toEqual([]);
  });

  it('refuses a series this network does not serve', async () => {
    const vault = new FakeVault();
    const response = await post(vault, { series: 'ODI-NOPE-2026-01', holder: 'investor-1', amount: AMOUNT });
    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe('series_not_found');
    expect(vault.calls).toEqual([]);
  });

  it('refuses a series the vault never opened, which reads back as a zero maturity', async () => {
    const vault = new FakeVault();
    vault.maturityAt = 0;
    const response = await post(vault, {
      series: 'ODI-COMP-2026-01',
      holder: 'investor-1',
      amount: AMOUNT,
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe('series_not_open');
    expect(vault.calls).toEqual([]);
  });

  it('refuses a series that has matured', async () => {
    const vault = new FakeVault();
    vault.maturityAt = Math.floor(Date.parse('2026-01-01T00:00:00Z') / 1000);
    const response = await post(vault, {
      series: 'ODI-COMP-2026-01',
      holder: 'investor-1',
      amount: AMOUNT,
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('series_matured');
    expect(vault.calls).toEqual([]);
  });

  it('refuses before the approve when the paying account is short', async () => {
    const vault = new FakeVault();
    vault.balance = 1n;
    const response = await post(vault, {
      series: 'ODI-COMP-2026-01',
      holder: 'investor-1',
      amount: AMOUNT,
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('settlement_balance_short');
    // The approve is the dear half of the pair, so a refusal that costs it is
    // the one thing this check exists to prevent.
    expect(vault.calls).toEqual([]);
  });

  it('refuses an amount that is not a whole number of minor units', async () => {
    for (const amount of ['25000.5', 25_000, '-1']) {
      const vault = new FakeVault();
      const response = await post(vault, {
        series: 'ODI-COMP-2026-01',
        holder: 'investor-1',
        amount,
      });
      expect(response.statusCode, String(amount)).toBe(400);
      await app?.close();
      app = null;
    }
  });

  it('refuses nought rather than sending a call the vault would revert', async () => {
    const vault = new FakeVault();
    const response = await post(vault, {
      series: 'ODI-COMP-2026-01',
      holder: 'investor-1',
      amount: '0',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('amount_invalid');
    expect(vault.calls).toEqual([]);
  });

  it('answers 503 on a deployment holding no key for the paying account', async () => {
    const vault = new FakeVault();
    vault.canSign = false;
    const response = await post(vault, {
      series: 'ODI-COMP-2026-01',
      holder: 'investor-1',
      amount: AMOUNT,
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().code).toBe('subscription_writes_unavailable');
    expect(vault.calls).toEqual([]);
  });

  it('turns a revert into something the caller can act on', async () => {
    const cases: [string, number, string][] = [
      ['SeriesMatured', 409, 'series_matured'],
      ['EnforcedPause', 409, 'vault_paused'],
      ['AccessControlUnauthorizedAccount', 502, 'subscription_role_missing'],
      ['SafeERC20FailedOperation', 502, 'settlement_transfer_failed'],
      ['SomethingNobodyHasSeen', 502, 'chain_write_failed'],
    ];
    for (const [name, status, code] of cases) {
      const vault = new FakeVault();
      vault.error = reverted(name);
      const response = await post(vault, {
        series: 'ODI-COMP-2026-01',
        holder: 'investor-1',
        amount: AMOUNT,
      });
      expect(response.statusCode, name).toBe(status);
      expect(response.json().code, name).toBe(code);
      await app?.close();
      app = null;
    }
  });

  it('is registered on the server, and refuses without a key rather than 404ing', async () => {
    // The built server has no operator key in a test, so its own gateway cannot
    // sign. What matters here is that the route exists at all: the screen had
    // nothing to post to before this.
    const built = await buildTestServer();
    app = built.app;
    const response = await app.inject({
      method: 'POST',
      url: '/v1/subscribe',
      payload: { series: 'ODI-COMP-2026-01', holder: 'investor-1', amount: AMOUNT },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().code).toBe('subscription_writes_unavailable');
  });
});

describe('a reverted subscription', () => {
  it('reads its name out of the shortMessage when there is no receipt to decode', () => {
    const error = {
      shortMessage: "execution reverted with custom error 'SeriesUnknown(bytes32)'",
    };
    expect(mapSubscribeRevert(error).code).toBe('series_not_open');
  });

  it('says nothing was charged when it cannot name what went wrong', () => {
    const mapped = mapSubscribeRevert(new Error('the relay timed out'));
    expect(mapped.status).toBe(502);
    expect(mapped.message).toContain('Nothing was charged');
  });
});
