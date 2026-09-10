/// The ATS half of contracts/deployments/testnet.json. It hangs off the series
/// record because the note and the vault series are the same instrument seen
/// from two sides, and T07 and T14 read both from one file.

export interface AtsNoteRecord {
  contractId?: string;
  address: string;
  name: string;
  symbol: string;
  isin: string;
  decimals: number;
  units: string;
  nominalValue: string;
  principal: string;
  currency: string;
  maxSupply: string;
  startingDate: number;
  maturityDate: number;
  internalKycActivated: boolean;
  regulation: string;
  deployTx: string;
  gasUsed?: number;
}

/// One ATS coupon corporate action: the rate, the accrual window and the two
/// dates that decide when it is payable. It declares and snapshots and never
/// moves money; the payment is a Scheduled Transaction, which is T14.
export interface AtsCouponRecord {
  id: string;
  ratePercent: number;
  rate: string;
  rateDecimals: number;
  recordTimestamp: number;
  executionTimestamp: number;
  startTimestamp: number;
  endTimestamp: number;
  fixingTimestamp: number;
  tx: string;
  /// True when the record date was brought forward so the period could be
  /// settled before its accrual window closed. See docs/DECISIONS.md, T06.
  recordDateBroughtForward?: boolean;
}

export interface AtsStepRecord {
  /// The transaction hash, or the reason there is none.
  tx?: string;
  /// What the step asserted afterwards, in the words the reader needs.
  result: string;
  /// The revert name, verbatim, for a step that is meant to fail.
  revert?: string;
  gasUsed?: number;
}

export interface AtsRecord {
  version: string;
  tag: string;
  factoryId: string;
  factory: string;
  resolverId: string;
  resolver: string;
  configId: string;
  configVersion?: number;
  note?: AtsNoteRecord;
  /// The first deployment, made with junk values to prove the factory pair
  /// before the real series is issued.
  throwaway?: AtsNoteRecord & { finding?: string };
  issuer?: string;
  roles?: Record<string, string>;
  kyc?: Record<string, { vcId: string; validFrom: number; validTo: number; tx: string }>;
  /// The first coupon declared on the note. It stays because a record written
  /// before there was a list carries only this, and `coupons` is seeded from
  /// it on the first run that reads either.
  coupon?: AtsCouponRecord;
  /// Every coupon declared on the note, oldest first, including the first.
  /// A note pays a coupon a month, so the settlement runner needs the list and
  /// not just the latest one.
  coupons?: AtsCouponRecord[];
  steps?: Record<string, AtsStepRecord>;
}
