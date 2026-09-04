import type { ChainReader, CouponEntitlement, HolderState, NoteState, VaultSeriesState } from '../src/investor/chain.js';
import type { InvestorConfig, SeriesConfig } from '../src/investor/config.js';

/// The demo series as it stood on testnet after the first coupon settled, used
/// so the shapes are checked against real numbers with no chain in the test.

export const SERIES: SeriesConfig = {
  label: 'ODI-COMP-2026-01',
  seriesId: '0x4f44492d434f4d502d323032362d303100000000000000000000000000000000',
  group: 'computer_math',
  maturityAt: 1820082162,
  vault: { address: '0xD0473d355ECB299F2ECc0d92124bc8CF63554e60', contractId: '0.0.10367194' },
  note: { address: '0xBB14C072d2861B944C18e5f873C5aEa71c2F1f36', contractId: '0.0.10368240' },
  settlementToken: {
    tokenId: '0.0.10366463',
    address: '0x00000000000000000000000000000000009e2dff',
    decimals: 6,
    symbol: 'TUSD',
  },
  holders: [
    {
      role: 'investor-1',
      accountId: '0.0.10366460',
      address: '0xb6c2ff466e3c73f1a49a3f1b936f8e3837112931',
    },
    {
      role: 'investor-2',
      accountId: '0.0.10366462',
      address: '0xcaa1184cd59b9296f757efc7303a10ecec6ce51e',
    },
  ],
  paymentsTopicId: '0.0.10366471',
  coupons: [
    {
      couponId: '1',
      couponRef: 'ODI-COMP-2026-01#1',
      ratePercent: 8,
      recordDate: 1788553283,
      executionDate: 1788553583,
      startDate: 1788552983,
      endDate: 1791144983,
      holders: [
        {
          role: 'investor-1',
          accountId: '0.0.10366460',
          address: '0xb6c2ff466e3c73f1a49a3f1b936f8e3837112931',
          numerator: '1036800000000000000',
          denominator: '3153600000000000',
          amount: '328767123',
          remainder: '907200000000000',
          scheduleId: '0.0.10368878',
          scheduleMemo: 'creance coupon ODI-COMP-2026-01 1 investor-1',
          executedAt: '1788556871.150984988',
          executedTransactionId: '0.0.10366450-1788556746-724064738',
          result: 'SUCCESS',
          settled: true,
          topicSequenceNumber: '1',
        },
        {
          role: 'investor-2',
          accountId: '0.0.10366462',
          address: '0xcaa1184cd59b9296f757efc7303a10ecec6ce51e',
          numerator: '1036800000000000000',
          denominator: '3153600000000000',
          amount: '328767123',
          remainder: '907200000000000',
          scheduleId: '0.0.10368880',
          scheduleMemo: 'creance coupon ODI-COMP-2026-01 1 investor-2',
          executedAt: '1788556871.150985093',
          executedTransactionId: '0.0.10366450-1788556748-511830975',
          result: 'SUCCESS',
          settled: true,
          topicSequenceNumber: '2',
        },
      ],
    },
  ],
};

export const CONFIG: InvestorConfig = {
  network: 'testnet',
  rpcUrl: 'https://testnet.hashio.io/api',
  mirrorUrl: 'https://testnet.mirrornode.hedera.com/api/v1',
  series: [SERIES],
};

export const VAULT_STATE: VaultSeriesState = {
  principalFunded: 100_000_000_000n,
  principalPaid: 0n,
  principalRedeemed: 0n,
  reserved: 0n,
  premiumBalance: 0n,
  subscriptionsOutstanding: 100_000_000_000n,
  maturityAt: 1820082162,
  atsToken: '0x0000000000000000000000000000000000000000',
};

export const NOTE_STATE: NoteState = {
  name: 'Creance Displacement Bond Note ODI-COMP-2026-01',
  symbol: 'CDBN01',
  decimals: 6,
  totalSupply: 100_000_000n,
  paused: false,
  maturityDate: 1820082162,
};

export const ENTITLEMENT: CouponEntitlement = {
  numerator: 1_036_800_000_000_000_000n,
  denominator: 3_153_600_000_000_000n,
  recordDateReached: true,
  tokenBalance: 50_000_000n,
};

/// A reader that answers from the fixtures. Every test outside the testnet
/// stage runs against this, never against a relay.
export class FakeChainReader implements ChainReader {
  constructor(
    private readonly overrides: {
      vault?: Partial<VaultSeriesState>;
      note?: NoteState | null;
      holder?: Partial<HolderState>;
      entitlement?: CouponEntitlement | null;
    } = {},
  ) {}

  async vaultSeries(): Promise<VaultSeriesState> {
    return { ...VAULT_STATE, ...this.overrides.vault };
  }

  async note(): Promise<NoteState | null> {
    return this.overrides.note === undefined ? NOTE_STATE : this.overrides.note;
  }

  async holder(): Promise<HolderState> {
    return { balance: 50_000_000n, frozen: 0n, subscription: 50_000_000_000n, ...this.overrides.holder };
  }

  async couponFor(): Promise<CouponEntitlement | null> {
    return this.overrides.entitlement === undefined ? ENTITLEMENT : this.overrides.entitlement;
  }
}

/// The same series with no note deployed against it, which is what a series
/// looks like between `openSeries` and `pnpm ats:issue`.
export function seriesWithoutNote(): SeriesConfig {
  const series = { ...SERIES };
  delete series.note;
  return series;
}
