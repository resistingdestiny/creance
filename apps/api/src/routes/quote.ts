import type { FastifyPluginAsync, FastifyRequest } from 'fastify';

import { seriesForGroup } from '../config.js';
import type { QuoteRow } from '../db/types.js';
import { AppError } from '../errors.js';
import { newId } from '../ids.js';
import {
  LIMIT_MAX_MAJOR,
  LIMIT_MIN_MAJOR,
  LIMIT_STEP_MAJOR,
  limitIsOffered,
  priceCover,
} from '../pricing.js';
import type { Services } from '../services.js';
import { monthsOf, seriesRowFrom } from '../series.js';
import { buildQuoteView, type QuoteView } from '../views.js';

/// POST /v1/quote
///
/// The binding price for a limit in a group, with the capacity behind it
/// checked against the series principal. DESIGN.md 3.7 makes this a paid call;
/// T08 puts the x402 gate in front of it and nothing here changes then.
///
/// A quote takes no capacity hold. It reports capacity as it stands and
/// /v1/bind rechecks under a row lock and against the chain. Holding capacity
/// would mean expiring holds, and a hold that leaks is a series nobody can
/// fill.

export interface QuoteBody {
  group?: unknown;
  limit?: unknown;
  wallet?: unknown;
  series_id?: unknown;
}

export const quoteRoutes: FastifyPluginAsync<{ services: Services }> = async (app, options) => {
  const { services } = options;

  app.post<{ Body: QuoteBody }>('/v1/quote', async (request, reply) => {
    const view = await quote(services, request.body ?? {}, request);
    return reply.status(201).send(view);
  });
};

export async function quote(
  services: Services,
  body: QuoteBody,
  request: Pick<FastifyRequest, 'headers'>,
): Promise<QuoteView> {
  const groupKey = requiredString(body.group, 'group');
  const limit = requiredAmount(body.limit, 'limit');

  const group = await services.repository.group(groupKey);
  if (group === null) {
    throw new AppError(
      400,
      'group_unknown',
      'Unknown occupation',
      'That is not one of the fifteen occupation groups this index covers.',
    );
  }

  const decimals = services.config.settlementToken.decimals;
  if (!limitIsOffered(limit, decimals)) {
    throw new AppError(
      400,
      'limit_out_of_range',
      'Amount not offered',
      `Cover is sold from ${LIMIT_MIN_MAJOR} to ${LIMIT_MAX_MAJOR} in steps of ${LIMIT_STEP_MAJOR}.`,
    );
  }

  // Capacity is committed per occupation at subscription, not allocated pro
  // rata (docs/DECISIONS.md), so a group with no series behind it has no price
  // rather than a price nobody can buy. Fourteen of the fifteen are in that
  // position today and the response says so plainly.
  const seriesConfig = seriesForGroup(services.config, groupKey);
  if (seriesConfig === undefined) {
    throw new AppError(
      409,
      'no_capacity_for_group',
      'No cover behind this occupation',
      `No Displacement Bond Note series has been issued for ${group.label}, so there is no capacity to sell against.`,
    );
  }
  if (body.series_id !== undefined && body.series_id !== null) {
    const wanted = requiredString(body.series_id, 'series_id');
    if (wanted !== seriesConfig.label && wanted !== seriesConfig.seriesId) {
      throw new AppError(
        404,
        'series_not_found',
        'Series not found',
        'No series with that id offers cover for that occupation.',
      );
    }
  }

  const state = await services.chain.seriesState(seriesConfig.seriesId);
  if (state.status !== 'active' && state.status !== 'claims_open') {
    throw new AppError(
      409,
      'series_not_open_for_binding',
      'Series not open',
      'That series is not taking new cover.',
    );
  }
  if (state.activeExposure + limit > state.principalRemaining) {
    throw new AppError(
      409,
      'insufficient_capacity',
      'No capacity',
      'The series has no capacity left for a policy of that size.',
    );
  }

  const observations = await services.repository.observations(groupKey, 1);
  const latest = observations[0];
  if (latest === undefined || latest.ebar === null) {
    throw new AppError(
      503,
      'index_unavailable',
      'No index yet',
      'The index has no reading for that occupation, so cover cannot be priced.',
    );
  }

  const price = priceCover({
    ebar: latest.ebar,
    // The frozen level line of record for the series is the one on chain: it is
    // what the contract compares against, so pricing off anything else would
    // quote a rate for a trigger that is not the one that pays.
    levelLine: state.levelLine,
    limit,
    activeExposure: state.activeExposure,
    principalRemaining: state.principalRemaining,
  });

  await services.repository.upsertSeries(seriesRowFrom(seriesConfig, state, services.config));

  const now = new Date();
  const wallet = requiredString(body.wallet, 'wallet');
  const row: QuoteRow = {
    quoteId: newId('quote', now.getTime()),
    seriesId: seriesConfig.label,
    groupKey,
    wallet,
    walletEvm: null,
    coverLimit: limit.toString(),
    premium: price.premium.toString(),
    asset: services.config.settlementToken.tokenId,
    assetDecimals: decimals,
    annualRateBps: price.annualRateBps,
    pricingBasis: { ...price.basis, observed_period: latest.period, source: latest.source },
    issuedVia: issuedVia(request),
    expiresAt: new Date(now.getTime() + services.config.quoteTtlSeconds * 1000).toISOString(),
    consumedAt: null,
    policyId: null,
  };
  await services.repository.insertQuote(row);

  return buildQuoteView({
    quote: row,
    termMonths: monthsOf(state.termSeconds),
    waitingPeriodDays: Math.round(state.waitingPeriodSeconds / 86_400),
    coverStarts: now,
    coverEnds: new Date(now.getTime() + state.termSeconds * 1000),
    claimsPayableFrom: new Date(now.getTime() + state.waitingPeriodSeconds * 1000),
    attachmentShock: state.attachmentShock,
    levelLine: state.levelLine,
    payoutMode: state.payoutMode,
    freeBefore: state.freeCapacity,
    principalRemaining: state.principalRemaining,
    activeExposure: state.activeExposure,
  });
}

/** How the caller satisfied the gate. T08 makes `x402` the agent's answer. */
function issuedVia(request: Pick<FastifyRequest, 'headers'>): QuoteRow['issuedVia'] {
  return typeof request.headers.authorization === 'string' ? 'credential' : 'open';
}

export function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AppError(400, 'validation_failed', 'Validation failed', `${field} is required.`, [
      { path: `body.${field}`, message: 'expected a non-empty string' },
    ]);
  }
  return value.trim();
}

/**
 * An amount is a decimal string in minor units. A JSON number is refused
 * rather than coerced: 5000000000 survives, but the first person to widen the
 * scale finds out that the one before them did not.
 */
export function requiredAmount(value: unknown, field: string): bigint {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new AppError(400, 'validation_failed', 'Validation failed', `${field} is required.`, [
      { path: `body.${field}`, message: 'expected an integer string in the asset minor units' },
    ]);
  }
  return BigInt(value);
}
