/// The T14 half of contracts/deployments/testnet.json. The coupon settlements
/// hang off the series because a coupon belongs to one note; the maturity
/// demonstration is a series of its own and sits at the top level.

/// What one noteholder was paid for one coupon, from the ATS fraction through
/// to the executed transfer.
export interface CouponHolderSettlement {
  role: string;
  accountId: string;
  address: string;
  /// The ATS entitlement, verbatim, in whole currency units.
  numerator: string;
  denominator: string;
  /// floor(numerator * 10^decimals / denominator), in settlement token minor units.
  amount: string;
  /// What the truncation left in the premium account, as a fraction of a minor unit.
  remainder: string;
  /// The Scheduled Transaction that paid the holder. It holds the vault's
  /// `fundCoupon` call, so the schedule is the payment and there is no separate
  /// transfer: the settlement token goes straight from the premium account to
  /// the noteholder.
  scheduleId?: string;
  createFeeHbar?: string;
  gasUsed?: number;
  scheduleCreateTx?: string;
  scheduleMemo?: string;
  executeAt?: string;
  executedAt?: string;
  executedTransactionId?: string;
  /// SUCCESS, or the failure the transfer inside the schedule hit. Only SUCCESS
  /// is a payment.
  result?: string;
  settled?: boolean;
  /// The payments topic entry, written only after the transfer settled.
  topicSequenceNumber?: string;
  topicTx?: string;
  links?: Record<string, string>;
}

export interface CouponSettlementRecord {
  couponId: string;
  seriesLabel: string;
  /// The bytes32 the vault recorded against the payment, `<series>#<couponId>`.
  couponRef: string;
  recordDate: number;
  executionDate: number;
  startDate: number;
  endDate: number;
  ratePercent: number;
  /// The premium seeded for the demonstration, because no policy had been bound
  /// yet and there was no premium inflow to pay from. See docs/DECISIONS.md.
  premiumSeed?: {
    from: string;
    amount: string;
    transferTx: string;
    attributeTx: string;
    attributeGasUsed?: number;
  };
  /// Whether a contract call can be wrapped in a Scheduled Transaction on
  /// testnet, measured rather than assumed, because the answer decides whether
  /// the vault can pay a holder directly. See docs/harness-notes.md.
  scheduledContractCall?: {
    attempted: boolean;
    status: string;
    scheduleId?: string;
    /// The result of the executed schedule, once it has run.
    result?: string;
    /// The custom error the scheduled call reverted with, which is what names
    /// the account the vault saw as the caller.
    revert?: string;
  };
  holders: CouponHolderSettlement[];
}

export interface SubscriptionRecord {
  role: string;
  accountId: string;
  address: string;
  amount: string;
  fundTx?: string;
  approveTx?: string;
  subscribeTx?: string;
  gasUsed?: number;
}

export interface RedemptionRecord {
  role: string;
  address: string;
  amount: string;
  tx: string;
  gasUsed?: number;
  /// The ATS burn of the same holding, where the demonstration carries a note.
  burnTx?: string;
  burnGasUsed?: number;
}

/// A second, short dated series opened only to reach maturity inside the event.
/// It is not the demo series: both the demo series and its note mature on 4
/// September 2027 and neither maturity date can be moved back.
export interface MaturityDemoRecord {
  label: string;
  seriesId: string;
  maturityAt: number;
  openSeriesTx?: string;
  subscriptions: SubscriptionRecord[];
  redemptions: RedemptionRecord[];
  /// The matching short dated ATS bond, so the burn half is shown as well.
  note?: {
    contractId?: string;
    address: string;
    name: string;
    symbol: string;
    isin: string;
    maturityDate: number;
    deployTx: string;
    gasUsed?: number;
    kycTx?: string;
    mintTx?: string;
    minted?: string;
  };
  /// What the principal reduction after a paid claim reads as on chain, taken
  /// from the T04 run through series rather than paying a second claim.
  principalAfterPayout?: {
    series: string;
    principalFunded: string;
    principalPaid: string;
    principalRemaining: string;
  };
}
