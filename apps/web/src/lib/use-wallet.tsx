'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import {
  createWalletProvider,
  disconnectedState,
  readWalletMode,
  type WalletProvider,
  type WalletState,
} from './wallet';

interface WalletContextValue extends WalletState {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletContextProvider({
  children,
  provider,
}: {
  children: ReactNode;
  provider?: WalletProvider;
}) {
  const active = useMemo(() => provider ?? createWalletProvider(readWalletMode()), [provider]);
  const [state, setState] = useState<WalletState>(() =>
    disconnectedState(active.mode, active.label),
  );

  const connect = useCallback(async () => {
    setState((current) => ({ ...current, status: 'connecting', error: null }));
    try {
      const account = await active.connect();
      setState({
        mode: active.mode,
        status: 'connected',
        account,
        label: active.label,
        error: null,
      });
    } catch (cause) {
      setState({
        mode: active.mode,
        status: 'error',
        account: null,
        label: active.label,
        error: cause instanceof Error ? cause.message : 'The wallet did not connect.',
      });
    }
  }, [active]);

  const disconnect = useCallback(async () => {
    await active.disconnect();
    setState(disconnectedState(active.mode, active.label));
  }, [active]);

  const value = useMemo<WalletContextValue>(
    () => ({ ...state, connect, disconnect }),
    [state, connect, disconnect],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const value = useContext(WalletContext);
  if (!value) throw new Error('useWallet needs a WalletContextProvider above it.');
  return value;
}
