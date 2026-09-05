import { describe, expect, it } from 'vitest';

import {
  chooseRequirement,
  createX402Payer,
  hashscanTransactionUrl,
  readPaymentRequired,
  readSettlement,
} from '../src/x402/payer.js';

/// The payer, without a chain.
///
/// The signing path needs a Hedera node and a funded account, so it is proved
/// by the testnet integration run rather than here. What is provable offline is
/// everything around it: that a settlement receipt is read whichever of the two
/// field names the facilitator uses, that a response with no payment on it is
/// passed straight through, and that the wrapper leaves the caller's
/// Authorization header alone, which is what /v1/bind's eligibility credential
/// travels in.

const KEY = '0'.repeat(63) + '1';

function base64(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
}

function response(headers: Record<string, string>): { headers: Headers } {
  return { headers: new Headers(headers) };
}

describe('readSettlement', () => {
  it('reads the Blocky402 field name', () => {
    const settlement = readSettlement(
      response({
        'payment-response': base64({
          success: true,
          transaction: '0.0.7162784@1756800000.000000000',
          network: 'hedera:testnet',
          payer: '0.0.10366451',
        }),
      }),
    );
    expect(settlement?.transactionId).toBe('0.0.7162784@1756800000.000000000');
    expect(settlement?.success).toBe(true);
    expect(settlement?.payer).toBe('0.0.10366451');
  });

  it('reads the scheme specification field name', () => {
    const settlement = readSettlement(
      response({
        'payment-response': base64({
          success: true,
          transactionId: '0.0.7162784@1756800000.000000000',
          network: 'hedera:testnet',
        }),
      }),
    );
    expect(settlement?.transactionId).toBe('0.0.7162784@1756800000.000000000');
    expect(settlement?.payer).toBeUndefined();
  });

  it('carries the facilitator reason when the settlement failed', () => {
    const settlement = readSettlement(
      response({
        'payment-response': base64({
          success: false,
          transaction: '',
          network: 'hedera:testnet',
          errorReason: 'transaction_failed',
          errorMessage: 'TOKEN_NOT_ASSOCIATED_TO_ACCOUNT',
        }),
      }),
    );
    expect(settlement?.success).toBe(false);
    expect(settlement?.errorMessage).toBe('TOKEN_NOT_ASSOCIATED_TO_ACCOUNT');
  });

  it('is null on a response that carries no receipt', () => {
    expect(readSettlement(response({}))).toBeNull();
  });
});

describe('readPaymentRequired', () => {
  const required = {
    x402Version: 2,
    resource: { url: 'https://creance.co/v1/index/computer-and-mathematical' },
    accepts: [
      {
        scheme: 'exact',
        network: 'hedera:testnet',
        amount: '10000',
        asset: '0.0.10366463',
        payTo: '0.0.10366450',
        maxTimeoutSeconds: 60,
        extra: { feePayer: '0.0.7162784' },
      },
    ],
  };

  it('decodes the requirements out of the header', () => {
    const decoded = readPaymentRequired(response({ 'payment-required': base64(required) }));
    expect(decoded?.x402Version).toBe(2);
    expect(chooseRequirement(decoded!)?.amount).toBe('10000');
    expect(chooseRequirement(decoded!)?.extra?.feePayer).toBe('0.0.7162784');
  });

  it('has nothing to choose on another network', () => {
    const decoded = readPaymentRequired(response({ 'payment-required': base64(required) }));
    expect(chooseRequirement(decoded!, 'hedera:mainnet')).toBeUndefined();
  });

  it('is null when the response is not a 402', () => {
    expect(readPaymentRequired(response({}))).toBeNull();
  });
});

describe('hashscanTransactionUrl', () => {
  it('turns a Hedera transaction id into the form HashScan resolves', () => {
    expect(hashscanTransactionUrl('0.0.7162784@1788600927.143349211')).toBe(
      'https://hashscan.io/testnet/transaction/0.0.7162784-1788600927-143349211',
    );
  });
});

describe('createX402Payer', () => {
  it('passes a response that needs no payment straight through', async () => {
    const payer = createX402Payer({
      accountId: '0.0.10366451',
      privateKey: KEY,
      asset: '0.0.10366463',
      fetchImpl: async () => new Response('{"ok":true}', { status: 200 }),
    });
    const answer = await payer.fetch('http://127.0.0.1/v1/policy/policy_1');
    expect(answer.status).toBe(200);
    expect(readSettlement(answer)).toBeNull();
  });

  it('leaves the caller-owned Authorization header alone', async () => {
    const seen: (string | null)[] = [];
    const payer = createX402Payer({
      accountId: '0.0.10366451',
      privateKey: KEY,
      asset: '0.0.10366463',
      fetchImpl: async (input) => {
        seen.push(new Request(input).headers.get('authorization'));
        return new Response('{"ok":true}', { status: 200 });
      },
    });
    await payer.fetch('http://127.0.0.1/v1/bind', {
      method: 'POST',
      headers: { authorization: 'Bearer credential-token', 'content-type': 'application/json' },
      body: '{"quote_id":"quote_1"}',
    });
    expect(seen).toEqual(['Bearer credential-token']);
  });

  it('takes a key with or without the 0x prefix', () => {
    const options = { accountId: '0.0.10366451', asset: '0.0.10366463' };
    expect(createX402Payer({ ...options, privateKey: KEY }).accountId).toBe('0.0.10366451');
    expect(createX402Payer({ ...options, privateKey: `0x${KEY}` }).network).toBe('hedera:testnet');
  });
});
