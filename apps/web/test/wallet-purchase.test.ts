import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What choosing a wallet does to the purchase.
 *
 * Two things, and they are the whole of phase one on the server. The wallet a
 * cover binds to moves from a constant to the session, so the quote, the
 * eligibility credential and, through the credential, the policy NFT all follow
 * it. And changing it drops the credential, because DESIGN.md 3.6 binds a check
 * to the wallet id and /v1/bind refuses a quote and a credential that name
 * different accounts.
 *
 * The cookie store, the mirror node and the API are mocked. Everything about
 * which account is named, and when a credential survives, is the shipped code.
 */

const store = new Map<string, string>();

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = store.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string) => {
      store.set(name, value);
    },
    delete: (name: string) => {
      store.delete(name);
    },
  }),
}));

vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`redirected to ${to}`);
  },
}));

vi.mock('../src/lib/wallet-account.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/wallet-account.js')>();
  return { ...actual, readConnectedAccount: vi.fn() };
});

vi.mock('../src/lib/worker-api.js', () => ({
  requestQuote: vi.fn(),
  requestWorldContext: vi.fn(),
  bindPolicy: vi.fn(),
  openCoverWithKey: vi.fn(),
  signInWithWorldCheck: vi.fn(),
  waitForSerial: vi.fn(),
  toMinorUnits: (whole: number) => String(whole * 1_000_000),
}));

const { clearAllPurchases, readPurchase, updatePurchase } = await import(
  '../src/lib/purchase-session.js'
);
const { connectWallet, openPayment, priceCover, useDemoWallet } = await import(
  '../src/app/purchase-actions.js'
);
const { readConnectedAccount, UnknownAccountError } = await import('../src/lib/wallet-account.js');
const { requestQuote } = await import('../src/lib/worker-api.js');
const { DEMO_ACCOUNT } = await import('../src/lib/wallet.js');

const CONNECTED = {
  accountId: '0.0.9123456',
  evmAddress: '0x00000000000000000000000000000000008b3f40',
  canHoldReceipt: true,
};

const QUOTE = {
  quote_id: 'qt_01',
  limit: { amount: '5000000000', decimals: 6, symbol: 'TUSD' },
  premium: { amount: '4250000', decimals: 6, symbol: 'TUSD' },
  pays_from: '0.0.9123456',
  expires_at: '2026-09-10T12:15:00.000Z',
  capacity: { used_pct: 12 },
  series_id: 'srs_01',
  attachment: 2,
  waiting_days: 60,
};

beforeEach(async () => {
  store.clear();
  clearAllPurchases();
  vi.mocked(readConnectedAccount).mockResolvedValue(CONNECTED);
  vi.mocked(requestQuote).mockResolvedValue(QUOTE as never);
  await updatePurchase({ group: 'occ-15-0000', limit: 5000 });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('until somebody connects a wallet', () => {
  it('every call still names the demo account, so the unchanged path is unchanged', async () => {
    await priceCover(5000);

    expect(vi.mocked(requestQuote).mock.calls[0]?.[0].wallet).toBe(DEMO_ACCOUNT.accountId);
    expect((await readPurchase())?.wallet).toBeNull();
  });
});

describe('connecting a wallet', () => {
  it('binds the purchase to the account the mirror node confirmed', async () => {
    const account = await connectWallet('0.0.9123456');

    expect(account).toEqual({
      accountId: CONNECTED.accountId,
      evmAddress: CONNECTED.evmAddress,
    });
    expect((await readPurchase())?.wallet).toEqual(account);
  });

  it('makes the quote name that account instead', async () => {
    await connectWallet('0.0.9123456');
    await priceCover(5000);

    expect(vi.mocked(requestQuote).mock.calls[0]?.[0].wallet).toBe('0.0.9123456');
  });

  it('drops the credential, because a check binds to the wallet it was run for', async () => {
    await updatePurchase({ credential: 'a-jwt', credentialExpiresAt: 'later', quoteId: 'qt_00' });

    await connectWallet('0.0.9123456');

    const session = await readPurchase();
    expect(session?.credential).toBeNull();
    expect(session?.credentialExpiresAt).toBeNull();
    expect(session?.quoteId).toBeNull();
  });

  it('keeps a credential when the same account is connected again', async () => {
    await connectWallet('0.0.9123456');
    await updatePurchase({ credential: 'a-jwt' });

    await connectWallet('0.0.9123456');

    expect((await readPurchase())?.credential).toBe('a-jwt');
  });

  it('writes nothing when the account is refused', async () => {
    vi.mocked(readConnectedAccount).mockRejectedValue(new UnknownAccountError('no such account'));

    await expect(connectWallet('0.0.9123456')).rejects.toBeInstanceOf(UnknownAccountError);
    expect((await readPurchase())?.wallet).toBeNull();
  });
});

describe('going back to the demo wallet', () => {
  it('puts the account down and drops the credential with it', async () => {
    await connectWallet('0.0.9123456');
    await updatePurchase({ credential: 'a-jwt' });

    await useDemoWallet();

    const session = await readPurchase();
    expect(session?.wallet).toBeNull();
    expect(session?.credential).toBeNull();
  });

  it('does nothing at all when the demo wallet is already the one in use', async () => {
    await updatePurchase({ credential: 'a-jwt' });

    await useDemoWallet();

    expect((await readPurchase())?.credential).toBe('a-jwt');
  });
});

describe('the rows on the pay sheet', () => {
  beforeEach(async () => {
    await updatePurchase({ credential: 'a-jwt' });
  });

  it('names one account on the demo path, captioned as the demo wallet', async () => {
    const confirmation = await openPayment();

    expect(confirmation?.heldIn).toBeNull();
    expect(confirmation?.paysFrom).toBe(DEMO_ACCOUNT.accountId);
    expect(confirmation?.walletLabel).toBe('Demo wallet. Testnet only.');
    expect(confirmation?.receiptWarning).toBeNull();
  });

  it('names two once a wallet is connected, because the payer is not the holder', async () => {
    await connectWallet('0.0.9123456');
    await updatePurchase({ credential: 'a-jwt' });

    const confirmation = await openPayment();

    expect(confirmation?.heldIn).toBe('0.0.9123456');
    expect(confirmation?.heldInLabel).toBe('Your own wallet. Hedera testnet.');
    // The premium still leaves the service account, so the row that names the
    // payer names that one and says who settled it.
    expect(confirmation?.paysFrom).toBe(DEMO_ACCOUNT.accountId);
    expect(confirmation?.walletLabel).toBe('Settled by the service. Testnet only.');
  });

  it('warns when the connected wallet will not take the receipt', async () => {
    vi.mocked(readConnectedAccount).mockResolvedValue({ ...CONNECTED, canHoldReceipt: false });
    await connectWallet('0.0.9123456');
    await updatePurchase({ credential: 'a-jwt' });

    expect((await openPayment())?.receiptWarning).toBe(
      "Your wallet doesn't accept new tokens, so the cover receipt can't be sent to it. The cover itself is unaffected.",
    );
  });
});
