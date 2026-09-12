import { money, type Money } from '@creance/client';
import {
  SENIORITY_BANDS,
  SENIORITY_BAND_LABELS,
  type SeniorityBand,
} from '@creance/index-model';
import type { FastifyPluginAsync } from 'fastify';

import {
  capacityFor,
  capacityReason,
  readSeriesCapacity,
  type BandCapacity,
} from '../capacity.js';
import { requireAdmin } from '../claims/token.js';
import { findSeries, seriesForGroup, type SeriesConfig } from '../config.js';
import { AppError } from '../errors.js';
import { newId } from '../ids.js';
import { priceCover } from '../pricing.js';
import { seriesRowFrom } from '../series.js';
import type { Services } from '../services.js';
import { optionalBand, requiredAmount, requiredString } from './quote.js';

/// The three routes that say what capital has and has not chosen.
///
///     GET  /v1/cover/bands            every occupation, what is funded in it
///     GET  /v1/series/:id/bands       one series, the capital side, in detail
///     POST /v1/series/:id/bands       commit capital to one band of one series
///
/// The first two are free and unmetered. A person must be able to find out that
/// no cover exists for them without paying to be told, and an investor deciding
/// where money is most wanted is reading the same numbers.
///
/// Every figure comes from real rows and the chain. apps/api/src/capacity.ts
/// holds the arithmetic and the argument; nothing here applies a multiplier to
/// a band, because a multiplier somebody chose would be a market that does not
/// exist dressed as one that does.
///
/// An unfunded band is not an error and is not drawn as one. It is capital
/// declining a risk, which is the ordinary business of an insurance market and
/// is almost never visible on a screen. `available` false with
/// `reason` `no_capital` is that state, and it is as much a part of the answer
/// as a price is.

/** One band, as both the worker flow and the investor screens read it. */
export interface BandView {
  band: SeniorityBand;
  label: string;
  /** Whether cover can be written in this band right now. */
  available: boolean;
  /** `no_capital`, `no_free_capacity`, or `none` when it is available. */
  reason: 'none' | 'no_capital' | 'no_free_capacity';
  /** Capital committed to the band, its exposure, and what is left. */
  capital: Money;
  exposure: Money;
  free: Money;
  /**
   * Exposure over capital, to four places, or null when there is no capital.
   * Never zero for that reason: a band nothing has funded has no utilisation,
   * and zero is the utilisation of a fully funded band with nothing written.
   */
  utilisation: string | null;
  /** The monthly premium for the limit asked about, or null when unavailable. */
  premium: Money | null;
  annual_rate_bps: number | null;
  /** The same for every band, which is the point: the risk measured is one risk. */
  guide_rate_bps: number | null;
}

export interface SeriesBandsView {
  series_id: string;
  group: string;
  /** What the chain says stands behind the series as a whole. */
  principal_remaining: Money;
  active_exposure: Money;
  /**
   * Principal that no subscription has named a band for, and the exposure that
   * named none either. Unallocated principal stands behind all three bands, so
   * the three capital figures sum to more than the principal while any of it is
   * unallocated. The series total is still the cap and is still enforced at
   * bind, twice.
   */
  unallocated: Money;
  unbanded_exposure: Money;
  bands: BandView[];
}

export const bandRoutes: FastifyPluginAsync<{ services: Services }> = async (app, options) => {
  const { services } = options;

  /// Every occupation with a series, and what is funded in each.
  ///
  /// `?group=` narrows it to one, and `?limit=` prices each band of that one,
  /// which is what the purchase flow's band question asks for. Without a group
  /// there is no price, because a price needs a limit and an index reading and
  /// neither belongs in a list of what exists.
  app.get<{ Querystring: { group?: string; limit?: string } }>(
    '/v1/cover/bands',
    async (request, reply) => {
      const wanted = request.query.group;
      if (wanted === undefined || wanted.trim() === '') {
        const series = services.config.series;
        const views = await Promise.all(series.map((entry) => readBands(services, entry, null)));
        return reply.send({ occupations: views });
      }

      const groupKey = wanted.trim();
      const group = await services.repository.group(groupKey);
      if (group === null) {
        throw new AppError(
          400,
          'group_unknown',
          'Unknown occupation',
          'That is not one of the fifteen occupation groups this index covers.',
        );
      }
      const seriesConfig = seriesForGroup(services.config, groupKey);
      if (seriesConfig === undefined) {
        throw new AppError(
          409,
          'no_capacity_for_group',
          'No cover behind this occupation',
          `No Displacement Bond Note series has been issued for ${group.label}, so there is no capacity to sell against.`,
        );
      }
      const limit =
        request.query.limit === undefined ? null : requiredAmount(request.query.limit, 'limit');
      return reply.send(await readBands(services, seriesConfig, limit));
    },
  );

  /// One series, addressed the way the investor screens address one.
  app.get<{ Params: { id: string } }>('/v1/series/:id/bands', async (request, reply) => {
    return reply.send(await readBands(services, seriesOr404(services, request.params.id), null));
  });

  /// Commit capital to one band of one series.
  ///
  /// This is the only way a band gets capital, and it is gated by the admin
  /// token because it records a commitment on somebody's behalf. The amount is
  /// checked against what the vault actually holds: allocations across the
  /// three bands may not add up to more than the principal remaining, so the
  /// record can never claim more capital than exists.
  ///
  /// It writes no chain transaction. The money is already in the vault against
  /// the series; what this records is which band of risk it will take, which is
  /// a thing the vault has no field for and cannot be given one under live
  /// cover. `chain_tx` carries the subscription it belongs to where the caller
  /// knows it, and stays null rather than being invented where it does not.
  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/v1/series/:id/bands',
    async (request, reply) => {
      requireAdmin(request, services.adminTokens);
      const seriesConfig = seriesOr404(services, request.params.id);
      const body = request.body ?? {};

      const band = optionalBand(body['band']);
      if (band === null) {
        throw new AppError(
          400,
          'validation_failed',
          'Validation failed',
          'band is required: capital commits to a band, not to a series.',
          [{ path: 'body.band', message: 'expected 0_5, 5_25 or 25_plus' }],
        );
      }
      const amount = requiredAmount(body['amount'], 'amount');
      if (amount <= 0n) {
        throw new AppError(
          400,
          'validation_failed',
          'Validation failed',
          'amount must be more than zero.',
          [{ path: 'body.amount', message: 'expected a positive integer in the asset minor units' }],
        );
      }
      const holder = requiredString(body['holder'], 'holder');
      const chainTx = typeof body['chain_tx'] === 'string' ? body['chain_tx'].trim() : null;

      const state = await services.chain.seriesState(seriesConfig.seriesId);
      await services.repository.upsertSeries(
        seriesRowFrom(seriesConfig, state, services.config),
      );
      const capacity = await readSeriesCapacity(services.repository, seriesConfig.label, state);
      if (amount > capacity.unallocated) {
        throw new AppError(
          409,
          'over_allocated',
          'More than the vault holds',
          `Only ${capacity.unallocated.toString()} of this series is unallocated, and a band cannot be funded with capital that is not there.`,
        );
      }

      const now = new Date();
      await services.repository.insertBandSubscription({
        subscriptionId: newId('bandSubscription', now.getTime()),
        seriesId: seriesConfig.label,
        band,
        holder,
        amount: amount.toString(),
        chainTx: chainTx === '' ? null : chainTx,
        createdAt: now.toISOString(),
      });

      return reply.status(201).send(await readBands(services, seriesConfig, null));
    },
  );
};

function seriesOr404(services: Services, id: string): SeriesConfig {
  const found = findSeries(services.config, id);
  if (found === undefined) {
    throw new AppError(
      404,
      'series_not_found',
      'Series not found',
      'No series with that id is deployed on this network.',
    );
  }
  return found;
}

/**
 * One series' bands, priced when a limit was asked for.
 *
 * The index reading is only read when there is a limit, because without one
 * there is no premium to compute and the availability answer does not depend on
 * the index at all: whether capital has chosen a band is a fact about capital.
 * A group whose index cannot be read still reports what is funded.
 */
async function readBands(
  services: Services,
  seriesConfig: SeriesConfig,
  limit: bigint | null,
): Promise<SeriesBandsView> {
  const state = await services.chain.seriesState(seriesConfig.seriesId);
  const capacity = await readSeriesCapacity(services.repository, seriesConfig.label, state);
  const asset = services.config.settlementToken;
  const amount = (value: bigint): Money => money(value.toString(), asset.tokenId, asset.decimals);

  const observations =
    limit === null ? [] : await services.repository.observations(seriesConfig.groupKey, 1);
  const latest = observations[0];
  const ebar = latest?.ebar ?? null;

  return {
    series_id: seriesConfig.label,
    group: seriesConfig.groupKey,
    principal_remaining: amount(capacity.principalRemaining),
    active_exposure: amount(capacity.activeExposure),
    unallocated: amount(capacity.unallocated),
    unbanded_exposure: amount(capacity.unbandedExposure),
    bands: SENIORITY_BANDS.map((band) =>
      bandView({
        capacity: capacityFor(capacity, band),
        band,
        limit,
        ebar,
        levelLine: state.levelLine,
        amount,
      }),
    ),
  };
}

function bandView(input: {
  capacity: Omit<BandCapacity, 'band'>;
  band: SeniorityBand;
  limit: bigint | null;
  ebar: number | null;
  levelLine: number;
  amount: (value: bigint) => Money;
}): BandView {
  const { capacity, amount } = input;
  const reason = input.limit === null ? capacityReason(capacity, 1n) : capacityReason(capacity, input.limit);
  const price =
    input.limit === null || input.ebar === null || reason !== 'none'
      ? null
      : priceCover({
          ebar: input.ebar,
          levelLine: input.levelLine,
          limit: input.limit,
          exposure: capacity.exposure,
          capital: capacity.capital,
        });

  return {
    band: input.band,
    label: SENIORITY_BAND_LABELS[input.band],
    available: reason === 'none',
    reason,
    capital: amount(capacity.capital),
    exposure: amount(capacity.exposure),
    free: amount(capacity.free),
    utilisation: capacity.utilisation === null ? null : capacity.utilisation.toFixed(4),
    premium: price === null ? null : amount(price.premium),
    annual_rate_bps: price?.annualRateBps ?? null,
    guide_rate_bps: price?.guideRateBps ?? null,
  };
}
