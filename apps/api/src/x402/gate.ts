import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { paymentMiddleware, x402ResourceServer } from '@x402/fastify';
import { HTTPFacilitatorClient } from '@x402/core/server';
import type { HTTPRequestContext, RoutesConfig } from '@x402/core/server';
import type { Network, PaymentRequirements } from '@x402/core/types';
import { ExactHederaScheme } from '@x402/hedera/exact/server';

import type { HederaGateway } from '../chain/hedera.js';
import type { Repository } from '../db/types.js';
import type { ProblemBody } from '../errors.js';
import { EXACT_SCHEME, X402_VERSION, type X402Config, type X402Price } from './config.js';
import {
  recordSettlement,
  TopicOutbox,
  type SettlementRecord,
  type SettlementSink,
} from './settlement.js';

/// The gate.
///
/// `GET /v1/index/:group` and `POST /v1/quote` are gated by the route map and
/// the Fastify middleware, which is the library's own path: it answers an
/// unpaid request with 402 and a `PAYMENT-REQUIRED` header, verifies a
/// `PAYMENT-SIGNATURE`, runs the handler, settles, and puts the receipt in
/// `PAYMENT-RESPONSE`. Verify before the handler and settle after it is the
/// `authorization` flow and it is the one we want: a handler that throws takes
/// no money.
///
/// `POST /v1/bind` is not in the route map. Its price is the first month's
/// premium, which is per quote, and the quote id is in the request body. The
/// middleware runs on Fastify's `onRequest` hook, which is before the body is
/// parsed, so a dynamic price function there is handed an undefined body and
/// cannot find the quote. See docs/harness-notes.md. It gets its own gate in
/// x402/bind.ts, driving the same `x402ResourceServer` so there is one wire
/// format, one facilitator and one settlement path.
///
/// The facilitator's fee payer account is not configured anywhere. The scheme
/// copies it out of the facilitator's `GET /supported` response into
/// `extra.feePayer` when the server initialises, and a payer that does not see
/// it there cannot build a transaction the facilitator will accept. So the
/// first protected request of a process reaches Blocky402 before it answers.
///
/// https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_hedera.md
/// https://blocky402.com/docs/api-reference/

export interface X402GateDeps {
  config: X402Config;
  repository: Repository;
  hedera: HederaGateway | null;
  paymentsTopicId: string;
  outbox?: TopicOutbox;
  /** Injected in tests so no unit test reaches a facilitator. */
  facilitatorClient?: ConstructorParameters<typeof x402ResourceServer>[0];
}

/** What a gated route is, beyond its price. */
interface GatedRoute {
  /** The route map key the middleware matches on. */
  pattern: string;
  /** How the payment is filed and published: the path with its parameter. */
  endpoint: string;
  description: string;
  price: (config: X402Config) => X402Price;
  /**
   * Whether a settled payment belongs to this route.
   *
   * By method and path rather than by the route map key, because the context
   * the settle hook is handed is the one built before the route was matched and
   * it carries no `routePattern`. See docs/harness-notes.md.
   */
  matches: (method: string, path: string) => boolean;
  /** What the payment bought, read from the request or from the answer. */
  ref: (path: string, responseBody: Buffer | undefined) => string | null;
}

const GATED_ROUTES: GatedRoute[] = [
  {
    // `:group` and not `/*`. A trailing wildcard in this library is optional:
    // `GET /v1/index/*` compiles to `^/v1/index(?:/.*?)?$` and so meters the
    // bare `/v1/index` as well, which is the free catalogue. See
    // docs/harness-notes.md. A named parameter compiles to one non-empty
    // segment, which is exactly the reading route and nothing else.
    pattern: 'GET /v1/index/:group',
    endpoint: 'GET /v1/index/:group',
    description: 'Latest ODI observation, 24 month history and trigger status',
    price: (config) => config.index,
    matches: (method, path) => method === 'GET' && path.startsWith('/v1/index/'),
    ref: (path) => path.split('/')[3] ?? null,
  },
  {
    pattern: 'POST /v1/quote',
    endpoint: 'POST /v1/quote',
    description: 'Binding price for occupation displacement cover, with the capacity behind it',
    price: (config) => config.quote,
    matches: (method, path) => method === 'POST' && path === '/v1/quote',
    ref: (_path, body) => readField(body, 'quote_id'),
  },
];

/** The endpoint label for the bind gate, which is not in the route map. */
export const BIND_ENDPOINT = 'POST /v1/bind';

/** What the bind gate hands the settlement hook, since it owns its own context. */
export interface CreanceSettleContext {
  request?: HTTPRequestContext;
  responseBody?: Buffer;
  creance?: { endpoint: string; ref: string | null; requestId: string };
}

export class X402Gate {
  readonly config: X402Config;
  readonly server: x402ResourceServer;
  readonly outbox: TopicOutbox;
  private readonly deps: X402GateDeps;
  private log: FastifyBaseLogger | null = null;
  private initialized: Promise<void> | null = null;

  constructor(deps: X402GateDeps) {
    this.deps = deps;
    this.config = deps.config;
    this.outbox = deps.outbox ?? new TopicOutbox();
    this.server = new x402ResourceServer(
      deps.facilitatorClient ?? new HTTPFacilitatorClient({ url: deps.config.facilitatorUrl }),
    ).register(
      // The wildcard, as the package README registers it, so a network string
      // change is configuration and not a code change.
      'hedera:*' as Network,
      new ExactHederaScheme({
        defaultAssets: {
          [deps.config.network]: {
            asset: deps.config.asset,
            decimals: deps.config.assetDecimals,
          },
        },
      }),
    );

    this.server.onAfterSettle(async (context) => {
      await this.settled(
        context.result as { transaction?: string; payer?: string; success?: boolean },
        context.requirements as PaymentRequirements,
        context.transportContext as CreanceSettleContext | undefined,
      );
    });

    // A verified payment that never settled because the handler failed. No
    // money moved, which is the behaviour the authorization flow buys us, and
    // it is worth one line in the log rather than silence.
    this.server.onVerifiedPaymentCanceled(async (context) => {
      this.logger().warn(
        { reason: context.reason, endpoint: endpointOf(context.transportContext) },
        'a verified payment was not settled because the request did not succeed',
      );
    });
  }

  useLogger(log: FastifyBaseLogger): void {
    this.log = log;
  }

  logger(): FastifyBaseLogger {
    if (this.log === null) throw new Error('the x402 gate has no logger yet');
    return this.log;
  }

  sink(): SettlementSink {
    return {
      repository: this.deps.repository,
      hedera: this.deps.hedera,
      paymentsTopicId: this.deps.paymentsTopicId,
      facilitatorUrl: this.config.facilitatorUrl,
      log: this.logger(),
    };
  }

  /**
   * Fetch the facilitator's supported kinds once.
   *
   * The middleware does this for its own routes on the first protected
   * request; the bind gate builds requirements itself and has to ask for it.
   */
  async initialize(): Promise<void> {
    this.initialized ??= this.server.initialize();
    try {
      await this.initialized;
    } catch (error) {
      // A failed sync must not be cached as a success: the next request tries
      // again rather than serving requirements with no fee payer in them,
      // which every payer would then refuse to build against.
      this.initialized = null;
      throw error;
    }
  }

  /** The requirements for a price, with the facilitator's fee payer in them. */
  async requirements(price: { amount: string }): Promise<PaymentRequirements[]> {
    await this.initialize();
    return await this.server.buildPaymentRequirements({
      scheme: EXACT_SCHEME,
      payTo: this.config.payTo,
      price: { amount: price.amount, asset: this.config.asset },
      network: this.config.network,
      maxTimeoutSeconds: this.config.maxTimeoutSeconds,
    });
  }

  /** The route map the Fastify middleware is registered with. */
  routes(): RoutesConfig {
    const routes: Record<string, unknown> = {};
    for (const route of GATED_ROUTES) {
      const price = route.price(this.config);
      routes[route.pattern] = {
        accepts: {
          scheme: EXACT_SCHEME,
          price: { amount: price.amount, asset: this.config.asset },
          network: this.config.network,
          payTo: this.config.payTo,
          maxTimeoutSeconds: this.config.maxTimeoutSeconds,
        },
        description: route.description,
        mimeType: 'application/json',
        serviceName: 'Creance',
        tags: ['insurance', 'parametric', 'labour', 'index'],
        unpaidResponseBody: (context: HTTPRequestContext) => ({
          contentType: 'application/problem+json',
          body: this.paymentRequiredProblem(context.path, price),
        }),
      };
    }
    return routes as RoutesConfig;
  }

  /**
   * The 402 body.
   *
   * The protocol travels in the headers, so the body is ours and it is the same
   * RFC 9457 problem document every other refusal from this API returns. It
   * repeats the price in a readable form because the person debugging an agent
   * reads the body, not the base64 header. `retryable` is false: the same
   * request will be refused again, and the caller has to pay rather than wait.
   */
  paymentRequiredProblem(path: string, price: X402Price): PaymentRequiredProblem {
    return {
      type: 'https://creance.co/errors/payment-required',
      title: 'Payment required',
      status: 402,
      detail: `This endpoint is paid. Send ${price.display} ${this.config.assetSymbol} with the PAYMENT-SIGNATURE header and retry.`,
      instance: path,
      code: 'payment_required',
      request_id: '',
      retryable: false,
      price: {
        amount: price.amount,
        asset: this.config.asset,
        decimals: this.config.assetDecimals,
        display: price.display,
      },
      x402_version: X402_VERSION,
      scheme: EXACT_SCHEME,
      network: this.config.network,
      pay_to: this.config.payTo,
      facilitator: this.config.facilitatorUrl,
    };
  }

  private async settled(
    result: { transaction?: string; transactionId?: string; payer?: string; success?: boolean },
    requirements: PaymentRequirements,
    context: CreanceSettleContext | undefined,
  ): Promise<void> {
    // The Hedera scheme specification calls the field `transactionId` and
    // Blocky402's API reference calls it `transaction`. Read both: a settlement
    // with no transaction id is not publishable, and publishing it anyway would
    // put an unverifiable line in the audit trail.
    const transactionId = result.transaction ?? result.transactionId ?? '';
    if (result.success !== true || transactionId === '') {
      this.logger().error(
        { result },
        'a settlement reported success without a transaction id and was not recorded',
      );
      return;
    }
    const record: SettlementRecord = {
      endpoint: context?.creance?.endpoint ?? endpointOf(context) ?? 'unknown',
      scheme: requirements.scheme,
      network: requirements.network,
      // The facilitator returns the paying wallet here. The scheme's own
      // example puts the sponsoring fee payer in the same field, so it is
      // checked rather than trusted: an empty value falls back to nothing
      // rather than filing the fee payer as the payer.
      payer: result.payer ?? '',
      payTo: requirements.payTo,
      amount: requirements.amount,
      asset: requirements.asset,
      assetDecimals: this.config.assetDecimals,
      transactionId,
      ref: context?.creance?.ref ?? refOf(context),
      requestId: context?.creance?.requestId ?? '',
    };
    try {
      await recordSettlement(this.sink(), record, this.outbox);
    } catch (error) {
      this.logger().error(
        { err: error, facilitator_tx: transactionId, endpoint: record.endpoint },
        'a payment settled on chain but could not be written down',
      );
    }
  }
}

export interface PaymentRequiredProblem extends ProblemBody {
  price: { amount: string; asset: string; decimals: number; display: string };
  x402_version: number;
  scheme: string;
  network: string;
  pay_to: string;
  facilitator: string;
}

/**
 * Put the gate in front of the routes.
 *
 * Called before the route plugins are registered, because the middleware's
 * `onRequest` hook has to be in place when a gated route is matched.
 */
export function registerX402(app: FastifyInstance, gate: X402Gate): void {
  gate.useLogger(app.log);
  paymentMiddleware(app, gate.routes(), gate.server);

  // The middleware builds the 402 body before Fastify's request id exists, so
  // the one field the error envelope needs and the body cannot know is filled
  // in on the way out. Registered after the middleware so it runs after it.
  app.addHook('onSend', async (request, reply, payload) => {
    if (reply.statusCode !== 402 || typeof payload !== 'string') return payload;
    const type = reply.getHeader('content-type');
    if (typeof type !== 'string' || !type.includes('application/problem+json')) return payload;
    try {
      const body = JSON.parse(payload) as ProblemBody;
      if (body.request_id !== '') return payload;
      return JSON.stringify({ ...body, request_id: request.id });
    } catch {
      return payload;
    }
  });
}

function routeOf(request: HTTPRequestContext): GatedRoute | undefined {
  return GATED_ROUTES.find((entry) => entry.matches(request.method, request.path));
}

function endpointOf(context: unknown): string | null {
  const request = (context as CreanceSettleContext | undefined)?.request;
  if (request === undefined) return null;
  return routeOf(request)?.endpoint ?? `${request.method} ${request.path}`;
}

function refOf(context: unknown): string | null {
  const settle = context as CreanceSettleContext | undefined;
  const request = settle?.request;
  if (request === undefined) return null;
  const route = routeOf(request);
  return route === undefined ? null : route.ref(request.path, settle?.responseBody);
}

/** One string field out of a JSON response body, or null when it is not there. */
function readField(body: Buffer | undefined, field: string): string | null {
  if (body === undefined || body.length === 0) return null;
  try {
    const parsed = JSON.parse(body.toString('utf8')) as Record<string, unknown>;
    const value = parsed[field];
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}
