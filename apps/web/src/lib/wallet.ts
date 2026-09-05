/**
 * The wallet the web app talks to, behind one small interface.
 *
 * DESIGN.md section 3.6 makes the wallet's account id the signal a Selfie Check
 * is bound to, so the abstraction has to expose an account id and not only a
 * connection. Screens read this interface and nothing else, so HashPack over
 * WalletConnect can replace the demo provider later without touching a screen.
 *
 * No private key ever reaches the browser in either mode. Signing belongs to
 * the API. The demo provider holds an account id and an address and nothing
 * that can move value.
 */

export type WalletMode = 'demo' | 'hashpack';

export type WalletStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface WalletAccount {
  /** Hedera account id, "0.0.10366453". The signal a Selfie Check binds to. */
  readonly accountId: string;
  /** The same account's EVM address, for anything that goes through the relay. */
  readonly evmAddress: string;
}

export interface WalletState {
  readonly mode: WalletMode;
  readonly status: WalletStatus;
  readonly account: WalletAccount | null;
  /** Shown in ink-2 wherever the wallet is visible. Null when there is nothing to say. */
  readonly label: string | null;
  readonly error: string | null;
}

export interface WalletProvider {
  readonly mode: WalletMode;
  /** Shown in ink-2 wherever the wallet is visible, so a judge can tell the mode. */
  readonly label: string | null;
  connect(): Promise<WalletAccount>;
  disconnect(): Promise<void>;
}

/**
 * The demo accounts from docs/HEDERA.md. Real testnet accounts with real TUSD
 * balances, which the API signs for. The browser never holds a key for any of
 * them.
 *
 * There is more than one because the worker flow and the investor screens are
 * two different people. policyholder-1 buys cover and is deliberately not on
 * the note's KYC list; the two investors are the noteholders the demo series
 * was issued to, and are the only accounts an investor screen can honestly
 * present a position for.
 */
export type DemoRole = 'policyholder-1' | 'investor-1' | 'investor-2';

export const DEMO_ACCOUNTS: Record<DemoRole, WalletAccount> = {
  'policyholder-1': {
    accountId: '0.0.10366453',
    evmAddress: '0xcad39730d48683b13e6077a70c6972add449b6f5',
  },
  'investor-1': {
    accountId: '0.0.10366460',
    evmAddress: '0xb6c2ff466e3c73f1a49a3f1b936f8e3837112931',
  },
  'investor-2': {
    accountId: '0.0.10366462',
    evmAddress: '0xcaa1184cd59b9296f757efc7303a10ecec6ce51e',
  },
};

/** The demo worker. The worker flow's account, and the default everywhere. */
export const DEMO_ACCOUNT: WalletAccount = DEMO_ACCOUNTS['policyholder-1'];

/** Never hidden. A judge who cannot tell whether a payment was real assumes it was not. */
export const DEMO_WALLET_LABEL = 'Demo wallet. Testnet only.';

export function createDemoWalletProvider(
  account: WalletAccount = DEMO_ACCOUNT,
): WalletProvider {
  return {
    mode: 'demo',
    label: DEMO_WALLET_LABEL,
    async connect() {
      return account;
    },
    async disconnect() {
      // Nothing to tear down: the demo provider holds no session.
    },
  };
}

/**
 * Which noteholder the investor screens present. A judge who wants to see the
 * other side of the note sets this to investor-2 and rebuilds. Anything that
 * is not a noteholder falls back to investor-1, because an investor screen
 * that presents an account with no position is a screen with nothing on it.
 */
export function readDemoInvestor(
  value: string | undefined = process.env.NEXT_PUBLIC_DEMO_INVESTOR,
): Extract<DemoRole, 'investor-1' | 'investor-2'> {
  return value === 'investor-2' ? 'investor-2' : 'investor-1';
}

/** The account the investor screens speak to. */
export function demoInvestorAccount(role = readDemoInvestor()): WalletAccount {
  return DEMO_ACCOUNTS[role];
}

/**
 * Reads the mode from the environment. The value is a public variable, so the
 * framework inlines it at build time and the production build has to have it
 * set before the build runs, not after. Anything other than "hashpack" is demo.
 */
export function readWalletMode(
  value: string | undefined = process.env.NEXT_PUBLIC_WALLET_MODE,
): WalletMode {
  return value === 'hashpack' ? 'hashpack' : 'demo';
}

/**
 * There is one provider today. HashPack over WalletConnect needs a Reown
 * project id in the environment before it can be built, so asking for it now
 * fails loudly rather than silently falling back to the demo account and
 * letting a demo look like a real connection.
 */
export function createWalletProvider(mode: WalletMode = readWalletMode()): WalletProvider {
  if (mode === 'hashpack') {
    throw new Error(
      'HashPack over WalletConnect is not wired yet: it needs a Reown project id. Set NEXT_PUBLIC_WALLET_MODE=demo.',
    );
  }
  return createDemoWalletProvider();
}

export const disconnectedState = (mode: WalletMode, label: string | null): WalletState => ({
  mode,
  status: 'disconnected',
  account: null,
  label,
  error: null,
});
