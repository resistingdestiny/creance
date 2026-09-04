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
  coupon?: {
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
  };
  steps?: Record<string, AtsStepRecord>;
}
