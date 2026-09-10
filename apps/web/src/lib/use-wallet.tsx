'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import {
  createDemoWalletProvider,
  createWalletConnectProvider,
  disconnectedState,
  readWalletConnectProjectId,
  type ResolveWalletAccount,
  type WalletMode,
  type WalletProvider,
  type WalletState,
} from './wallet';

/**
 * The wallet, published to the tree.
 *
 * The mode used to be a build time value and is now a choice somebody makes on
 * the payment step, so the context holds both providers and switches between
 * them. Demo is what it starts on and what anybody who never opens the chooser
 * keeps, which is the whole of "the demo path is unchanged".
 *
 * `offersWalletConnect` is false on a deployment with no Reown project id. The
 * chooser reads it and does not present an option it cannot honour, which is
 * the same rule as before by another route: a demo may never look like a real
 * connection, and an option that silently fell back to the demo account would
 * be exactly that.
 */

interface WalletContextValue extends WalletState {
  /** Whether a real wallet can be reached at all on this deployment. */
  readonly offersWalletConnect: boolean;
  connect(mode: WalletMode): Promise<void>;
  disconnect(): Promise<void>;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletContextProvider({
  children,
  provider,
  resolve,
}: {
  children: ReactNode;
  /** A test seam, and the only way a fake wallet gets in. */
  provider?: WalletProvider;
  /**
   * Turns a connected account id into the account the cover binds to. It is a
   * server action in the app, because the EVM address that goes with an
   * account id has to be read rather than trusted. src/lib/wallet-account.ts.
   */
  resolve?: ResolveWalletAccount;
}) {
  const demo = useMemo(() => provider ?? createDemoWalletProvider(), [provider]);
  const projectId = useMemo(() => readWalletConnectProjectId(), []);
  const offersWalletConnect = provider === undefined && projectId !== null && resolve !== undefined;

  // The live provider, kept in a ref rather than in state: disconnect has to
  // reach the one that is actually holding a session, and a re-render between
  // the two would otherwise leave a session nothing can close.
  const active = useRef<WalletProvider>(demo);
  const [state, setState] = useState<WalletState>(() => disconnectedState(demo.mode, demo.label));

  const connect = useCallback(
    async (mode: WalletMode) => {
      let next: WalletProvider;
      try {
        next =
          mode === 'walletconnect' && offersWalletConnect && resolve !== undefined
            ? createWalletConnectProvider({ projectId, resolve })
            : demo;
      } catch (cause) {
        setState({
          mode,
          status: 'error',
          account: null,
          label: null,
          error: cause instanceof Error ? cause.message : 'That wallet is not available here.',
        });
        return;
      }
      setState({
        mode: next.mode,
        status: 'connecting',
        account: null,
        label: next.label,
        error: null,
      });
      try {
        const account = await next.connect();
        active.current = next;
        setState({
          mode: next.mode,
          status: 'connected',
          account,
          label: next.label,
          error: null,
        });
      } catch (cause) {
        // The provider that failed is not made current, so the wallet the
        // person already had is the wallet they still have. On the payment
        // step that is the demo wallet, untouched.
        setState({
          mode: next.mode,
          status: 'error',
          account: null,
          label: next.label,
          error: cause instanceof Error ? cause.message : 'The wallet did not connect.',
        });
      }
    },
    [demo, offersWalletConnect, projectId, resolve],
  );

  const disconnect = useCallback(async () => {
    const holding = active.current;
    active.current = demo;
    setState(disconnectedState(demo.mode, demo.label));
    await holding.disconnect();
  }, [demo]);

  const value = useMemo<WalletContextValue>(
    () => ({ ...state, offersWalletConnect, connect, disconnect }),
    [state, offersWalletConnect, connect, disconnect],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const value = useContext(WalletContext);
  if (!value) throw new Error('useWallet needs a WalletContextProvider above it.');
  return value;
}
