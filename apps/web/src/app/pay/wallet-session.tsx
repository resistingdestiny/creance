'use client';

import { useEffect, useRef } from 'react';

import { createWalletConnectProvider } from '../../lib/wallet-connect';
import type { WalletProvider } from '../../lib/wallet';
import { connectWallet } from '../purchase-actions';

/**
 * The WalletConnect library, loaded when somebody asks for a wallet and not
 * before.
 *
 * This component renders nothing. It exists because it is the only shape the
 * framework splits reliably: the chooser loads it with `next/dynamic`, and the
 * 3.5MB of library behind this import goes into its own chunk. A plain
 * `await import()` inside a module did not do it. Turbopack put the whole tree
 * into the page's chunk, and the landing page carries the payment step, so
 * every visitor who came to read a price downloaded a wallet. Measured, and
 * recorded in docs/DECISIONS.md.
 *
 * What it hands up is a `WalletProvider`, the same interface the demo provider
 * satisfies, so the wallet context and every screen above it are unchanged.
 *
 * `connectWallet` is the server action that turns the account id a session
 * approved into the account the cover binds to. It is imported here rather than
 * threaded down, because the account has to be read on the server and this is
 * already the module that knows about connecting.
 */
export function WalletSession({
  projectId,
  onReady,
}: {
  projectId: string;
  onReady: (provider: WalletProvider) => void;
}) {
  // Once. Under strict mode the effect runs twice on mount, and connecting
  // twice would open two modals for one tap.
  const told = useRef(false);

  useEffect(() => {
    if (told.current) return;
    told.current = true;
    onReady(createWalletConnectProvider({ projectId, resolve: connectWallet }));
  }, [onReady, projectId]);

  return null;
}
