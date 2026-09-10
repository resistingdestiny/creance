/**
 * The wallet the web app talks to, behind one small interface.
 *
 * DESIGN.md section 3.6 makes the wallet's account id the signal a Selfie Check
 * is bound to, so the abstraction has to expose an account id and not only a
 * connection. Screens read this interface and nothing else, so the demo
 * provider and a real WalletConnect session are interchangeable to them.
 *
 * There are two modes and the person picks one at the payment step. Demo is the
 * default and is what anybody who never opens the chooser gets. WalletConnect
 * reaches a Hedera wallet over the WalletConnect network and binds the cover to
 * the account it returns.
 *
 * No private key ever reaches the browser in either mode. The demo provider
 * holds an account id and an address and nothing that can move value, and a
 * connected wallet keeps its key in the wallet.
 */

export type WalletMode = 'demo' | 'walletconnect';

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
export type DemoRole = 'policyholder-1' | 'policyholder-3' | 'investor-1' | 'investor-2';

export const DEMO_ACCOUNTS: Record<DemoRole, WalletAccount> = {
  'policyholder-1': {
    accountId: '0.0.10366453',
    evmAddress: '0xcad39730d48683b13e6077a70c6972add449b6f5',
  },
  'policyholder-3': {
    accountId: '0.0.10366458',
    evmAddress: '0xb4e3e57d1f4dfedf146e59ff6f1ae478fbb81c9e',
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

/**
 * Which demo role holds an account, or null for an account this app has no key
 * for. The claim's attestation is signed as the cover's own holder, so the
 * signer has to name the role whose key derives it. docs/HEDERA.md.
 *
 * A cover bound to a connected wallet answers null here, which is correct and
 * has a consequence the chooser says out loud: that claim is submitted as
 * `unsigned_accepted` and a person looks at it.
 */
export function demoRoleOf(accountId: string): DemoRole | null {
  const found = Object.entries(DEMO_ACCOUNTS).find(
    ([, account]) => account.accountId === accountId,
  );
  return found === undefined ? null : (found[0] as DemoRole);
}

/** Never hidden. A judge who cannot tell whether a payment was real assumes it was not. */
export const DEMO_WALLET_LABEL = 'Demo wallet. Testnet only.';

/** The caption on a connected wallet wherever the account id shows. */
export const OWN_WALLET_LABEL = 'Your own wallet. Hedera testnet.';

/**
 * Said on the pay sheet before the press, because it is true after it.
 *
 * The cover binds either way: apps/api mints the policy NFT after the cover is
 * already bound and records a mint that failed rather than failing the bind. So
 * this warns and does not block.
 */
export const NO_RECEIPT_WARNING =
  "Your wallet doesn't accept new tokens, so the cover receipt can't be sent to it. The cover itself is unaffected.";

/**
 * The caption on the paying account once a cover is bound to somebody else's
 * wallet. The premium is still settled by src/lib/payer.ts out of the service
 * account, so the row that names it may not be captioned as the person's own.
 */
export const SERVICE_PAYS_LABEL = 'Settled by the service. Testnet only.';

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
 * What a wallet shows on its approval screen.
 *
 * These four values are registered on the Reown project and a wallet compares
 * them against the origin it was opened from. They are mirrored here and not
 * invented: a name or a url that disagrees with the registration makes some
 * wallets warn about a domain mismatch, which is the worst thing to show
 * somebody at the moment they are asked to approve a session.
 *
 * https://docs.reown.com/appkit/next/core/installation
 */
export const WALLET_METADATA: {
  name: string;
  description: string;
  url: string;
  icons: string[];
} = {
  name: 'Creance',
  description: 'Cover for the day your job is automated.',
  url: 'https://creance.co',
  icons: ['https://creance.co/icon-512.png'],
};

/**
 * The CAIP-2 chain this app will hold a session on, and the only one.
 *
 * HIP-820 gives Hedera the `hedera` namespace and the network as the reference,
 * so a testnet session's accounts read `hedera:testnet:0.0.x`. MISSION rule 1
 * is testnet only, so a session offered on any other network is refused rather
 * than used.
 *
 * https://hips.hedera.com/hip/hip-820
 */
export const HEDERA_TESTNET_CAIP = 'hedera:testnet';

/**
 * The Hedera account id inside a CAIP-10 account string, or null.
 *
 * Null for anything that is not a Hedera testnet account, which is what makes
 * this the one place MISSION rule 1 is enforced on a session: a wallet that
 * approves on another network hands back an account this refuses to read, and
 * the connection fails loudly instead of binding a cover somewhere it should
 * not be.
 */
export function testnetAccountId(caipAccount: string): string | null {
  const parts = caipAccount.split(':');
  if (parts.length !== 3) return null;
  const [namespace, reference, accountId = ''] = parts;
  if (`${namespace}:${reference}` !== HEDERA_TESTNET_CAIP) return null;
  return /^\d+\.\d+\.\d+$/.test(accountId) ? accountId : null;
}

/**
 * The Reown project id, from the web app's own environment file.
 *
 * It is public by design and ships in client side JavaScript, which is why it
 * is a `NEXT_PUBLIC_` name. It has to be in `apps/web/.env` and not the
 * repository root one: `next build` runs with `apps/web` as its directory and
 * the framework reads an environment file from there only, so a public variable
 * in the root file never reaches a build.
 */
export function readWalletConnectProjectId(
  value: string | null | undefined = process.env.NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID,
): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

/**
 * Turns the account id a session returns into the account the cover binds to.
 *
 * A session gives an account id and nothing else, and DESIGN.md 3.6 needs the
 * EVM address too. Resolving it is a server side read of the mirror node, so
 * it arrives here as a function rather than being done in the browser: the
 * server is going to have to look the account up anyway, because an address a
 * browser supplies is an address a browser could have made up.
 */
export type ResolveWalletAccount = (accountId: string) => Promise<WalletAccount>;

export interface WalletConnectOptions {
  readonly projectId?: string | null;
  readonly resolve: ResolveWalletAccount;
}

/**
 * A wallet reached over the WalletConnect network.
 *
 * Building one without a project id throws rather than falling back to the demo
 * account, because a demo that silently looks like a real connection is worse
 * than one that says what it is. That was true when the mode threw outright and
 * it is still true now that the mode is a choice somebody makes on screen.
 *
 * The session itself lives in src/lib/wallet-connect.ts and is imported only
 * when somebody connects. The library it uses is large and the landing page is
 * server rendered and held (T40), so it may not be in the first bundle a
 * visitor downloads to read a price.
 */
export function createWalletConnectProvider(options: WalletConnectOptions): WalletProvider {
  // Through the same reader whether it came from the environment or a caller,
  // so a blank string is as absent as an unset variable is. A project id made
  // of spaces would otherwise build a provider that fails at the modal.
  const projectId = readWalletConnectProjectId(options.projectId);
  if (projectId === null) {
    throw new Error(
      'Connecting your own wallet needs a Reown project id. Set NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID in apps/web/.env.',
    );
  }
  return {
    mode: 'walletconnect',
    label: OWN_WALLET_LABEL,
    async connect() {
      const { openWalletSession } = await import('./wallet-connect');
      return await options.resolve(await openWalletSession(projectId));
    },
    async disconnect() {
      const { closeWalletSession } = await import('./wallet-connect');
      await closeWalletSession();
    },
  };
}

export const disconnectedState = (mode: WalletMode, label: string | null): WalletState => ({
  mode,
  status: 'disconnected',
  account: null,
  label,
  error: null,
});
