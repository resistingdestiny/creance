'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import {
  createDemoWalletProvider,
  disconnectedState,
  type WalletAccount,
  type WalletProvider,
  type WalletState,
} from './wallet';

/**
 * The wallet, published to the tree.
 *
 * The mode used to be a build time value and is now a choice somebody makes on
 * the payment step, so the context holds whichever provider is live. Demo is
 * what it starts on and what anybody who never opens the chooser keeps, which
 * is the whole of "the demo path is unchanged".
 *
 * It is handed a provider rather than building one. The WalletConnect provider
 * costs 3.5MB of library to build, so it is loaded by the chooser through
 * `next/dynamic` at the moment somebody asks for it and arrives here already
 * made. Nothing in this file imports anything heavy, which is why it can be
 * mounted around the whole app in src/app/providers.tsx.
 */

interface WalletContextValue extends WalletState {
  /**
   * A test seam, and the only way a wallet that is not a real WalletConnect
   * session gets in. Null in the app, where the chooser loads one.
   */
  readonly walletConnect: WalletProvider | null;
  /** The account on success, null when the connection did not happen. */
  connect(provider: WalletProvider): Promise<WalletAccount | null>;
  /** Says a connection is being asked for, while the provider is still loading. */
  opening(): void;
  disconnect(): Promise<void>;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletContextProvider({
  children,
  walletConnect,
}: {
  children: ReactNode;
  walletConnect?: WalletProvider;
}) {
  const demo = useMemo(() => createDemoWalletProvider(), []);

  // The live provider, kept in a ref rather than in state: disconnect has to
  // reach the one that is actually holding a session, and a re-render between
  // the two would otherwise leave a session nothing can close.
  const active = useRef<WalletProvider>(demo);
  const [state, setState] = useState<WalletState>(() => disconnectedState(demo.mode, demo.label));

  const opening = useCallback(() => {
    setState({
      mode: 'walletconnect',
      status: 'connecting',
      account: null,
      label: null,
      error: null,
    });
  }, []);

  const connect = useCallback(async (provider: WalletProvider): Promise<WalletAccount | null> => {
    setState({
      mode: provider.mode,
      status: 'connecting',
      account: null,
      label: provider.label,
      error: null,
    });
    try {
      const account = await provider.connect();
      active.current = provider;
      setState({
        mode: provider.mode,
        status: 'connected',
        account,
        label: provider.label,
        error: null,
      });
      return account;
    } catch (cause) {
      // The provider that failed is not made current, so the wallet the person
      // already had is the wallet they still have. On the payment step that is
      // the demo wallet, untouched. It is torn down all the same: the session
      // may have been approved and only the account behind it refused, and a
      // pairing this app has forgotten but the wallet still lists is a
      // connection somebody thinks they have.
      await provider.disconnect().catch(() => undefined);
      setState({
        mode: provider.mode,
        status: 'error',
        account: null,
        label: provider.label,
        error: cause instanceof Error ? cause.message : 'The wallet did not connect.',
      });
      return null;
    }
  }, []);

  const disconnect = useCallback(async () => {
    const holding = active.current;
    active.current = demo;
    setState(disconnectedState(demo.mode, demo.label));
    await holding.disconnect();
  }, [demo]);

  const value = useMemo<WalletContextValue>(
    () => ({ ...state, walletConnect: walletConnect ?? null, connect, opening, disconnect }),
    [state, walletConnect, connect, opening, disconnect],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const value = useContext(WalletContext);
  if (!value) throw new Error('useWallet needs a WalletContextProvider above it.');
  return value;
}
