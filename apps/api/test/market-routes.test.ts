import Fastify, { type FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';

import type { SeriesConfig } from '../src/investor/config.js';
import {
  FillRefused,
  type MarketReader,
  type MarketWriter,
  type NoteHolding,
  type OfferReadiness,
  type OfferState,
} from '../src/market/chain.js';
import type { MarketAccount, MarketConfig } from '../src/market/config.js';
import { marketRoutes } from '../src/market/index.js';
import { pricePerUnit } from '../src/market/view.js';

/// The market endpoints, driven through Fastify's own injector with a reader
/// and a writer that answer from fixtures. No relay, no mirror node, no key.

const TOKEN = {
  tokenId: '0.0.10366463',
  address: '0x00000000000000000000000000000000009e2dff',
  decimals: 6,
  symbol: 'TUSD',
};

const NOTE = '0x508ef4e5639e99f76F74ec56B488Ebaec78ABb75';
const OPERATOR = '0x639444758b987b4d938c57169a1f61a62b2d009c';
const INVESTOR_1 = '0xb6c2ff466e3c73f1a49a3f1b936f8e3837112931';
const INVESTOR_2 = '0xcaa1184cd59b9296f757efc7303a10ecec6ce51e';
const OUTSIDER = '0xb4e3e57d1f4dfedf146e59ff6f1ae478fbb81c9e';
const VENUE = '0xe0c2b9e65AB57Bb8b86E0fd152C56Cf9499B6FCf';
const ZERO = '0x0000000000000000000000000000000000000000';

const SERIES: SeriesConfig = {
  label: 'ODI-OFFC-2026-01',
  seriesId: '0x4f44492d4f4646432d323032362d303100000000000000000000000000000000',
  group: 'office_admin_support',
  kind: 'occupation',
  maturityAt: 1820564654,
  vault: { address: '0xD0473d355ECB299F2ECc0d92124bc8CF63554e60', contractId: '0.0.10367194' },
  note: { address: NOTE, contractId: '0.0.10455865', symbol: 'CDBN02' },
  settlementToken: TOKEN,
  holders: [],
  coupons: [],
};

const ACCOUNTS: MarketAccount[] = [
  { role: 'operator', accountId: '0.0.10362512', address: OPERATOR },
  { role: 'investor-1', accountId: '0.0.10366460', address: INVESTOR_1 },
  { role: 'investor-2', accountId: '0.0.10366462', address: INVESTOR_2 },
  { role: 'policyholder-3', accountId: '0.0.10366458', address: OUTSIDER },
];

const CONFIG: MarketConfig = {
  network: 'testnet',
  rpcUrl: 'https://testnet.hashio.io/api',
  venue: { address: VENUE, contractId: '0.0.10495570' },
  series: [SERIES],
  settlementToken: TOKEN,
  accounts: ACCOUNTS,
};

const UNIT = 1_000_000n;

const OFFERS: OfferState[] = [
  {
    offerId: '1',
    note: NOTE,
    seller: OPERATOR,
    buyer: INVESTOR_1,
    units: 5n * UNIT,
    price: 5_000n * UNIT,
    openedAt: 1789130000,
    closedAt: 1789130400,
    status: 2,
  },
  {
    offerId: '2',
    note: NOTE,
    seller: INVESTOR_1,
    buyer: ZERO,
    units: 2n * UNIT,
    price: 2_100n * UNIT,
    openedAt: 1789131000,
    closedAt: 0,
    status: 1,
  },
];

class FakeMarket implements MarketReader, MarketWriter {
  readonly calls: string[] = [];

  constructor(
    private readonly kyc: Record<string, number> = {
      [OPERATOR]: 1,
      [INVESTOR_1]: 1,
      [INVESTOR_2]: 1,
    },
    private readonly money: Record<string, bigint> = {
      [INVESTOR_1]: 200_000n * UNIT,
      [INVESTOR_2]: 200_000n * UNIT,
      [OUTSIDER]: 200_000n * UNIT,
    },
  ) {}

  async offerCount(): Promise<number> {
    return OFFERS.length;
  }

  async offerAt(_venue: string, offerId: number): Promise<OfferState> {
    const entry = OFFERS[offerId - 1];
    if (entry === undefined) throw new Error(`no offer ${offerId}`);
    return entry;
  }

  async readiness(): Promise<OfferReadiness> {
    return { open: true, sellerHolds: true, sellerApproved: true };
  }

  async holding(series: SeriesConfig, address: string): Promise<NoteHolding | null> {
    if (series.note === undefined) return null;
    const held = address.toLowerCase() === INVESTOR_1.toLowerCase() ? 3n * UNIT : 0n;
    return { balance: held, frozen: 0n, kycStatus: this.kyc[address.toLowerCase()] ?? 0 };
  }

  async settlementBalance(address: string): Promise<bigint> {
    return this.money[address.toLowerCase()] ?? 0n;
  }

  async settlementAllowance(): Promise<bigint> {
    return 0n;
  }

  async offer(): Promise<{ offerId: string; offerTx: string; approveTx?: string }> {
    this.calls.push('offer');
    return { offerId: '2', offerTx: '0xoffer', approveTx: '0xapprove' };
  }

  async fill(): Promise<{ fillTx: string; gasUsed: number; approveTx?: string }> {
    this.calls.push('fill');
    return { fillTx: '0xfill', gasUsed: 564_330 };
  }

  async cancel(): Promise<string> {
    this.calls.push('cancel');
    return '0xcancel';
  }
}

async function serve(market = new FakeMarket()): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(marketRoutes, { config: CONFIG, reader: market, writer: market });
  await app.ready();
  return app;
}

describe('the market endpoints', () => {
  it('serves the order book newest first, with the venue and the counts', async () => {
    const app = await serve();
    const response = await app.inject({ method: 'GET', url: '/v1/market/offers' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.market.contract_id).toBe('0.0.10495570');
    expect(body.counts).toEqual({ total: 2, open: 1, filled: 1, cancelled: 0 });
    expect(body.offers.map((offer: { offer_id: string }) => offer.offer_id)).toEqual(['2', '1']);
    const filled = body.offers[1];
    expect(filled.status).toBe('filled');
    expect(filled.seller.role).toBe('operator');
    expect(filled.buyer.role).toBe('investor-1');
    expect(filled.units_whole).toBe('5');
    expect(filled.price.amount).toBe('5000000000');
    expect(filled.price_per_unit.amount).toBe('1000000000');
    expect(filled.note.symbol).toBe('CDBN02');
    expect(filled.series_id).toBe('ODI-OFFC-2026-01');
    await app.close();
  });

  it('narrows the book to what is open', async () => {
    const app = await serve();
    const response = await app.inject({ method: 'GET', url: '/v1/market/offers?status=open' });
    const body = response.json();
    expect(body.offers).toHaveLength(1);
    expect(body.offers[0].offer_id).toBe('2');
    expect(body.offers[0].readiness).toEqual({
      open: true,
      seller_holds: true,
      seller_approved: true,
    });
    await app.close();
  });

  it('answers whether a named account may hold the note at all', async () => {
    const app = await serve(new FakeMarket({ [INVESTOR_1]: 1 }));
    const eligible = await app.inject({
      method: 'GET',
      url: '/v1/market/offers/2?buyer=investor-1',
    });
    expect(eligible.json().buyer_eligibility.kyc_granted).toBe(true);
    const refused = await app.inject({
      method: 'GET',
      url: '/v1/market/offers/2?buyer=policyholder-3',
    });
    const body = refused.json();
    expect(body.buyer_eligibility.kyc_granted).toBe(false);
    expect(body.buyer_eligibility.reason).toBe(
      'the note holds no granted KYC record for this account',
    );
    await app.close();
  });

  it('says nothing about eligibility when no buyer was named', async () => {
    const app = await serve();
    const response = await app.inject({ method: 'GET', url: '/v1/market/offers/2' });
    expect(response.json().buyer_eligibility).toBeNull();
    await app.close();
  });

  it('answers 404 for an offer that was never made', async () => {
    const app = await serve();
    const response = await app.inject({ method: 'GET', url: '/v1/market/offers/9' });
    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe('offer_not_found');
    await app.close();
  });

  it('reports a holder position and the offers it is a party to', async () => {
    const app = await serve();
    const response = await app.inject({ method: 'GET', url: '/v1/market/positions/investor-1' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.holder.account_id).toBe('0.0.10366460');
    expect(body.positions).toHaveLength(1);
    expect(body.positions[0].units_whole).toBe('3');
    expect(body.positions[0].kyc.granted).toBe(true);
    expect(body.settlement_balance.amount).toBe('200000000000');
    // Both offers: the one it bought and the one it is selling.
    expect(body.offers.map((offer: { offer_id: string }) => offer.offer_id)).toEqual(['2', '1']);
    await app.close();
  });

  it('leaves out a series the account holds nothing of', async () => {
    const app = await serve();
    const response = await app.inject({ method: 'GET', url: '/v1/market/positions/investor-2' });
    expect(response.json().positions).toEqual([]);
    await app.close();
  });

  it('makes an offer and reports the transactions behind it', async () => {
    const market = new FakeMarket();
    const app = await serve(market);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/market/offers',
      payload: {
        seller: 'investor-1',
        series: 'office_admin_support',
        units: '2000000',
        price: '2100000000',
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().transactions).toEqual({ approve: '0xapprove', offer: '0xoffer' });
    expect(market.calls).toEqual(['offer']);
    await app.close();
  });

  it('refuses an offer of more than the seller holds, before signing anything', async () => {
    const market = new FakeMarket();
    const app = await serve(market);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/market/offers',
      payload: {
        seller: 'investor-1',
        series: 'ODI-OFFC-2026-01',
        units: '9000000',
        price: '1000000',
      },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('units_not_held');
    expect(market.calls).toEqual([]);
    await app.close();
  });

  it('refuses an amount that is not an integer in minor units', async () => {
    const app = await serve();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/market/offers',
      payload: { seller: 'investor-1', series: 'ODI-OFFC-2026-01', units: '2.5', price: '1' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('units_invalid');
    await app.close();
  });

  it('fills an open offer', async () => {
    const market = new FakeMarket();
    const app = await serve(market);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/market/offers/2/fill',
      payload: { buyer: 'investor-2' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().transactions.fill).toBe('0xfill');
    expect(market.calls).toEqual(['fill']);
    await app.close();
  });

  it('refuses a fill by an account the note holds no KYC for, and signs nothing', async () => {
    const market = new FakeMarket({ [OPERATOR]: 1, [INVESTOR_1]: 1 });
    const app = await serve(market);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/market/offers/2/fill',
      payload: { buyer: 'policyholder-3' },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('fill_refused');
    expect(response.json().detail).toContain('InvalidKycStatus');
    expect(market.calls).toEqual([]);
    await app.close();
  });

  it('refuses a fill the buyer cannot pay for', async () => {
    const market = new FakeMarket(undefined, { [INVESTOR_2]: 1n });
    const app = await serve(market);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/market/offers/2/fill',
      payload: { buyer: 'investor-2' },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('insufficient_settlement_balance');
    expect(market.calls).toEqual([]);
    await app.close();
  });

  it('refuses a fill of an offer that is already closed', async () => {
    const app = await serve();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/market/offers/1/fill',
      payload: { buyer: 'investor-2' },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('offer_not_open');
    await app.close();
  });

  it('refuses a fill by the seller', async () => {
    const app = await serve();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/market/offers/2/fill',
      payload: { buyer: 'investor-1' },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('seller_cannot_fill');
    await app.close();
  });

  it('refuses to act for an account it holds no key for', async () => {
    const app = await serve();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/market/offers/2/fill',
      payload: { buyer: '0x1111111111111111111111111111111111111111' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('buyer_unknown');
    await app.close();
  });

  it('lets only the seller withdraw an offer', async () => {
    const market = new FakeMarket();
    const app = await serve(market);
    const refused = await app.inject({
      method: 'POST',
      url: '/v1/market/offers/2/cancel',
      payload: { seller: 'investor-2' },
    });
    expect(refused.statusCode).toBe(403);
    expect(market.calls).toEqual([]);
    const accepted = await app.inject({
      method: 'POST',
      url: '/v1/market/offers/2/cancel',
      payload: { seller: 'investor-1' },
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().transactions.cancel).toBe('0xcancel');
    await app.close();
  });

  it('serves the book and refuses the writes where it cannot sign', async () => {
    const app = Fastify();
    await app.register(marketRoutes, {
      config: CONFIG,
      reader: new FakeMarket(),
      writer: null,
    });
    await app.ready();
    expect((await app.inject({ method: 'GET', url: '/v1/market/offers' })).statusCode).toBe(200);
    const write = await app.inject({
      method: 'POST',
      url: '/v1/market/offers/2/fill',
      payload: { buyer: 'investor-2' },
    });
    expect(write.statusCode).toBe(503);
    expect(write.json().code).toBe('market_writes_unavailable');
    await app.close();
  });

  it('serves an empty book on a deployment with no venue', async () => {
    const app = Fastify();
    await app.register(marketRoutes, {
      config: { ...CONFIG, venue: null },
      reader: new FakeMarket(),
      writer: null,
    });
    await app.ready();
    const response = await app.inject({ method: 'GET', url: '/v1/market/offers' });
    expect(response.statusCode).toBe(200);
    expect(response.json().market).toBeNull();
    expect(response.json().offers).toEqual([]);
    await app.close();
  });

  it('reports a refusal the note raised at the last moment as a refusal', async () => {
    class LateRefusal extends FakeMarket {
      override async fill(): Promise<never> {
        throw new FillRefused('InvalidKycStatus');
      }
    }
    const app = await serve(new LateRefusal());
    const response = await app.inject({
      method: 'POST',
      url: '/v1/market/offers/2/fill',
      payload: { buyer: 'investor-2' },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('fill_refused');
    await app.close();
  });
});

describe('the unit price', () => {
  it('is the lot price over the lot, in the same scale', () => {
    expect(pricePerUnit(5_000n * UNIT, 5n * UNIT, 6)).toBe(1_000n * UNIT);
    expect(pricePerUnit(2_100n * UNIT, 2n * UNIT, 6)).toBe(1_050n * UNIT);
  });

  it('is nought for a lot of nothing rather than a division by zero', () => {
    expect(pricePerUnit(1n, 0n, 6)).toBe(0n);
  });
});
