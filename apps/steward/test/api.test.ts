import { describe, expect, it } from 'vitest';
import type { X402Payer } from '@creance/client';

import { ApiError, StewardApi } from '../src/api.js';

/// The paying client, against a fetch that answers instead of the network.
/// Nothing here proves a payment: that is the testnet run and the transcript in
/// docs/demo/steward.txt. What it proves is the parts a real run would only
/// show by failing in front of a judge: that a refusal is reported with the
/// API's own code, that a 200 with no settlement header is not read as paid,
/// and that the eligibility credential goes in `Authorization`.

function settlementHeader(transactionId: string): string {
  return Buffer.from(JSON.stringify({ success: true, transaction: transactionId })).toString(
    'base64',
  );
}

interface Call {
  url: string;
  init: RequestInit | undefined;
}

function payerAnswering(
  responses: Response[],
  calls: Call[] = [],
): { payer: X402Payer; calls: Call[] } {
  const queue = [...responses];
  const fetchImpl = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const next = queue.shift();
    if (next === undefined) throw new Error('the stub ran out of responses');
    return next;
  }) as typeof globalThis.fetch;
  return {
    payer: { accountId: '0.0.10366451', network: 'hedera:testnet', fetch: fetchImpl },
    calls,
  };
}

const quoteBody = {
  quote_id: 'qte_01M1',
  series_id: 'ODI-COMP-2026-01',
  premium: { amount: '841667', asset: '0.0.10366463', decimals: 6, display: '0.841667' },
  limit: { amount: '1000000000', asset: '0.0.10366463', decimals: 6, display: '1000.00' },
  term_months: 12,
  expires_at: '2026-09-05T13:15:00Z',
  capacity: { free_before: '1', free_after: '1', used_pct: 1 },
};

describe('StewardApi', () => {
  it('returns the settlement beside the body of a paid call', async () => {
    const { payer, calls } = payerAnswering([
      new Response(JSON.stringify(quoteBody), {
        status: 201,
        headers: { 'PAYMENT-RESPONSE': settlementHeader('0.0.7162784@1788602392.809335465') },
      }),
    ]);
    const paid = await new StewardApi('http://api.test', payer).quote({
      group: 'computer_math',
      limit: '1000000000',
      wallet: '0.0.10366457',
    });
    expect(paid.body.quote_id).toBe('qte_01M1');
    expect(paid.settlement.transactionId).toBe('0.0.7162784@1788602392.809335465');
    expect(calls[0]?.url).toBe('http://api.test/v1/quote');
  });

  it('carries the eligibility credential as a bearer token on the bind', async () => {
    const { payer, calls } = payerAnswering([
      new Response(JSON.stringify({ policy_id: 'pol_01M1', status: 'bound' }), {
        status: 201,
        headers: { 'PAYMENT-RESPONSE': settlementHeader('0.0.7162784@1788602397.120605122') },
      }),
    ]);
    await new StewardApi('http://api.test', payer).bind({
      quoteId: 'qte_01M1',
      credential: 'header.body.signature',
    });
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers['authorization']).toBe('Bearer header.body.signature');
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ quote_id: 'qte_01M1' }));
  });

  it('refuses to read a paid call with no settlement header as paid', async () => {
    const { payer } = payerAnswering([
      new Response(JSON.stringify(quoteBody), { status: 201 }),
    ]);
    await expect(
      new StewardApi('http://api.test', payer).quote({
        group: 'computer_math',
        limit: '1000000000',
        wallet: '0.0.10366457',
      }),
    ).rejects.toThrow(/no PAYMENT-RESPONSE header/);
  });

  it('reports a refusal with the API problem document code', async () => {
    const { payer } = payerAnswering([
      new Response(
        JSON.stringify({
          code: 'already_covered',
          title: 'Already covered',
          detail: 'That person already holds cover in this series.',
        }),
        { status: 409, headers: { 'content-type': 'application/problem+json' } },
      ),
    ]);
    const error = await new StewardApi('http://api.test', payer)
      .bind({ quoteId: 'qte_01M1', credential: 'header.body.signature' })
      .catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('already_covered');
    expect((error as ApiError).status).toBe(409);
  });

  it('reads a policy that is gone as no policy rather than as an error', async () => {
    const { payer } = payerAnswering([]);
    const api = new StewardApi('http://api.test', payer);
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response('', { status: 404 })) as typeof globalThis.fetch;
    try {
      expect(await api.policy('pol_gone')).toBeNull();
    } finally {
      globalThis.fetch = original;
    }
  });
});
