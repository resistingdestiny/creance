import { afterEach, describe, expect, it, vi } from 'vitest';

import { UnknownAccountError, readConnectedAccount } from '../src/lib/wallet-account.js';

/**
 * The server side read behind a connected wallet.
 *
 * A WalletConnect session hands back an account id and nothing else, and the
 * EVM address that goes with it decides where a payout lands, so it is looked
 * up on the mirror node here rather than taken from the browser. The mirror
 * node's own answers for an account that exists, an account that does not and
 * an account with no address yet are what these cases are.
 *
 * The payloads are the shape testnet returns, cut to the fields this reads:
 * https://docs.hedera.com/hedera/sdks-and-apis/rest-api
 */

const calls: string[] = [];

function mirror(status: number, body: unknown) {
  return vi.fn(async (url: string) => {
    calls.push(url);
    return new Response(status === 404 ? '' : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  });
}

afterEach(() => {
  calls.length = 0;
  vi.unstubAllGlobals();
});

describe('an account a wallet just connected', () => {
  it('answers with the account id and the EVM address the mirror node holds', async () => {
    vi.stubGlobal(
      'fetch',
      mirror(200, {
        account: '0.0.9123456',
        evm_address: '0x00000000000000000000000000000000008b3f40',
        deleted: false,
        max_automatic_token_associations: -1,
      }),
    );

    const account = await readConnectedAccount('0.0.9123456');

    expect(account.accountId).toBe('0.0.9123456');
    expect(account.evmAddress).toBe('0x00000000000000000000000000000000008b3f40');
    expect(account.canHoldReceipt).toBe(true);
    // limit=1 keeps the account's transaction list off the answer, which is the
    // bulk of the payload and none of what is wanted.
    expect(calls[0]).toBe(
      'https://testnet.mirrornode.hedera.com/api/v1/accounts/0.0.9123456?limit=1',
    );
  });

  it('says the receipt cannot be sent when the account accepts no new tokens', async () => {
    vi.stubGlobal(
      'fetch',
      mirror(200, {
        account: '0.0.9123456',
        evm_address: '0x00000000000000000000000000000000008b3f40',
        deleted: false,
        max_automatic_token_associations: 0,
      }),
    );

    // Not a refusal. apps/api mints the policy NFT after the cover is bound and
    // records a mint that failed rather than failing the bind, so the cover is
    // real either way and this is a warning on the sheet.
    expect((await readConnectedAccount('0.0.9123456')).canHoldReceipt).toBe(false);
  });

  it('takes any positive allowance as enough for one collection', async () => {
    vi.stubGlobal(
      'fetch',
      mirror(200, {
        account: '0.0.9123456',
        evm_address: '0x00000000000000000000000000000000008b3f40',
        deleted: false,
        max_automatic_token_associations: 3,
      }),
    );

    expect((await readConnectedAccount('0.0.9123456')).canHoldReceipt).toBe(true);
  });
});

describe('what it refuses, so that nothing is half bound', () => {
  it('refuses anything that is not a Hedera account id, without asking the mirror node', async () => {
    vi.stubGlobal('fetch', mirror(200, {}));

    await expect(
      readConnectedAccount('0xcad39730d48683b13e6077a70c6972add449b6f5'),
    ).rejects.toBeInstanceOf(UnknownAccountError);
    expect(calls).toHaveLength(0);
  });

  it('refuses an account testnet has never heard of', async () => {
    vi.stubGlobal('fetch', mirror(404, null));

    await expect(readConnectedAccount('0.0.9123456')).rejects.toThrow(
      'There is no account 0.0.9123456 on Hedera testnet.',
    );
  });

  it('refuses a deleted account', async () => {
    vi.stubGlobal(
      'fetch',
      mirror(200, {
        account: '0.0.9123456',
        evm_address: '0x00000000000000000000000000000000008b3f40',
        deleted: true,
        max_automatic_token_associations: -1,
      }),
    );

    await expect(readConnectedAccount('0.0.9123456')).rejects.toBeInstanceOf(UnknownAccountError);
  });

  it('refuses an account with no EVM address, because a payout could not reach it', async () => {
    vi.stubGlobal(
      'fetch',
      mirror(200, {
        account: '0.0.9123456',
        evm_address: null,
        deleted: false,
        max_automatic_token_associations: -1,
      }),
    );

    await expect(readConnectedAccount('0.0.9123456')).rejects.toThrow(/no EVM address/);
  });
});
