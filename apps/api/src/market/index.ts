import type { FastifyInstance, FastifyPluginAsync, FastifyReply } from 'fastify';

import type { SeriesConfig } from '../investor/config.js';
import { KYC_GRANTED } from '../investor/view.js';
import {
  EthersMarketChain,
  FillRefused,
  type MarketReader,
  type MarketWriter,
  type OfferState,
} from './chain.js';
import {
  findAccount,
  findMarketSeries,
  loadMarketConfig,
  seriesForNote,
  type MarketAccount,
  type MarketConfig,
} from './config.js';
import {
  buildOfferView,
  buildOrderBookView,
  buildPositionsView,
  buildPositionView,
  type OfferView,
  type OrderBookView,
  type PositionsView,
} from './view.js';

/// The secondary market endpoints.
///
///     GET  /v1/market/offers            the order book
///     GET  /v1/market/offers/:id        one offer
///     GET  /v1/market/positions/:holder what an account holds and has traded
///     POST /v1/market/offers            offer a lot of note units at a price
///     POST /v1/market/offers/:id/fill   take an offer
///     POST /v1/market/offers/:id/cancel withdraw an offer
///
/// **None of these is x402 gated, and that is a decision rather than an
/// oversight.** What this build meters is data it sells, which is the index
/// reading, and the premium, which is the price of the cover. A venue fee would
/// be the third thing worth metering, and this venue charges none: a fill moves
/// units from the seller to the buyer and money from the buyer to the seller
/// with nothing skimmed off either leg, and the contract has no treasury to
/// skim it to. Charging for a fee that does not exist would be a fee with no
/// beneficiary, and charging to read a public order book would suppress the one
/// thing an order book is for. See docs/ATS.md, "The secondary market".
///
/// The reads hold no key. The writes do: they sign as one of the demo accounts,
/// whose keys are derived from the operator key the way every other account in
/// this build is. That is a demonstration posture, it is said plainly in the
/// response, and a deployment with no operator key answers 503 on the writes
/// and serves the reads exactly as before.

export interface MarketPluginOptions {
  config?: MarketConfig;
  reader?: MarketReader;
  writer?: MarketWriter | null;
}

interface OfferParams {
  id: string;
}

interface HolderParams {
  holder: string;
}

interface BookQuery {
  status?: string;
  series?: string;
  holder?: string;
  /// An account a screen is about to offer a take button to. Naming one adds
  /// `buyer_eligibility` to every open offer, which is the note's own answer to
  /// whether that account may hold it.
  buyer?: string;
}

interface OfferBody {
  seller?: unknown;
  series?: unknown;
  units?: unknown;
  price?: unknown;
}

interface FillBody {
  buyer?: unknown;
}

interface CancelBody {
  seller?: unknown;
}

/** RFC 9457 problem document, the envelope every non-2xx response carries. */
function problem(
  reply: FastifyReply,
  status: number,
  code: string,
  title: string,
  detail: string,
  retryable: boolean,
): FastifyReply {
  return reply
    .status(status)
    .type('application/problem+json')
    .send({
      type: `https://creance.co/errors/${code.replace(/_/g, '-')}`,
      title,
      status,
      detail,
      instance: reply.request.url,
      code,
      request_id: reply.request.id,
      retryable,
    });
}

function amountFrom(value: unknown, field: string): bigint {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new BadRequest(`${field}_invalid`, `"${field}" must be an integer in minor units.`);
  }
  const raw = String(value).trim();
  if (!/^[0-9]+$/.test(raw)) {
    throw new BadRequest(`${field}_invalid`, `"${field}" must be an integer in minor units.`);
  }
  const parsed = BigInt(raw);
  if (parsed <= 0n) {
    throw new BadRequest(`${field}_invalid`, `"${field}" must be more than nought.`);
  }
  return parsed;
}

class BadRequest extends Error {
  constructor(
    readonly code: string,
    readonly detail: string,
  ) {
    super(detail);
    this.name = 'BadRequest';
  }
}

export const marketRoutes: FastifyPluginAsync<MarketPluginOptions> = async (
  app: FastifyInstance,
  options: MarketPluginOptions,
) => {
  const config = options.config ?? loadMarketConfig();
  const chain =
    options.reader === undefined || options.writer === undefined
      ? new EthersMarketChain(config, process.env.HEDERA_OPERATOR_KEY)
      : null;
  const reader = options.reader ?? chain!;
  const writer = options.writer === undefined ? (chain!.canSign ? chain : null) : options.writer;

  app.get<{ Querystring: BookQuery }>('/v1/market/offers', async (request, reply) => {
    const view = await readOrderBook(reader, config, request.query ?? {});
    return reply.send(view);
  });

  app.get<{ Params: OfferParams; Querystring: BookQuery }>(
    '/v1/market/offers/:id',
    async (request, reply) => {
    const id = Number(request.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return problem(
        reply,
        400,
        'offer_id_invalid',
        'Offer not found',
        'An offer id is a whole number of one or more.',
        false,
      );
    }
    const candidate =
      request.query?.buyer === undefined ? undefined : findAccount(config, request.query.buyer);
    const view = await readOffer(
      reader,
      config,
      id,
      candidate?.address ?? request.query?.buyer,
    );
    if (view === null) {
      return problem(
        reply,
        404,
        'offer_not_found',
        'Offer not found',
        'No offer with that id has been made on this market.',
        false,
      );
    }
    return reply.send(view);
    },
  );

  app.get<{ Params: HolderParams }>('/v1/market/positions/:holder', async (request, reply) => {
    const account = findAccount(config, request.params.holder);
    const address = account?.address ?? request.params.holder.trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
      return problem(
        reply,
        404,
        'holder_not_found',
        'Account not found',
        'Name a holder by its demo role, its account id or its EVM address.',
        false,
      );
    }
    const view = await readPositions(reader, config, account ?? null, address);
    return reply.send(view);
  });

  app.post<{ Body: OfferBody }>('/v1/market/offers', async (request, reply) => {
    if (writer === null) return writesUnavailable(reply);
    const body = request.body ?? {};
    let seller: MarketAccount;
    let series: SeriesConfig;
    let units: bigint;
    let price: bigint;
    try {
      seller = signerOr400(config, body.seller, 'seller');
      series = seriesOr400(config, body.series);
      units = amountFrom(body.units, 'units');
      price = amountFrom(body.price, 'price');
    } catch (error) {
      if (!(error instanceof BadRequest)) throw error;
      return problem(reply, 400, error.code, 'Offer refused', error.detail, false);
    }
    if (series.note === undefined) {
      return problem(
        reply,
        409,
        'series_has_no_note',
        'Nothing to sell',
        'That series has no note issued against it, so there is nothing to offer.',
        false,
      );
    }
    const holding = await reader.holding(series, seller.address);
    if (holding === null || holding.balance < units) {
      return problem(
        reply,
        409,
        'units_not_held',
        'Offer refused',
        `${seller.role} holds ${holding?.balance.toString() ?? '0'} of that note and the offer is ${units.toString()}.`,
        false,
      );
    }
    const venue = config.venue!;
    const placed = await writer.offer(venue.address, seller, series.note.address, units, price);
    const view = await readOffer(reader, config, Number(placed.offerId));
    return reply.status(201).send({
      ...view,
      transactions: {
        approve: placed.approveTx ?? null,
        offer: placed.offerTx,
      },
    });
  });

  app.post<{ Params: OfferParams; Body: FillBody }>(
    '/v1/market/offers/:id/fill',
    async (request, reply) => {
      if (writer === null) return writesUnavailable(reply);
      const id = Number(request.params.id);
      let buyer: MarketAccount;
      try {
        buyer = signerOr400(config, (request.body ?? {}).buyer, 'buyer');
      } catch (error) {
        if (!(error instanceof BadRequest)) throw error;
        return problem(reply, 400, error.code, 'Fill refused', error.detail, false);
      }
      const offer = await safeOffer(reader, config, id);
      if (offer === null) {
        return problem(
          reply,
          404,
          'offer_not_found',
          'Offer not found',
          'No offer with that id has been made on this market.',
          false,
        );
      }
      if (offer.status !== 1) {
        return problem(
          reply,
          409,
          'offer_not_open',
          'Offer not open',
          'That offer has already been filled or withdrawn.',
          false,
        );
      }
      if (offer.seller.toLowerCase() === buyer.address.toLowerCase()) {
        return problem(
          reply,
          409,
          'seller_cannot_fill',
          'Fill refused',
          'The account that made an offer cannot take it.',
          false,
        );
      }
      // Checked before anything is signed. A fill the note will refuse reverts
      // the whole transaction, and the buyer would still pay for the approval
      // that preceded it, so the refusal is found by reading rather than by
      // spending. It is the same gate either way: this is the note's own KYC
      // register, read back.
      const series = seriesForNote(config, offer.note);
      if (series !== undefined) {
        const holding = await reader.holding(series, buyer.address);
        if (holding !== null && holding.kycStatus !== KYC_GRANTED) {
          return problem(
            reply,
            409,
            'fill_refused',
            'Fill refused',
            `The note would not settle this transfer: InvalidKycStatus. ${buyer.role} holds no granted KYC record on this note.`,
            false,
          );
        }
      }
      const funds = await reader.settlementBalance(buyer.address);
      if (funds < offer.price) {
        return problem(
          reply,
          409,
          'insufficient_settlement_balance',
          'Fill refused',
          `${buyer.role} holds ${funds.toString()} and the offer costs ${offer.price.toString()}.`,
          false,
        );
      }
      const venue = config.venue!;
      try {
        const result = await writer.fill(venue.address, buyer, id, offer.price);
        const view = await readOffer(reader, config, id);
        return reply.status(200).send({
          ...view,
          transactions: { approve: result.approveTx ?? null, fill: result.fillTx },
          gas_used: result.gasUsed,
        });
      } catch (error) {
        if (!(error instanceof FillRefused)) throw error;
        // The note refused it, and what it refused it with is the answer. The
        // common case by far is a buyer with no KYC record on that note, which
        // is the compliance gate doing its job and not a fault in this API.
        return problem(
          reply,
          409,
          'fill_refused',
          'Fill refused',
          `The note would not settle this transfer: ${error.reason}.`,
          false,
        );
      }
    },
  );

  app.post<{ Params: OfferParams; Body: CancelBody }>(
    '/v1/market/offers/:id/cancel',
    async (request, reply) => {
      if (writer === null) return writesUnavailable(reply);
      const id = Number(request.params.id);
      let seller: MarketAccount;
      try {
        seller = signerOr400(config, (request.body ?? {}).seller, 'seller');
      } catch (error) {
        if (!(error instanceof BadRequest)) throw error;
        return problem(reply, 400, error.code, 'Cancellation refused', error.detail, false);
      }
      const offer = await safeOffer(reader, config, id);
      if (offer === null) {
        return problem(
          reply,
          404,
          'offer_not_found',
          'Offer not found',
          'No offer with that id has been made on this market.',
          false,
        );
      }
      if (offer.seller.toLowerCase() !== seller.address.toLowerCase()) {
        return problem(
          reply,
          403,
          'not_the_seller',
          'Cancellation refused',
          'Only the account that made an offer can withdraw it.',
          false,
        );
      }
      const venue = config.venue!;
      const tx = await writer.cancel(venue.address, seller, id);
      const view = await readOffer(reader, config, id);
      return reply.status(200).send({ ...view, transactions: { cancel: tx } });
    },
  );
};

function writesUnavailable(reply: FastifyReply): FastifyReply {
  return problem(
    reply,
    503,
    'market_writes_unavailable',
    'Trading is not available here',
    'This deployment reads the market but cannot sign for an account, so it cannot make or take an offer.',
    false,
  );
}

function signerOr400(config: MarketConfig, value: unknown, field: string): MarketAccount {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new BadRequest(`${field}_missing`, `"${field}" names the account acting, by its role.`);
  }
  const account = findAccount(config, value);
  if (account === undefined) {
    throw new BadRequest(
      `${field}_unknown`,
      `This deployment cannot act for "${value.trim()}". It signs only for the accounts in its own record.`,
    );
  }
  return account;
}

function seriesOr400(config: MarketConfig, value: unknown): SeriesConfig {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new BadRequest('series_missing', '"series" names the series, by its label, id or group.');
  }
  const series = findMarketSeries(config, value);
  if (series === undefined) {
    throw new BadRequest('series_not_found', 'No series with that id is deployed on this network.');
  }
  return series;
}

async function safeOffer(
  reader: MarketReader,
  config: MarketConfig,
  offerId: number,
): Promise<OfferState | null> {
  if (config.venue === null) return null;
  const count = await reader.offerCount();
  if (!Number.isInteger(offerId) || offerId < 1 || offerId > count) return null;
  return reader.offerAt(config.venue.address, offerId);
}

/** One offer, with what stands between it and a fill. */
export async function readOffer(
  reader: MarketReader,
  config: MarketConfig,
  offerId: number,
  buyer?: string,
): Promise<OfferView | null> {
  const offer = await safeOffer(reader, config, offerId);
  if (offer === null) return null;
  const series = seriesForNote(config, offer.note);
  const readiness =
    offer.status === 1 ? await reader.readiness(config.venue!.address, offerId) : null;
  const candidate =
    buyer === undefined || series === undefined
      ? undefined
      : {
          address: buyer,
          kycStatus: (await reader.holding(series, buyer))?.kycStatus ?? null,
        };
  return buildOfferView({
    config,
    offer,
    series,
    readiness,
    ...(candidate === undefined ? {} : { buyer: candidate }),
  });
}

/**
 * The order book.
 *
 * Newest first, and filled offers are in it by default. An order book that
 * showed only what is open would throw away the only record this system has of
 * what a unit of a note last changed hands for, which is the number an investor
 * deciding whether to sell actually wants. `?status=open` narrows it.
 *
 * Readiness is read for open offers only, because it is two more chain calls an
 * offer and a closed offer cannot become fillable again.
 */
export async function readOrderBook(
  reader: MarketReader,
  config: MarketConfig,
  query: BookQuery,
): Promise<OrderBookView> {
  if (config.venue === null) {
    return buildOrderBookView({ config, offers: [] });
  }
  const wanted = (query.status ?? 'all').trim().toLowerCase();
  const series = query.series === undefined ? undefined : findMarketSeries(config, query.series);
  const holder = query.holder === undefined ? undefined : findAccount(config, query.holder);
  const holderAddress = (holder?.address ?? query.holder ?? '').toLowerCase();

  const candidate = query.buyer === undefined ? undefined : findAccount(config, query.buyer);
  const candidateAddress = candidate?.address ?? query.buyer;
  // One read per note rather than one per offer: eligibility is a property of
  // the account and the note, and a book with ten offers on one note would
  // otherwise ask the same question ten times.
  const eligibility = new Map<string, number | null>();

  const count = await reader.offerCount();
  const ids = Array.from({ length: count }, (_, index) => count - index);
  const states = await Promise.all(ids.map((id) => reader.offerAt(config.venue!.address, id)));
  const offers: OfferView[] = [];
  for (const state of states) {
    if (series !== undefined && state.note.toLowerCase() !== series.note?.address.toLowerCase()) {
      continue;
    }
    if (
      holderAddress !== '' &&
      state.seller.toLowerCase() !== holderAddress &&
      state.buyer.toLowerCase() !== holderAddress
    ) {
      continue;
    }
    const readiness =
      state.status === 1
        ? await reader.readiness(config.venue.address, Number(state.offerId))
        : null;
    const entry = seriesForNote(config, state.note);
    const key = state.note.toLowerCase();
    if (candidateAddress !== undefined && entry !== undefined && !eligibility.has(key)) {
      eligibility.set(key, (await reader.holding(entry, candidateAddress))?.kycStatus ?? null);
    }
    const view = buildOfferView({
      config,
      offer: state,
      series: entry,
      readiness,
      ...(candidateAddress === undefined || entry === undefined
        ? {}
        : { buyer: { address: candidateAddress, kycStatus: eligibility.get(key) ?? null } }),
    });
    if (wanted !== 'all' && view.status !== wanted) continue;
    offers.push(view);
  }
  return buildOrderBookView({ config, offers });
}

/**
 * What an account holds and what it has traded.
 *
 * The balance is read on every series that has a note and only the non zero
 * ones are returned, because a position is something you hold. The reads are
 * issued together rather than in turn: fifteen series in sequence is fifteen
 * round trips to the relay and a screen nobody waits for.
 */
export async function readPositions(
  reader: MarketReader,
  config: MarketConfig,
  account: MarketAccount | null,
  address: string,
): Promise<PositionsView> {
  const withNotes = config.series.filter((series) => series.note !== undefined);
  const holdings = await Promise.all(
    withNotes.map(async (series) => ({ series, holding: await reader.holding(series, address) })),
  );
  const positions = holdings
    .filter((entry) => entry.holding !== null && entry.holding.balance + entry.holding.frozen > 0n)
    .map((entry) => buildPositionView({ config, series: entry.series, holding: entry.holding! }));
  const [settlementBalance, book] = await Promise.all([
    reader.settlementBalance(address),
    readOrderBook(reader, config, { holder: address }),
  ]);
  return buildPositionsView({
    config,
    account,
    address,
    settlementBalance,
    positions,
    offers: book.offers,
  });
}
