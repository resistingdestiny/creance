import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';

import { EthersChainReader, type ChainReader, type CouponEntitlement } from './chain.js';
import { findSeries, loadInvestorConfig, type InvestorConfig, type SeriesConfig } from './config.js';
import {
  buildCouponsView,
  buildSeriesView,
  entitlementKey,
  type CouponsView,
  type SeriesView,
} from './view.js';

/// The investor endpoints.
///
///     GET /v1/series/:id
///     GET /v1/series/:id/coupons
///
/// Self contained on purpose. The API this belongs to is T07 and it is not
/// built yet, so this plugin reads chain state directly rather than a database:
/// vault views and the note through the JSON-RPC relay, the coupon settlements
/// from the deployment record `pnpm coupons:pay` writes. T07 registers the same
/// plugin and swaps the reader when the database exists.
///
/// Every amount that crosses the wire is an integer string in the settlement
/// asset's minor units. Nothing here can write to the chain: the reader has no
/// signer and the plugin holds no key.

export interface InvestorPluginOptions {
  config?: InvestorConfig;
  reader?: ChainReader;
  prefix?: string;
}

interface SeriesParams {
  id: string;
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

async function seriesOr404(
  config: InvestorConfig,
  request: FastifyRequest<{ Params: SeriesParams }>,
  reply: FastifyReply,
): Promise<SeriesConfig | null> {
  const series = findSeries(config, request.params.id);
  if (series === undefined) {
    await problem(
      reply,
      404,
      'series_not_found',
      'Series not found',
      'No series with that id is deployed on this network.',
      false,
    );
    return null;
  }
  return series;
}

export const investorRoutes: FastifyPluginAsync<InvestorPluginOptions> = async (
  app: FastifyInstance,
  options: InvestorPluginOptions,
) => {
  const config = options.config ?? loadInvestorConfig();
  const reader = options.reader ?? new EthersChainReader(config.rpcUrl);

  app.get<{ Params: SeriesParams }>('/v1/series/:id', async (request, reply) => {
    const series = await seriesOr404(config, request, reply);
    if (series === null) return reply;
    const view = await readSeries(reader, config, series);
    return reply.send(view);
  });

  app.get<{ Params: SeriesParams }>('/v1/series/:id/coupons', async (request, reply) => {
    const series = await seriesOr404(config, request, reply);
    if (series === null) return reply;
    const view = await readCoupons(reader, config, series);
    return reply.send(view);
  });
};

/** One series, as the investor screen reads it. */
export async function readSeries(
  reader: ChainReader,
  config: InvestorConfig,
  series: SeriesConfig,
): Promise<SeriesView> {
  const [vault, note] = await Promise.all([reader.vaultSeries(series), reader.note(series)]);
  const holders = await Promise.all(
    series.holders.map(async (holder) => ({
      config: holder,
      state: await reader.holder(series, holder.address),
    })),
  );
  return buildSeriesView({ series, network: config.network, vault, note, holders });
}

/** Every coupon declared on the series, with what was paid for it. */
export async function readCoupons(
  reader: ChainReader,
  config: InvestorConfig,
  series: SeriesConfig,
): Promise<CouponsView> {
  const entitlements = new Map<string, CouponEntitlement | null>();
  for (const coupon of series.coupons) {
    for (const holder of coupon.holders) {
      // Read live rather than trusting the record: the entitlement is what the
      // note says it is, and a mismatch with the recorded settlement is
      // something an investor should be able to see.
      const entitlement = await reader.couponFor(series, coupon.couponId, holder.address);
      entitlements.set(entitlementKey(coupon.couponId, holder.address), entitlement);
    }
  }
  return buildCouponsView({ series, network: config.network, entitlements });
}
