'use client';

import {
  HederaAdapter,
  HederaChainDefinition,
  HederaProvider,
  hederaNamespace,
} from '@hashgraph/hedera-wallet-connect';
import { createAppKit } from '@reown/appkit';

import { HEDERA_TESTNET_CAIP, WALLET_METADATA, testnetAccountId } from './wallet';

/**
 * The WalletConnect session, and the only module that knows the library.
 *
 * Reown's AppKit opens the modal, lists the wallets and holds the pairing;
 * `@hashgraph/hedera-wallet-connect` is what teaches it the `hedera` namespace,
 * which is the one that speaks in account ids rather than EVM addresses. The
 * account id is the whole reason a Hedera wallet is asked for here: DESIGN.md
 * 3.6 makes it the signal a Selfie Check binds to and the account the policy
 * NFT is minted to.
 *
 * The EVM adapter the library's README pairs with this one is not built. It
 * exists to send Ethereum JSON-RPC over the same session and nothing in this
 * app does; the EVM address that goes with the account id is read from the
 * mirror node on the server, where it can be checked rather than trusted.
 *
 * Everything here is browser only and is imported by `createWalletConnectProvider`
 * at the moment somebody connects, never at module load. The library is large
 * and the landing page is server rendered and held (T40), so it may not sit in
 * the bundle a visitor downloads to read a price.
 *
 * https://github.com/hashgraph/hedera-wallet-connect
 * https://docs.reown.com/appkit/overview
 */

/** Everything the modal needs, built once for the life of the tab. */
interface Session {
  readonly kit: ReturnType<typeof createAppKit>;
  readonly provider: HederaProvider;
}

let building: Promise<Session> | null = null;

/**
 * The account the session holds on Hedera testnet, or null.
 *
 * Read off the session rather than off AppKit's account state, because this is
 * the value the wallet actually approved. `hedera:testnet:0.0.x` is HIP-820's
 * form; anything else is not an account this app will bind a cover to.
 */
function testnetAccount(provider: HederaProvider): string | null {
  const accounts = provider.session?.namespaces?.[hederaNamespace]?.accounts ?? [];
  for (const account of accounts) {
    const found = testnetAccountId(account);
    if (found !== null) return found;
  }
  return null;
}

async function open(projectId: string): Promise<Session> {
  const provider = await HederaProvider.init({ projectId, metadata: WALLET_METADATA });
  const kit = createAppKit({
    adapters: [
      new HederaAdapter({
        projectId,
        networks: [HederaChainDefinition.Native.Testnet],
        namespace: hederaNamespace,
      }),
    ],
    // The provider is a UniversalProvider subclass and AppKit's own type for
    // this option names the base class from its own copy of the package. The
    // README carries the same cast for the same reason.
    universalProvider: provider as unknown as Parameters<
      typeof createAppKit
    >[0]['universalProvider'],
    projectId,
    metadata: WALLET_METADATA,
    // Testnet and nothing else, per MISSION rule 1. A network this app cannot
    // settle on is not offered, so there is nothing for a wallet to switch to.
    networks: [HederaChainDefinition.Native.Testnet],
    features: { analytics: false },
  });
  return { kit, provider };
}

function session(projectId: string): Promise<Session> {
  building ??= open(projectId).catch((cause) => {
    // A failed build must not be cached, or every later attempt to connect
    // fails with the first attempt's error and no retry can ever succeed.
    building = null;
    throw cause;
  });
  return building;
}

/**
 * What a person reads when the connection did not happen. Both are things they
 * can act on, and neither pretends the demo wallet was used instead.
 */
const REFUSED = 'The wallet did not approve the connection.';
const WRONG_NETWORK = 'That wallet is not on Hedera testnet. Switch it to testnet and connect again.';

/**
 * A closing modal and an arriving session race each other, so a close is read
 * as a refusal only after the session has had a frame to land.
 */
const CLOSE_GRACE_MS = 250;

/**
 * Opens the modal and answers with the account id the wallet approved.
 *
 * Rejects when the person closes the modal without approving, and rejects with
 * a different sentence when a session comes back on a network this build will
 * not touch. Neither falls back to anything: the caller keeps the wallet it
 * already had, which on the payment step is the demo wallet.
 */
export async function openWalletSession(projectId: string): Promise<string> {
  const { kit, provider } = await session(projectId);

  const already = testnetAccount(provider);
  if (already !== null) return already;

  return await new Promise<string>((resolve, reject) => {
    let settled = false;
    let stopAccount: (() => void) | null = null;
    let stopState: (() => void) | null = null;

    const finish = (account: string | null, refusal: string) => {
      if (settled) return;
      settled = true;
      stopAccount?.();
      stopState?.();
      if (account === null) reject(new Error(refusal));
      else resolve(account);
    };

    stopAccount = kit.subscribeAccount(() => {
      const found = testnetAccount(provider);
      if (found !== null) finish(found, REFUSED);
    }, hederaNamespace);

    stopState = kit.subscribeState((state) => {
      if (state.open || settled) return;
      setTimeout(() => {
        // A session with no testnet account in it is a wallet that approved on
        // another network, which is a different thing from closing the modal.
        const refusal = provider.session === undefined ? REFUSED : WRONG_NETWORK;
        finish(testnetAccount(provider), refusal);
      }, CLOSE_GRACE_MS);
    });

    void kit.open();
  });
}

/**
 * Ends the session on both sides.
 *
 * The wallet is told, not just forgotten: a pairing this app has dropped but
 * the wallet still lists is a connection somebody thinks they have.
 */
export async function closeWalletSession(): Promise<void> {
  if (building === null) return;
  const { kit } = await building;
  await kit.disconnect(hederaNamespace);
}
