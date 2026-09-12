/// The secondary market's half of contracts/deployments/testnet.json.
///
/// It hangs off the top of the record rather than off a series, because one
/// NoteMarket serves every note: an offer names the note it is for, so a
/// second venue per series would only fragment the book.

export interface NoteMarketRecord {
  address: string;
  contractId?: string;
  settlementToken: string;
  deployTx: string;
  gasUsed?: number;
}

/// What the two sides held, before and after. Units are the note's minor units
/// and money is the settlement asset's, both integers as strings.
export interface MarketBalances {
  sellerUnits: string;
  buyerUnits: string;
  sellerMoney: string;
  buyerMoney: string;
}

/// One trade, from the offer to the settled fill, with the refused attempt in
/// the middle. Every field is a transaction anyone can open, or a value read
/// back off the chain after it.
export interface MarketTradeRecord {
  key: string;
  purpose: string;
  series: string;
  note: string;
  noteSymbol: string;
  seller: { role: string; accountId: string; address: string };
  buyer: { role: string; accountId: string; address: string };
  units: string;
  unitsWhole: string;
  price: string;
  pricePerUnit: string;
  /// The offer's id on the market contract, one based.
  offerId?: string;
  /// The seller's allowance to the market on the note.
  approveNoteTx?: string;
  offerTx?: string;
  /// The buyer's allowance to the market on the settlement asset.
  approveTokenTx?: string;
  /// The fill that was refused because the buyer held no KYC on the note, and
  /// the name of the error the note refused it with.
  refusedTx?: string;
  refusedRevert?: string;
  /// The KYC grant that made the buyer eligible, and the credential behind it.
  kycTx?: string;
  kycVcId?: string;
  /// The fill that settled.
  fillTx?: string;
  fillGasUsed?: number;
  before?: MarketBalances;
  after?: MarketBalances;
  at?: string;
}

/// One call to the market routes in apps/api, against the same venue and the
/// same testnet. It is kept apart from `trades` because these were made through
/// the API rather than by this script, and because one of them is still open:
/// an order book with nothing in it would tell a reader nothing about what the
/// screens above it look like.
export interface MarketApiCallRecord {
  offerId: string;
  route: string;
  seller: string;
  buyer?: string;
  units: string;
  unitsWhole: string;
  price: string;
  pricePerUnit: string;
  approveTx?: string;
  offerTx?: string;
  fillTx?: string;
  gasUsed?: number;
  /// A call the API refused without signing anything, and what it answered.
  refused?: { route: string; buyer: string; status: number; code: string; reason: string };
  status: 'open' | 'filled' | 'cancelled';
  at: string;
}

export interface SecondaryMarketRecord {
  market?: NoteMarketRecord;
  trades?: MarketTradeRecord[];
  /// What was proved through `GET`/`POST /v1/market/...` rather than through
  /// this script.
  api?: MarketApiCallRecord[];
}
