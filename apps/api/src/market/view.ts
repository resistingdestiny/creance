import { money, type Money } from '@creance/client';

import type { SeriesConfig } from '../investor/config.js';
import { asTimestamp, hashscanUrl, KYC_GRANTED, wholeUnits } from '../investor/view.js';
import type { NoteHolding, OfferReadiness, OfferState } from './chain.js';
import type { MarketAccount, MarketConfig } from './config.js';

/// The JSON the market endpoints return.
///
/// Same envelope as the investor endpoints: snake_case names, every amount an
/// integer string in the asset's minor units with the asset and its scale
/// beside it, and `display` never parsed by anything. The builders are pure;
/// everything that touches the network happens in the route.

export type OfferStatus = 'open' | 'filled' | 'cancelled' | 'unknown';

export interface PartyView {
  /// The demo role this address is, or null for an address the deployment
  /// record has never named.
  role: string | null;
  account_id: string | null;
  address: string;
  hashscan: string;
}

export interface OfferView {
  offer_id: string;
  status: OfferStatus;
  series_id: string | null;
  series_key: string | null;
  group: string | null;
  note: {
    address: string;
    contract_id: string | null;
    symbol: string | null;
    decimals: number;
    hashscan: string;
  };
  seller: PartyView;
  /// Null while the offer is open.
  buyer: PartyView | null;
  /// The lot, in the note's own minor units, and the same figure in whole units.
  units: string;
  units_whole: string;
  /// What the whole lot costs, and what that is a unit.
  price: Money;
  price_per_unit: Money;
  opened_at: string;
  closed_at: string | null;
  /// What stands between this offer and a fill. Null where it was not read.
  /// None of it is a compliance verdict: a buyer's eligibility is the note's to
  /// give and it is on the position view, per buyer.
  readiness: { open: boolean; seller_holds: boolean; seller_approved: boolean } | null;
  /// Whether a named would be buyer may hold this note at all, present only
  /// when the request named one. It is the note's own KYC register and nothing
  /// of ours: a screen greys the take button on this, and the note is what
  /// actually refuses.
  buyer_eligibility: {
    address: string;
    role: string | null;
    kyc_granted: boolean;
    reason: string | null;
  } | null;
  hashscan: string;
}

export interface OrderBookView {
  network: string;
  market: { address: string; contract_id: string | null; hashscan: string } | null;
  settlement_asset: { token_id: string; address: string; decimals: number; symbol: string };
  /// Every offer ever made, newest first, filtered by whatever the request
  /// asked for. A filled offer is not noise here: it is the only record of what
  /// a unit of this note last changed hands for.
  offers: OfferView[];
  counts: { total: number; open: number; filled: number; cancelled: number };
}

export interface PositionView {
  series_id: string;
  series_key: string;
  group: string;
  note: {
    address: string;
    contract_id: string | null;
    symbol: string | null;
    decimals: number;
    hashscan: string;
  };
  /// What the note reports as spendable, what is frozen, and the two added
  /// together, which is the holding. A screen that shows one without the other
  /// understates a frozen holder.
  units: string;
  units_frozen: string;
  units_position: string;
  units_whole: string;
  /// The note's own internal KYC register. Without a granted record this
  /// account cannot receive a unit of this note at all, whatever it offers.
  kyc: { status: number; granted: boolean };
}

export interface PositionsView {
  network: string;
  holder: PartyView;
  settlement_balance: Money;
  /// Only the series this account actually holds a unit of. A note with a zero
  /// balance is not a position.
  positions: PositionView[];
  /// The offers this account has open as a seller, and the ones it has filled
  /// as a buyer, newest first.
  offers: OfferView[];
}

const STATUS: Record<number, OfferStatus> = { 1: 'open', 2: 'filled', 3: 'cancelled' };
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export function statusOf(status: number): OfferStatus {
  return STATUS[status] ?? 'unknown';
}

/** The demo role behind an address, where the deployment record names one. */
export function partyFor(config: MarketConfig, address: string): PartyView {
  const known = config.accounts.find(
    (account) => account.address.toLowerCase() === address.toLowerCase(),
  );
  return {
    role: known?.role ?? null,
    account_id: known?.accountId ?? null,
    address,
    hashscan: hashscanUrl('account', known?.accountId ?? address, config.network),
  };
}

/**
 * The price of one whole unit.
 *
 * Integer division, floored, and it is exact for every lot this venue can
 * price: the note and the settlement asset carry the same six decimals, so a
 * lot of whole units at a whole price divides without a remainder. A lot that
 * does not is still reported, and the figure is then the floor, which is why
 * `price` and not this is what a fill actually moves.
 */
export function pricePerUnit(price: bigint, units: bigint, decimals: number): bigint {
  if (units <= 0n) return 0n;
  return (price * 10n ** BigInt(decimals)) / units;
}

export function buildOfferView(input: {
  config: MarketConfig;
  offer: OfferState;
  series: SeriesConfig | undefined;
  readiness: OfferReadiness | null;
  buyer?: { address: string; kycStatus: number | null };
}): OfferView {
  const { config, offer, series, readiness } = input;
  const candidate = input.buyer;
  const token = series?.settlementToken ?? config.settlementToken;
  // The note and the settlement asset carry the same six decimals, by design,
  // so a price never has to be rescaled between the two legs of a fill and one
  // number of decimals serves both.
  const decimals = token.decimals;
  const amount = (value: bigint): Money => money(value, token.tokenId, token.decimals);
  const venue = config.venue;
  return {
    offer_id: offer.offerId,
    status: statusOf(offer.status),
    series_id: series?.label ?? null,
    series_key: series?.seriesId ?? null,
    group: series?.group ?? null,
    note: {
      address: offer.note,
      contract_id: series?.note?.contractId ?? null,
      symbol: series?.note?.symbol ?? null,
      decimals,
      hashscan: hashscanUrl('contract', series?.note?.contractId ?? offer.note, config.network),
    },
    seller: partyFor(config, offer.seller),
    buyer: offer.buyer === ZERO_ADDRESS ? null : partyFor(config, offer.buyer),
    units: offer.units.toString(),
    units_whole: wholeUnits(offer.units, decimals),
    price: amount(offer.price),
    price_per_unit: amount(pricePerUnit(offer.price, offer.units, decimals)),
    opened_at: asTimestamp(offer.openedAt),
    closed_at: offer.closedAt === 0 ? null : asTimestamp(offer.closedAt),
    readiness:
      readiness === null
        ? null
        : {
            open: readiness.open,
            seller_holds: readiness.sellerHolds,
            seller_approved: readiness.sellerApproved,
          },
    buyer_eligibility:
      candidate === undefined
        ? null
        : {
            address: candidate.address,
            role: partyFor(config, candidate.address).role,
            kyc_granted: candidate.kycStatus === KYC_GRANTED,
            reason:
              candidate.kycStatus === KYC_GRANTED
                ? null
                : 'the note holds no granted KYC record for this account',
          },
    hashscan: hashscanUrl(
      'contract',
      venue?.contractId ?? venue?.address ?? offer.note,
      config.network,
    ),
  };
}

export function buildOrderBookView(input: {
  config: MarketConfig;
  offers: OfferView[];
}): OrderBookView {
  const { config, offers } = input;
  const venue = config.venue;
  return {
    network: config.network,
    market:
      venue === null
        ? null
        : {
            address: venue.address,
            contract_id: venue.contractId ?? null,
            hashscan: hashscanUrl('contract', venue.contractId ?? venue.address, config.network),
          },
    settlement_asset: {
      token_id: config.settlementToken.tokenId,
      address: config.settlementToken.address,
      decimals: config.settlementToken.decimals,
      symbol: config.settlementToken.symbol,
    },
    offers,
    counts: {
      total: offers.length,
      open: offers.filter((offer) => offer.status === 'open').length,
      filled: offers.filter((offer) => offer.status === 'filled').length,
      cancelled: offers.filter((offer) => offer.status === 'cancelled').length,
    },
  };
}

export function buildPositionView(input: {
  config: MarketConfig;
  series: SeriesConfig;
  holding: NoteHolding;
}): PositionView {
  const { config, series, holding } = input;
  const decimals = series.settlementToken.decimals;
  const position = holding.balance + holding.frozen;
  return {
    series_id: series.label,
    series_key: series.seriesId,
    group: series.group,
    note: {
      address: series.note?.address ?? '',
      contract_id: series.note?.contractId ?? null,
      symbol: series.note?.symbol ?? null,
      decimals,
      hashscan: hashscanUrl(
        'contract',
        series.note?.contractId ?? series.note?.address ?? '',
        config.network,
      ),
    },
    units: holding.balance.toString(),
    units_frozen: holding.frozen.toString(),
    units_position: position.toString(),
    units_whole: wholeUnits(position, decimals),
    kyc: { status: holding.kycStatus, granted: holding.kycStatus === KYC_GRANTED },
  };
}

export function buildPositionsView(input: {
  config: MarketConfig;
  account: MarketAccount | null;
  address: string;
  settlementBalance: bigint;
  positions: PositionView[];
  offers: OfferView[];
}): PositionsView {
  const { config, account, address, settlementBalance, positions, offers } = input;
  const token = config.settlementToken;
  return {
    network: config.network,
    holder:
      account === null
        ? partyFor(config, address)
        : {
            role: account.role,
            account_id: account.accountId,
            address: account.address,
            hashscan: hashscanUrl('account', account.accountId, config.network),
          },
    settlement_balance: money(settlementBalance, token.tokenId, token.decimals),
    positions,
    offers,
  };
}
