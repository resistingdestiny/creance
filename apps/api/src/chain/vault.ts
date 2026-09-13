import { Contract, JsonRpcProvider, Wallet, type InterfaceAbi } from 'ethers';

import { AppError } from '../errors.js';
import { SETTLEMENT_TOKEN_ABI, VAULT_SUBSCRIPTION_ABI } from './abi.js';

/// The chain half of POST /v1/subscribe, behind one interface.
///
/// The route never touches ethers directly, so `pnpm test` stays chain free and
/// the testnet stage swaps in the relay, which is the rule for every test
/// outside the testnet stage.
///
/// This object signs as the api account and as nothing else. `subscribe` pulls
/// the settlement token from `msg.sender`, so the account that holds
/// SUBSCRIPTION_ROLE is also the account that pays, and on this deployment that
/// is the api account (DESIGN.md 3.8, and contracts/coupons/vault.ts does the
/// same two calls in the same order). A deployment with no key for it reads
/// through this object exactly as before and refuses the write outright rather
/// than pretending to have one: `canSign` is what the route answers 503 on.
///
/// The vault address is the one apps/api/src/config.ts already resolves for
/// `principalRemaining`, so there is one place that says where the vault is.

/** What `seriesOf` says about a series, narrowed to what a subscription reads. */
export interface VaultSeriesTerms {
  /**
   * Seconds since the epoch. Zero on a series this vault never opened, which
   * reads back as a zeroed struct rather than as a revert, and which is not the
   * same thing as a series with no principal in it yet.
   */
  maturityAt: number;
  principalFunded: bigint;
}

export interface SubscriptionWrite {
  /** Null where the allowance already covered the amount and none was sent. */
  approveTx: string | null;
  subscribeTx: string;
  gasUsed: string;
}

export interface SubscriptionGateway {
  /** False on a deployment holding no key for the account that pays. */
  readonly canSign: boolean;
  /** The account that pays and signs, or null where there is none. */
  readonly payer: string | null;
  seriesTerms(seriesKey: string): Promise<VaultSeriesTerms>;
  subscriptionOf(seriesKey: string, holder: string): Promise<bigint>;
  settlementBalanceOf(address: string): Promise<bigint>;
  /**
   * Approve the vault for the amount where the allowance is short, then
   * subscribe. Both calls are made by the payer, in that order, because the
   * vault pulls with `transferFrom` and an unapproved pull reverts.
   */
  subscribe(seriesKey: string, holder: string, amount: bigint): Promise<SubscriptionWrite>;
}

/// Explicit gas limits, for the reason apps/api/src/chain/cover-pool.ts gives:
/// the relay's `eth_estimateGas` cannot price a call whose cost depends on
/// state it cannot see.
///
/// They are close to the measured cost rather than generous, because unused gas
/// being refunded is not the whole story on Hedera. The relay refuses a
/// transaction whose sender cannot cover `gasLimit` times the quoted gas price,
/// so a limit set four times higher than needed asks the api account to hold
/// four times the HBAR it will ever spend, and the account that pays for every
/// subscription on this deployment is the same one that pays for the binds and
/// the payouts.
///
/// An HTS approve through the ERC-20 facade is priced by converting a USD cost
/// to gas, so it is orders of magnitude dearer than a storage write: it
/// measured 729,787 against 162,781 for the note's own (docs/HEDERA.md,
/// "Measured gas"), and 1,200,000 is what apps/api/src/market/chain.ts already
/// funds for exactly this call. `subscribe` measured 141,378 with its HTS
/// `transferFrom` inside it, which is why the limit here is 400,000 and not the
/// 1,500,000 contracts/coupons/config.ts carries: that figure is the suggested
/// limit out of the measurement table, and a script that runs once with twelve
/// HBAR in hand can afford a reserve this API should not be holding per call.
export const APPROVE_GAS_LIMIT = 1_200_000n;
export const SUBSCRIBE_GAS_LIMIT = 400_000n;

export class EthersVaultGateway implements SubscriptionGateway {
  private readonly provider: JsonRpcProvider;
  private readonly signer: Wallet | null;

  constructor(
    private readonly vaultAddress: string,
    private readonly settlementTokenAddress: string,
    rpcUrl: string,
    chainId = 296,
    /// The api account's key, or undefined on a deployment that has none.
    apiKey?: string,
  ) {
    this.provider = new JsonRpcProvider(rpcUrl, chainId, { staticNetwork: true });
    this.signer =
      apiKey === undefined || apiKey.trim() === '' ? null : new Wallet(apiKey.trim(), this.provider);
  }

  get canSign(): boolean {
    return this.signer !== null;
  }

  get payer(): string | null {
    return this.signer?.address ?? null;
  }

  private vault(withSigner = false): Contract {
    return new Contract(
      this.vaultAddress,
      VAULT_SUBSCRIPTION_ABI as unknown as InterfaceAbi,
      withSigner ? (this.signer as Wallet) : this.provider,
    );
  }

  private token(withSigner = false): Contract {
    return new Contract(
      this.settlementTokenAddress,
      SETTLEMENT_TOKEN_ABI as unknown as InterfaceAbi,
      withSigner ? (this.signer as Wallet) : this.provider,
    );
  }

  async seriesTerms(seriesKey: string): Promise<VaultSeriesTerms> {
    const state = (await this.vault().getFunction('seriesOf')(seriesKey)) as {
      principalFunded: bigint;
      maturityAt: bigint;
    };
    return { maturityAt: Number(state.maturityAt), principalFunded: state.principalFunded };
  }

  async subscriptionOf(seriesKey: string, holder: string): Promise<bigint> {
    return (await this.vault().getFunction('subscriptionOf')(seriesKey, holder)) as bigint;
  }

  async settlementBalanceOf(address: string): Promise<bigint> {
    return (await this.token().getFunction('balanceOf')(address)) as bigint;
  }

  async subscribe(seriesKey: string, holder: string, amount: bigint): Promise<SubscriptionWrite> {
    const signer = this.signer;
    if (signer === null) {
      throw new AppError(
        503,
        'subscription_key_missing',
        'Subscribing is not configured',
        'This API has no key for the account that holds SUBSCRIPTION_ROLE, so it cannot subscribe.',
      );
    }
    // The allowance first, for the reason the market's fill gives: an approve
    // through the ERC-20 facade is the dear half of this pair, about 1.7 HBAR
    // against a fraction of that for the subscribe, so one that is not needed
    // is not sent. A residual allowance is the normal case only when a previous
    // subscribe failed after its approve.
    const held = (await this.token().getFunction('allowance')(
      signer.address,
      this.vaultAddress,
    )) as bigint;
    let approveTx: string | null = null;
    if (held < amount) {
      const approval = await this.token(true).getFunction('approve')(this.vaultAddress, amount, {
        gasLimit: APPROVE_GAS_LIMIT,
      });
      const receipt = await approval.wait();
      if (receipt === null) throw new Error('no receipt for the settlement approval');
      approveTx = receipt.hash as string;
    }
    const sent = await this.vault(true).getFunction('subscribe')(seriesKey, holder, amount, {
      gasLimit: SUBSCRIBE_GAS_LIMIT,
    });
    const receipt = await sent.wait();
    if (receipt === null) throw new Error('no receipt for the subscription');
    return { approveTx, subscribeTx: receipt.hash as string, gasUsed: receipt.gasUsed.toString() };
  }
}

/**
 * A revert reaches the relay as a hex selector. These are the ones a
 * subscription can cause; anything else is a 502, with the selector in the log
 * and never in the response, because a caller cannot act on it.
 *
 * Three of them are this deployment being wrong rather than the caller: a
 * paused vault, an api account that does not hold SUBSCRIPTION_ROLE, and a
 * settlement token that refused the pull. They are still named, because
 * "something failed" sends somebody reading a screen looking in the wrong
 * place.
 */
const REVERT_CODES: Record<string, { status: number; code: string; title: string; detail: string }> =
  {
    SeriesUnknown: {
      status: 404,
      code: 'series_not_open',
      title: 'Series not open',
      detail: 'The vault has no series with that key, so there is nothing to subscribe to.',
    },
    SeriesMatured: {
      status: 409,
      code: 'series_matured',
      title: 'Series matured',
      detail: 'That series has reached maturity, so it takes no further subscriptions.',
    },
    ZeroAmount: {
      status: 400,
      code: 'amount_invalid',
      title: 'Amount refused',
      detail: 'A subscription is more than nought.',
    },
    ZeroAddress: {
      status: 400,
      code: 'holder_invalid',
      title: 'Holder refused',
      detail: 'The holder address is empty.',
    },
    EnforcedPause: {
      status: 409,
      code: 'vault_paused',
      title: 'The vault is paused',
      detail: 'The vault is paused, so no money moves in or out of it. Nothing was sent.',
    },
    AccessControlUnauthorizedAccount: {
      status: 502,
      code: 'subscription_role_missing',
      title: 'The vault refused the write',
      detail:
        'The account this API signs with does not hold the subscription role on the vault. Nothing was subscribed.',
    },
    SafeERC20FailedOperation: {
      status: 502,
      code: 'settlement_transfer_failed',
      title: 'The settlement token refused the transfer',
      detail:
        'The vault could not pull the principal from the paying account. Nothing was subscribed.',
    },
  };

/** Turn a reverted subscription into the problem document a caller can act on. */
export function mapSubscribeRevert(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const name = revertName(error);
  const mapped = name === null ? undefined : REVERT_CODES[name];
  if (mapped !== undefined) {
    return new AppError(mapped.status, mapped.code, mapped.title, mapped.detail);
  }
  return new AppError(
    502,
    'chain_write_failed',
    'The chain refused the write',
    'The subscription could not be written on chain. Nothing was charged. Try again.',
  );
}

function revertName(error: unknown): string | null {
  const candidate = error as { revert?: { name?: string }; shortMessage?: string };
  if (typeof candidate?.revert?.name === 'string') return candidate.revert.name;
  // ethers puts the decoded name in shortMessage when the error came back from
  // a static call rather than from a receipt.
  const match = /reverted with custom error '([A-Za-z]+)\(/.exec(candidate?.shortMessage ?? '');
  return match?.[1] ?? null;
}
