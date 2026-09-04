import { Contract, JsonRpcProvider, type InterfaceAbi } from 'ethers';

import { NOTE_ABI, VAULT_ABI } from './abi.js';
import type { SeriesConfig } from './config.js';

/// The reads the investor endpoints make, behind one interface.
///
/// The routes never touch ethers directly: they take a `ChainReader`, so the
/// unit tests drive them with recorded values and `pnpm test` stays chain free,
/// which is the rule for every test outside the testnet stage.

export interface VaultSeriesState {
  principalFunded: bigint;
  principalPaid: bigint;
  principalRedeemed: bigint;
  reserved: bigint;
  premiumBalance: bigint;
  subscriptionsOutstanding: bigint;
  maturityAt: number;
  atsToken: string;
}

export interface NoteState {
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: bigint;
  paused: boolean;
  maturityDate: number;
}

export interface HolderState {
  /// What the note reports as spendable. A partial freeze reduces it.
  balance: bigint;
  frozen: bigint;
  /// The vault subscription, which is the money at risk rather than the paper.
  subscription: bigint;
}

export interface CouponEntitlement {
  numerator: bigint;
  denominator: bigint;
  recordDateReached: boolean;
  tokenBalance: bigint;
}

export interface ChainReader {
  vaultSeries(series: SeriesConfig): Promise<VaultSeriesState>;
  note(series: SeriesConfig): Promise<NoteState | null>;
  holder(series: SeriesConfig, address: string): Promise<HolderState>;
  couponFor(series: SeriesConfig, couponId: string, address: string): Promise<CouponEntitlement | null>;
}

/// The JSON-RPC relay, through ethers. Reads only: this class has no signer and
/// cannot get one.
export class EthersChainReader implements ChainReader {
  private readonly provider: JsonRpcProvider;

  constructor(rpcUrl: string, chainId = 296) {
    this.provider = new JsonRpcProvider(rpcUrl, chainId, { staticNetwork: true });
  }

  private vault(series: SeriesConfig): Contract {
    return new Contract(series.vault.address, VAULT_ABI as unknown as InterfaceAbi, this.provider);
  }

  private noteAt(series: SeriesConfig): Contract | null {
    if (series.note === undefined) return null;
    return new Contract(series.note.address, NOTE_ABI as unknown as InterfaceAbi, this.provider);
  }

  async vaultSeries(series: SeriesConfig): Promise<VaultSeriesState> {
    const state = (await this.vault(series).getFunction('seriesOf')(series.seriesId)) as {
      principalFunded: bigint;
      principalPaid: bigint;
      principalRedeemed: bigint;
      reserved: bigint;
      premiumBalance: bigint;
      subscriptionsOutstanding: bigint;
      maturityAt: bigint;
      atsToken: string;
    };
    return {
      principalFunded: state.principalFunded,
      principalPaid: state.principalPaid,
      principalRedeemed: state.principalRedeemed,
      reserved: state.reserved,
      premiumBalance: state.premiumBalance,
      subscriptionsOutstanding: state.subscriptionsOutstanding,
      maturityAt: Number(state.maturityAt),
      atsToken: state.atsToken,
    };
  }

  async note(series: SeriesConfig): Promise<NoteState | null> {
    const note = this.noteAt(series);
    if (note === null) return null;
    const [name, symbol, decimals, totalSupply, paused, maturityDate] = await Promise.all([
      note.getFunction('name')() as Promise<string>,
      note.getFunction('symbol')() as Promise<string>,
      note.getFunction('decimals')() as Promise<bigint>,
      note.getFunction('totalSupply')() as Promise<bigint>,
      note.getFunction('paused')() as Promise<boolean>,
      note.getFunction('getMaturityDate')() as Promise<bigint>,
    ]);
    return {
      name,
      symbol,
      decimals: Number(decimals),
      totalSupply,
      paused,
      maturityDate: Number(maturityDate),
    };
  }

  async holder(series: SeriesConfig, address: string): Promise<HolderState> {
    const note = this.noteAt(series);
    const [balance, frozen] =
      note === null
        ? [0n, 0n]
        : await Promise.all([
            note.getFunction('balanceOf')(address) as Promise<bigint>,
            note.getFunction('getFrozenTokens')(address) as Promise<bigint>,
          ]);
    const subscription = (await this.vault(series).getFunction('subscriptionOf')(
      series.seriesId,
      address,
    )) as bigint;
    return { balance, frozen, subscription };
  }

  async couponFor(
    series: SeriesConfig,
    couponId: string,
    address: string,
  ): Promise<CouponEntitlement | null> {
    const note = this.noteAt(series);
    if (note === null) return null;
    const detail = (await note.getFunction('getCouponFor')(BigInt(couponId), address)) as {
      tokenBalance: bigint;
      couponAmount: { numerator: bigint; denominator: bigint; recordDateReached: boolean };
    };
    return {
      numerator: detail.couponAmount.numerator,
      denominator: detail.couponAmount.denominator,
      // recordDateReached is the signal that the holder snapshot has been
      // taken. The coupon's own snapshotId stays zero after the record date,
      // because the snapshot is taken lazily by the next operation that touches
      // a balance.
      recordDateReached: detail.couponAmount.recordDateReached,
      tokenBalance: detail.tokenBalance,
    };
  }
}
