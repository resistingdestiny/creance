import type { ReactNode } from 'react';

import { WalletContextProvider } from '../src/lib/use-wallet.js';
import type { WalletAccount, WalletProvider } from '../src/lib/wallet.js';

/**
 * The wallet context, for a screen that carries the chooser.
 *
 * The app mounts it in src/app/providers.tsx around everything, and a test that
 * renders one screen has no providers above it. Wrapping here rather than
 * loosening `useWallet` keeps the invariant the app depends on: a screen that
 * reads the wallet without a provider above it is a bug, not a default.
 *
 * With nothing passed, the context offers the demo wallet only, which is what a
 * deployment with no Reown project id offers and what every screen test that
 * does not care about the chooser should see.
 */
export function withWallet(
  children: ReactNode,
  walletConnect?: WalletProvider,
): ReactNode {
  return (
    <WalletContextProvider walletConnect={walletConnect}>{children}</WalletContextProvider>
  );
}

/** An account that is nobody's demo account, so a test can tell them apart. */
export const CONNECTED_ACCOUNT: WalletAccount = {
  accountId: '0.0.9123456',
  evmAddress: '0x00000000000000000000000000000000008b3f40',
};

/**
 * A wallet that connects. It stands in for a WalletConnect session, which needs
 * a phone, a wallet application and a person to approve it.
 */
export function fakeWallet(
  behaviour: { connect?: () => Promise<WalletAccount> } = {},
): WalletProvider & { disconnected: () => number } {
  let disconnects = 0;
  return {
    mode: 'walletconnect',
    label: 'Your own wallet. Hedera testnet.',
    connect: behaviour.connect ?? (async () => CONNECTED_ACCOUNT),
    async disconnect() {
      disconnects += 1;
    },
    disconnected: () => disconnects,
  };
}
