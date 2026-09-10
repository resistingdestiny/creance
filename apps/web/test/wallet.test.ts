import { describe, expect, it } from 'vitest';

import { shortenAddress } from '../src/lib/format.js';
import {
  DEMO_ACCOUNT,
  DEMO_WALLET_LABEL,
  HEDERA_TESTNET_CAIP,
  OWN_WALLET_LABEL,
  WALLET_METADATA,
  createDemoWalletProvider,
  createWalletConnectProvider,
  demoRoleOf,
  readWalletConnectProjectId,
  testnetAccountId,
} from '../src/lib/wallet.js';

describe('the WalletConnect provider', () => {
  const resolve = async (accountId: string) => ({ accountId, evmAddress: '0x00' });

  it('refuses to be built without a project id rather than quietly using the demo account', () => {
    // The mode used to throw outright for the same reason, and the reason has
    // not changed now that the mode is a choice somebody makes on screen: a
    // demo that silently looks like a real connection is worse than one that
    // says what it is.
    expect(() => createWalletConnectProvider({ projectId: null, resolve })).toThrow(
      /Reown project id/,
    );
    expect(() => createWalletConnectProvider({ projectId: '  ', resolve })).toThrow(
      /Reown project id/,
    );
  });

  it('is labelled as a real connection, not as the demo one', () => {
    const provider = createWalletConnectProvider({ projectId: 'abc', resolve });
    expect(provider.mode).toBe('walletconnect');
    expect(provider.label).toBe(OWN_WALLET_LABEL);
    expect(provider.label).not.toBe(DEMO_WALLET_LABEL);
  });
});

describe('the project id', () => {
  it('is null when it is unset or blank, so nothing offers a connection it cannot make', () => {
    expect(readWalletConnectProjectId(undefined)).toBeNull();
    expect(readWalletConnectProjectId('')).toBeNull();
    expect(readWalletConnectProjectId('   ')).toBeNull();
  });

  it('is trimmed, because an environment file keeps whatever whitespace it was given', () => {
    expect(readWalletConnectProjectId(' 37d0eec9 ')).toBe('37d0eec9');
  });
});

describe('the account a session approved', () => {
  it('reads a Hedera testnet account out of its CAIP form', () => {
    expect(testnetAccountId(`${HEDERA_TESTNET_CAIP}:0.0.9123456`)).toBe('0.0.9123456');
    expect(HEDERA_TESTNET_CAIP).toBe('hedera:testnet');
  });

  it('refuses any other network, which is where MISSION rule 1 is enforced on a session', () => {
    expect(testnetAccountId('hedera:previewnet:0.0.9123456')).toBeNull();
    expect(testnetAccountId('hedera:devnet:0.0.9123456')).toBeNull();
    expect(testnetAccountId('eip155:296:0xcad39730d48683b13e6077a70c6972add449b6f5')).toBeNull();
  });

  it('refuses anything that is not an account id in the third position', () => {
    expect(testnetAccountId('hedera:testnet')).toBeNull();
    expect(testnetAccountId('hedera:testnet:')).toBeNull();
    expect(testnetAccountId('hedera:testnet:0xcad39730d48683b13e6077a70c6972add449b6f5')).toBeNull();
    expect(testnetAccountId('hedera:testnet:0.0.9123456:extra')).toBeNull();
  });
});

describe('what a wallet shows on its approval screen', () => {
  it('is what is registered on the Reown project, or some wallets warn about the domain', () => {
    expect(WALLET_METADATA.name).toBe('Creance');
    expect(WALLET_METADATA.description).toBe('Cover for the day your job is automated.');
    expect(WALLET_METADATA.url).toBe('https://creance.co');
    expect(WALLET_METADATA.icons).toEqual(['https://creance.co/icon-512.png']);
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

describe('who holds a cover', () => {
  it('answers null for a connected wallet, which is why its claim goes to a person', () => {
    // demoRoleOf names the role whose key signs a claim attestation. A cover
    // bound to somebody else's wallet has no such role, the claim is submitted
    // as unsigned_accepted, and R10 refers it. The chooser says so.
    expect(demoRoleOf('0.0.9123456')).toBeNull();
    expect(demoRoleOf(DEMO_ACCOUNT.accountId)).toBe('policyholder-1');
  });
});
