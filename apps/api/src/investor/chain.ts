import { Contract, JsonRpcProvider, type InterfaceAbi } from 'ethers';

import { COVER_POOL_ABI, NOTE_ABI, VAULT_ABI } from './abi.js';
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
  /// The note's internal KYC register: 1 is GRANTED, 0 is NOT_GRANTED. Null
  /// where there is no note to ask, which is not the same as being refused.
  kycStatus: number | null;
}

/// What the CoverPool knows about a series. The vault holds the money and the
/// pool holds the policies, so the exposure and the term are only here.
export interface CoverPoolSeriesState {
  /// False when the series was never registered in the pool, which reads back
  /// as a zeroed struct and must not be reported as a series at zero capacity.
  registered: boolean;
  activeExposure: bigint;
  exposureCovered: bigint;
  /// Seconds. The demo series is 365 days.
  term: number;
  status: number;
}

export interface CouponEntitlement {
  numerator: bigint;
  denominator: bigint;
  recordDateReached: boolean;
  tokenBalance: bigint;
}

/// One coupon as the note declares it: the accrual window, the two dates that
/// decide when it is payable, and the rate with its scale.
///
/// This is the schedule and not a payment. Whether a declared coupon was ever
/// settled is in the deployment record, because the money moved as a Scheduled
/// Transaction and the note knows nothing about it.
export interface DeclaredCoupon {
  couponId: string;
  recordDate: number;
  executionDate: number;
  startDate: number;
  endDate: number;
  rate: bigint;
  rateDecimals: number;
  /// True when the coupon was cancelled. A cancelled coupon pays nothing and
  /// is not the next payment.
  cancelled: boolean;
}

export interface ChainReader {
  vaultSeries(series: SeriesConfig): Promise<VaultSeriesState>;
  note(series: SeriesConfig): Promise<NoteState | null>;
  holder(series: SeriesConfig, address: string): Promise<HolderState>;
  coverPoolSeries(series: SeriesConfig): Promise<CoverPoolSeriesState | null>;
  couponFor(series: SeriesConfig, couponId: string, address: string): Promise<CouponEntitlement | null>;
  /// Every coupon declared on the note, oldest first, or null where there is no
  /// note or it cannot answer.
  couponSchedule(series: SeriesConfig): Promise<DeclaredCoupon[] | null>;
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

  private coverPoolAt(series: SeriesConfig): Contract | null {
    if (series.coverPool === undefined) return null;
    return new Contract(
      series.coverPool.address,
      COVER_POOL_ABI as unknown as InterfaceAbi,
      this.provider,
    );
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
    const [balance, frozen, kycStatus] =
      note === null
        ? [0n, 0n, null]
        : await Promise.all([
            note.getFunction('balanceOf')(address) as Promise<bigint>,
            note.getFunction('getFrozenTokens')(address) as Promise<bigint>,
            note.getFunction('getKycStatusFor')(address).then(Number) as Promise<number>,
          ]);
    const subscription = (await this.vault(series).getFunction('subscriptionOf')(
      series.seriesId,
      address,
    )) as bigint;
    return { balance, frozen, subscription, kycStatus };
  }

  async coverPoolSeries(series: SeriesConfig): Promise<CoverPoolSeriesState | null> {
    const pool = this.coverPoolAt(series);
    if (pool === null) return null;
    const terms = (await pool.getFunction('seriesOf')(series.seriesId)) as {
      term: bigint;
      status: bigint;
      activeExposure: bigint;
      exposureCovered: bigint;
    };
    const term = Number(terms.term);
    return {
      // registerSeries refuses a zero term, so a zero term here can only mean
      // the series was never registered in this pool.
      registered: term > 0,
      activeExposure: terms.activeExposure,
      exposureCovered: terms.exposureCovered,
      term,
      status: Number(terms.status),
    };
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

  async couponSchedule(series: SeriesConfig): Promise<DeclaredCoupon[] | null> {
    const note = this.noteAt(series);
    if (note === null) return null;
    try {
      const count = Number((await note.getFunction('getCouponCount')()) as bigint);
      // Coupon ids are one based and getCoupon reverts on an id the note never
      // declared, so the count is the only safe way to enumerate them.
      const ids = Array.from({ length: count }, (_, index) => index + 1);
      return await Promise.all(ids.map((id) => this.declaredCoupon(note, id)));
    } catch {
      // A note whose coupon facet is not registered, or a relay that would not
      // answer. An unknown schedule is not an empty one: the caller renders
      // nothing rather than "no further payments".
      return null;
    }
  }

  private async declaredCoupon(note: Contract, id: number): Promise<DeclaredCoupon> {
    const [registered, cancelled] = (await note.getFunction('getCoupon')(BigInt(id))) as [
      {
        coupon: {
          recordDate: bigint;
          executionDate: bigint;
          startDate: bigint;
          endDate: bigint;
          rate: bigint;
          rateDecimals: bigint;
        };
      },
      boolean,
    ];
    return {
      couponId: id.toString(),
      recordDate: Number(registered.coupon.recordDate),
      executionDate: Number(registered.coupon.executionDate),
      startDate: Number(registered.coupon.startDate),
      endDate: Number(registered.coupon.endDate),
      rate: registered.coupon.rate,
      rateDecimals: Number(registered.coupon.rateDecimals),
      cancelled,
    };
  }
}
