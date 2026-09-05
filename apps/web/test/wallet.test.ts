import { describe, expect, it } from 'vitest';

import { shortenAddress } from '../src/lib/format.js';
import {
  DEMO_ACCOUNT,
  DEMO_WALLET_LABEL,
  createDemoWalletProvider,
  createWalletProvider,
  readWalletMode,
} from '../src/lib/wallet.js';

describe('wallet mode', () => {
  it('defaults to demo when nothing is set', () => {
    expect(readWalletMode(undefined)).toBe('demo');
    expect(readWalletMode('')).toBe('demo');
    expect(readWalletMode('anything else')).toBe('demo');
  });

  it('reads hashpack when it is asked for', () => {
    expect(readWalletMode('hashpack')).toBe('hashpack');
  });

  it('refuses to build a hashpack provider rather than quietly using the demo account', () => {
    expect(() => createWalletProvider('hashpack')).toThrow(/Reown project id/);
  });
});

describe('demo wallet provider', () => {
  it('exposes the account id, which is what a Selfie Check signal binds to', async () => {
    const provider = createDemoWalletProvider();
    const account = await provider.connect();
    expect(account.accountId).toBe('0.0.10366453');
    expect(account.evmAddress).toBe('0xcad39730d48683b13e6077a70c6972add449b6f5');
  });

  it('is labelled so a judge can tell it apart from a real connection', () => {
    expect(createDemoWalletProvider().label).toBe(DEMO_WALLET_LABEL);
    expect(DEMO_WALLET_LABEL).toBe('Demo wallet. Testnet only.');
  });

  it('shortens to first four and last four for the Pays from row', () => {
    expect(shortenAddress(DEMO_ACCOUNT.evmAddress)).toBe('0xcad3…b6f5');
  });

  it('disconnects without throwing', async () => {
    await expect(createDemoWalletProvider().disconnect()).resolves.toBeUndefined();
  });
});
