// The concrete module, not the workspace's barrel, for the reason
// src/lib/payer.ts gives: the barrel re-exports with explicit `.js` specifiers,
// which the bundler here cannot follow to a `.ts` file.
import { MirrorClient } from '@creance/client/src/hedera/mirror';

import { serverVar } from './server-env';
import type { WalletAccount } from './wallet';

/**
 * What the server knows about an account a wallet just connected.
 *
 * A WalletConnect session hands back an account id and nothing else, and
 * DESIGN.md 3.6 needs the EVM address as well: the credential carries both, the
 * CoverPool pays the address and the policy NFT goes to the account id. So the
 * account is looked up rather than composed, on the server, on the mirror node,
 * which is the same source everything else in this build verifies against.
 *
 * It is looked up on the server and not in the browser on purpose. An address a
 * browser supplies is an address a browser could have made up, and this one
 * decides where a payout lands.
 *
 * REST reference: https://docs.hedera.com/hedera/sdks-and-apis/rest-api
 */

export interface ConnectedAccount extends WalletAccount {
  /**
   * Whether the account will accept the policy NFT without associating the
   * collection by hand. False is not a refusal: apps/api mints the receipt
   * after the cover is already bound and a mint that fails is recorded as
   * `nft_mint_failed` rather than failing the bind. It is said on screen so
   * nobody is surprised by a cover with no receipt in their wallet.
   */
  readonly canHoldReceipt: boolean;
}

/** The mirror node's account payload, the four fields this build reads. */
interface MirrorAccount {
  account: string | null;
  evm_address: string | null;
  deleted: boolean | null;
  max_automatic_token_associations: number | null;
}

/** Testnet only, per MISSION rule 1. The API's own default, from its config. */
const TESTNET_MIRROR = 'https://testnet.mirrornode.hedera.com/api/v1';

function mirror(): MirrorClient {
  return new MirrorClient({ baseUrl: serverVar('HEDERA_MIRROR_URL') ?? TESTNET_MIRROR });
}

export class UnknownAccountError extends Error {}

/**
 * The account behind an id, or a throw a screen can print.
 *
 * `limit=1` keeps the mirror node from attaching the account's transaction list
 * to the answer, which is the bulk of the payload and none of what is wanted.
 *
 * An account with no EVM address has never had one derived, which on testnet
 * means an alias account that has not been used. There is nothing honest to put
 * in the credential for it, so it is refused here rather than half bound.
 */
export async function readConnectedAccount(accountId: string): Promise<ConnectedAccount> {
  if (!/^\d+\.\d+\.\d+$/.test(accountId)) {
    throw new UnknownAccountError('That is not a Hedera account id.');
  }
  const found = await mirror().get<MirrorAccount>(`/accounts/${accountId}?limit=1`);
  if (found === null || found.deleted === true) {
    throw new UnknownAccountError(`There is no account ${accountId} on Hedera testnet.`);
  }
  const evmAddress = found.evm_address;
  if (evmAddress === null || evmAddress === '') {
    throw new UnknownAccountError(
      `Account ${accountId} has no EVM address yet, so a payout could not reach it.`,
    );
  }
  return {
    accountId: found.account ?? accountId,
    evmAddress,
    // Unlimited is -1 and any positive allowance is enough for one collection.
    // Zero means the holder has to associate the collection itself, which this
    // app cannot do for them and does not pretend to.
    canHoldReceipt: (found.max_automatic_token_associations ?? 0) !== 0,
  };
}
