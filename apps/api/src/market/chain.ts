import { Contract, JsonRpcProvider, Wallet, type InterfaceAbi } from 'ethers';
import { roleKeyHex } from '@creance/client';

import type { SeriesConfig } from '../investor/config.js';
import { MARKET_ABI, NOTE_ERROR_ABI, NOTE_MARKET_ABI, SETTLEMENT_ABI } from './abi.js';
import type { MarketAccount, MarketConfig } from './config.js';

/// Everything the market endpoints do on chain, behind two interfaces.
///
/// `MarketReader` is reads and nothing else, so the order book and a holder's
/// positions can be unit tested with recorded values and no network, which is
/// the rule for every test outside the testnet stage.
///
/// `MarketWriter` signs. It is the first thing in this API that signs as an
/// investor rather than as the api account, and it is worth being plain about
/// what that is: every account in this build carries a key derived from the
/// operator key, so the demo accounts on the investor screen can act without a
/// browser wallet. It is a demonstration posture and not a custody model, and
/// the write routes refuse outright on a deployment with no operator key
/// rather than pretending to have one.

export interface OfferState {
  offerId: string;
  note: string;
  seller: string;
  /// Zero address while the offer is open.
  buyer: string;
  units: bigint;
  price: bigint;
  openedAt: number;
  closedAt: number;
  /// 1 open, 2 filled, 3 cancelled. 0 never occurs for a real offer.
  status: number;
}

/// What stands between an open offer and a fill, read off the chain rather
/// than assumed. None of it is a compliance verdict: that is the note's, and
/// `buyerEligible` on the position read is where it comes from.
export interface OfferReadiness {
  open: boolean;
  sellerHolds: boolean;
  sellerApproved: boolean;
}

export interface NoteHolding {
  balance: bigint;
  frozen: bigint;
  kycStatus: number;
}

export interface MarketReader {
  offerCount(): Promise<number>;
  offerAt(venue: string, offerId: number): Promise<OfferState>;
  readiness(venue: string, offerId: number): Promise<OfferReadiness>;
  /// The note balance an account holds, null where there is no note to ask.
  holding(series: SeriesConfig, address: string): Promise<NoteHolding | null>;
  settlementBalance(address: string): Promise<bigint>;
  /// The allowance an account has given the venue on the settlement asset.
  settlementAllowance(owner: string, spender: string): Promise<bigint>;
}

export interface OfferPlacement {
  offerId: string;
  offerTx: string;
  /// Present only when this call had to raise the seller's allowance first.
  approveTx?: string;
}

export interface FillResult {
  fillTx: string;
  approveTx?: string;
  gasUsed: number;
}

/// A fill the note would refuse. It is raised before anything is sent, because
/// a transaction that is certain to revert costs the buyer a fee and proves
/// nothing that `eth_call` has not already said.
export class FillRefused extends Error {
  constructor(readonly reason: string) {
    super(`the note refused the transfer: ${reason}`);
    this.name = 'FillRefused';
  }
}

export interface MarketWriter {
  offer(
    venue: string,
    account: MarketAccount,
    note: string,
    units: bigint,
    price: bigint,
  ): Promise<OfferPlacement>;
  fill(venue: string, account: MarketAccount, offerId: number, price: bigint): Promise<FillResult>;
  cancel(venue: string, account: MarketAccount, offerId: number): Promise<string>;
}

/// Explicit gas limits, for the reason the contracts workspace gives: the relay
/// cannot estimate a call whose cost depends on state it cannot see, and unused
/// gas is refunded in full. An HTS approve through the ERC-20 facade is priced
/// by converting a USD cost to gas, so it is orders of magnitude dearer than a
/// storage write: it measured 729,787 against 162,781 for the note's own.
///
/// They are close to what the calls actually cost rather than generous, because
/// unused gas being refunded is not the whole story on Hedera. The relay
/// refuses a transaction whose sender cannot cover `gasLimit` times the quoted
/// gas price, so a limit set four times higher than needed asks the signing
/// account to hold four times the HBAR it will spend, and an investor account
/// funded for trading is refused before the call is priced. The figures below
/// are the measured cost of each call with room to spare.
const GAS = {
  approveNote: 400_000,
  approveToken: 1_200_000,
  offer: 400_000,
  fill: 1_200_000,
  cancel: 200_000,
} as const;

function marketAbi(): InterfaceAbi {
  return [...MARKET_ABI, ...NOTE_ERROR_ABI] as unknown as InterfaceAbi;
}

/** The name of the custom error a call reverted with, decoded where it can be. */
export function revertNameOf(error: unknown): string {
  const wrapped = error as {
    revert?: { name?: string; args?: unknown[] };
    shortMessage?: string;
    message?: string;
  };
  if (wrapped.revert?.name !== undefined) return wrapped.revert.name;
  return wrapped.shortMessage ?? wrapped.message ?? String(error);
}

export class EthersMarketChain implements MarketReader, MarketWriter {
  private readonly provider: JsonRpcProvider;

  constructor(
    private readonly config: MarketConfig,
    /// The operator key, or undefined on a deployment that has none. Without it
    /// this object still reads; it just cannot sign.
    private readonly operatorKey?: string,
    chainId = 296,
  ) {
    this.provider = new JsonRpcProvider(config.rpcUrl, chainId, { staticNetwork: true });
  }

  get canSign(): boolean {
    return this.operatorKey !== undefined && this.operatorKey.trim() !== '';
  }

  private venue(address: string, runner: Wallet | JsonRpcProvider = this.provider): Contract {
    return new Contract(address, marketAbi(), runner);
  }

  private noteAt(address: string, runner: Wallet | JsonRpcProvider = this.provider): Contract {
    return new Contract(
      address,
      [...NOTE_MARKET_ABI, ...NOTE_ERROR_ABI] as unknown as InterfaceAbi,
      runner,
    );
  }

  private token(runner: Wallet | JsonRpcProvider = this.provider): Contract {
    return new Contract(
      this.config.settlementToken.address,
      SETTLEMENT_ABI as unknown as InterfaceAbi,
      runner,
    );
  }

  /**
   * The wallet for a role.
   *
   * The operator signs with the operator key itself; every other account
   * carries a key derived from it with HKDF-SHA256 and the label
   * `creance/testnet/<role>`, which is the derivation day 0 used. No derived
   * secret is stored anywhere, here or on disk.
   */
  private walletFor(account: MarketAccount): Wallet {
    if (this.operatorKey === undefined || this.operatorKey.trim() === '') {
      throw new Error('this deployment holds no operator key, so it cannot sign');
    }
    const key =
      account.role === 'operator'
        ? this.operatorKey.trim()
        : roleKeyHex(this.operatorKey.trim(), account.role);
    const hex = key.startsWith('0x') ? key : `0x${key}`;
    const wallet = new Wallet(hex, this.provider);
    if (wallet.address.toLowerCase() !== account.address.toLowerCase()) {
      throw new Error(`the derived key for ${account.role} does not match its recorded address`);
    }
    return wallet;
  }

  async offerCount(): Promise<number> {
    if (this.config.venue === null) return 0;
    return Number((await this.venue(this.config.venue.address).getFunction('offerCount')()) as bigint);
  }

  async offerAt(venue: string, offerId: number): Promise<OfferState> {
    const entry = (await this.venue(venue).getFunction('offerAt')(BigInt(offerId))) as {
      note: string;
      seller: string;
      buyer: string;
      units: bigint;
      price: bigint;
      openedAt: bigint;
      closedAt: bigint;
      status: bigint;
    };
    return {
      offerId: offerId.toString(),
      note: entry.note,
      seller: entry.seller,
      buyer: entry.buyer,
      units: entry.units,
      price: entry.price,
      openedAt: Number(entry.openedAt),
      closedAt: Number(entry.closedAt),
      status: Number(entry.status),
    };
  }

  async readiness(venue: string, offerId: number): Promise<OfferReadiness> {
    const [open, sellerHolds, sellerApproved] = (await this.venue(venue).getFunction('fillable')(
      BigInt(offerId),
    )) as [boolean, boolean, boolean];
    return { open, sellerHolds, sellerApproved };
  }

  async holding(series: SeriesConfig, address: string): Promise<NoteHolding | null> {
    if (series.note === undefined) return null;
    const note = this.noteAt(series.note.address);
    const [balance, frozen, kycStatus] = await Promise.all([
      note.getFunction('balanceOf')(address) as Promise<bigint>,
      note.getFunction('getFrozenTokens')(address) as Promise<bigint>,
      note.getFunction('getKycStatusFor')(address).then(Number) as Promise<number>,
    ]);
    return { balance, frozen, kycStatus };
  }

  async settlementBalance(address: string): Promise<bigint> {
    return (await this.token().getFunction('balanceOf')(address)) as bigint;
  }

  async settlementAllowance(owner: string, spender: string): Promise<bigint> {
    return (await this.token().getFunction('allowance')(owner, spender)) as bigint;
  }

  async offer(
    venue: string,
    account: MarketAccount,
    note: string,
    units: bigint,
    price: bigint,
  ): Promise<OfferPlacement> {
    const wallet = this.walletFor(account);
    const placement: { approveTx?: string } = {};
    // The allowance is what makes the offer fillable, so it is raised here
    // rather than left to the seller as a second step nobody would remember.
    const held = (await this.noteAt(note).getFunction('allowance')(
      account.address,
      venue,
    )) as bigint;
    if (held < units) {
      const approval = await this.noteAt(note, wallet).getFunction('approve')(venue, units, {
        gasLimit: GAS.approveNote,
      });
      const receipt = await approval.wait();
      if (receipt === null) throw new Error('no receipt for the note approval');
      placement.approveTx = receipt.hash as string;
    }
    const contract = this.venue(venue, wallet);
    const before = (await contract.getFunction('offerCount')()) as bigint;
    const sent = await contract.getFunction('offer')(note, units, price, { gasLimit: GAS.offer });
    const receipt = await sent.wait();
    if (receipt === null) throw new Error('no receipt for the offer');
    const after = (await contract.getFunction('offerCount')()) as bigint;
    if (after !== before + 1n) throw new Error('the offer did not land on the market');
    return { offerId: after.toString(), offerTx: receipt.hash as string, ...placement };
  }

  async fill(
    venue: string,
    account: MarketAccount,
    offerId: number,
    price: bigint,
  ): Promise<FillResult> {
    const wallet = this.walletFor(account);
    const result: { approveTx?: string } = {};
    const held = await this.settlementAllowance(account.address, venue);
    if (held < price) {
      const approval = await this.token(wallet).getFunction('approve')(venue, price, {
        gasLimit: GAS.approveToken,
      });
      const receipt = await approval.wait();
      if (receipt === null) throw new Error('no receipt for the settlement approval');
      result.approveTx = receipt.hash as string;
    }
    const contract = this.venue(venue, wallet);
    // Simulated first. A fill that the note refuses reverts the whole
    // transaction, so sending it would cost the buyer a fee to learn what
    // eth_call has already said. The refusal is reported as a refusal.
    try {
      await contract.getFunction('fill').staticCall(BigInt(offerId), { gasLimit: GAS.fill });
    } catch (error) {
      throw new FillRefused(revertNameOf(error));
    }
    const sent = await contract.getFunction('fill')(BigInt(offerId), { gasLimit: GAS.fill });
    const receipt = await sent.wait();
    if (receipt === null) throw new Error('no receipt for the fill');
    if (receipt.status !== 1) throw new FillRefused('the fill reverted on chain');
    return { fillTx: receipt.hash as string, gasUsed: Number(receipt.gasUsed), ...result };
  }

  async cancel(venue: string, account: MarketAccount, offerId: number): Promise<string> {
    const wallet = this.walletFor(account);
    const sent = await this.venue(venue, wallet).getFunction('cancel')(BigInt(offerId), {
      gasLimit: GAS.cancel,
    });
    const receipt = await sent.wait();
    if (receipt === null) throw new Error('no receipt for the cancellation');
    return receipt.hash as string;
  }
}
