import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
} from '@x402/core/http';
import type { PaymentPayload, PaymentRequirements } from '@x402/core/types';
import { toDisplay } from '@creance/client';

import type { QuoteRow } from '../db/types.js';
import { AppError } from '../errors.js';
import { BIND_ENDPOINT, type CreanceSettleContext, type X402Gate } from './gate.js';
import { recordSettlementFailure } from './settlement.js';

/// The gate on `POST /v1/bind`, where the price is the first month's premium.
///
/// Everything the Fastify middleware does, done here, and for one reason: the
/// price is per quote and the quote id is in the request body, which does not
/// exist yet when the middleware runs. The wire format is identical because it
/// is produced by the same `x402ResourceServer`: the same `PAYMENT-REQUIRED`,
/// `PAYMENT-SIGNATURE` and `PAYMENT-RESPONSE` headers, the same facilitator,
/// the same settlement hook writing the same `payments` row and the same
/// payments topic message.
///
/// The order is the authorization flow: price, verify, bind, settle. Settling
/// after the bind means a bind that reverts costs the payer nothing, and it
/// means a settlement that fails leaves a policy that is real on chain. The
/// second case cannot be undone, so it is written down loudly rather than
/// papered over: the payments row goes to `failed` and the topic gets nothing,
/// because the audit trail may not carry a payment that never happened.
///
/// The price never comes from the request. It is read from the quote row that
/// `POST /v1/quote` wrote, which is also the row `bind` re-checks, so a caller
/// cannot influence what it is charged.

export interface BindGateResult<T> {
  /** The bind's own answer, when it ran. */
  view: T | null;
  /** Set when the gate answered instead: send it and do nothing else. */
  answered: boolean;
}

export interface BindGateInput<T> {
  gate: X402Gate;
  request: FastifyRequest;
  reply: FastifyReply;
  quote: QuoteRow | null;
  /** Runs the bind. Returns the view and the policy id the payment bought. */
  run: () => Promise<{ view: T; policyId: string }>;
}

export async function payForBind<T>(input: BindGateInput<T>): Promise<BindGateResult<T>> {
  const { gate, request, reply } = input;

  // No quote, an expired one or a spent one cannot be priced, and a payment
  // taken against one would be a payment for nothing. The bind refuses all
  // three as well; refusing here means the payer never signs a transaction.
  const premium = priceable(input.quote);

  let requirements: PaymentRequirements[];
  try {
    requirements = await gate.requirements({ amount: premium });
  } catch (error) {
    request.log.error({ err: error }, 'the x402 facilitator could not be reached');
    throw new AppError(
      503,
      'upstream_unavailable',
      'Payment is unavailable',
      'The payment facilitator did not answer, so this endpoint cannot take a payment right now.',
    );
  }

  const header = request.headers['payment-signature'];
  if (typeof header !== 'string' || header === '') {
    await sendPaymentRequired(input, requirements, 'Payment required');
    return { view: null, answered: true };
  }

  let payload: PaymentPayload;
  try {
    payload = decodePaymentSignatureHeader(header);
  } catch {
    await sendPaymentRequired(input, requirements, 'invalid_payment_header');
    return { view: null, answered: true };
  }

  const matched = gate.server.findMatchingRequirements(requirements, payload);
  if (matched === undefined) {
    await sendPaymentRequired(input, requirements, 'No matching payment requirements');
    return { view: null, answered: true };
  }

  const verified = await gate.server.verifyPayment(payload, matched, undefined, context(input));
  if (!verified.isValid) {
    request.log.warn(
      { reason: verified.invalidReason, quote_id: input.quote?.quoteId },
      'the facilitator refused a payment for a bind',
    );
    await sendPaymentRequired(input, requirements, verified.invalidReason ?? 'payment_invalid');
    return { view: null, answered: true };
  }

  // The bind runs before the money moves. If it throws, nothing settles and the
  // error travels to the caller as it would without a gate.
  const { view, policyId } = await input.run();

  const settlement = await gate.server.settlePayment(payload, matched, undefined, {
    ...context(input),
    creance: { endpoint: BIND_ENDPOINT, ref: policyId, requestId: String(request.id) },
  } satisfies CreanceSettleContext);

  reply.header('PAYMENT-RESPONSE', encodePaymentResponseHeader(settlement));
  reply.header('Access-Control-Expose-Headers', 'PAYMENT-RESPONSE');
  if (!settlement.success) {
    await recordSettlementFailure(gate.sink(), {
      endpoint: BIND_ENDPOINT,
      ref: policyId,
      reason: settlement.errorReason ?? 'unknown',
      message: settlement.errorMessage,
    });
  }
  return { view, answered: false };
}

/** The premium in minor units, or the refusal the bind would have made anyway. */
function priceable(quote: QuoteRow | null): string {
  if (quote === null) {
    throw new AppError(404, 'quote_not_found', 'Quote not found', 'No quote with that id.');
  }
  if (new Date(quote.expiresAt).getTime() < Date.now()) {
    throw new AppError(
      410,
      'quote_expired',
      'Price expired',
      'That price has expired. Ask for a fresh quote.',
    );
  }
  if (quote.consumedAt !== null) {
    throw new AppError(
      409,
      'quote_consumed',
      'Quote already used',
      'That quote has already been bound.',
    );
  }
  if (BigInt(quote.premium) <= 0n) {
    throw new AppError(
      409,
      'premium_not_payable',
      'Nothing to pay',
      'That quote carries no premium, so it cannot be paid for.',
    );
  }
  return quote.premium;
}

async function sendPaymentRequired<T>(
  input: BindGateInput<T>,
  requirements: PaymentRequirements[],
  error: string,
): Promise<void> {
  const { gate, request, reply } = input;
  const paymentRequired = await gate.server.createPaymentRequiredResponse(
    requirements,
    {
      url: `${gate.config.publicBaseUrl}${request.url}`,
      description: 'Bind the quoted cover; the payment is the first month premium',
      mimeType: 'application/json',
      serviceName: 'Creance',
      tags: ['insurance', 'parametric', 'bind'],
    },
    error,
  );
  const price = {
    amount: requirements[0]?.amount ?? '0',
    display: toDisplay(requirements[0]?.amount ?? '0', gate.config.assetDecimals),
  };
  await reply
    .status(402)
    .header('PAYMENT-REQUIRED', encodePaymentRequiredHeader(paymentRequired))
    .header('Cache-Control', 'private, no-store')
    .header('Access-Control-Expose-Headers', 'PAYMENT-REQUIRED')
    .type('application/problem+json')
    .send({
      ...gate.paymentRequiredProblem(request.url, price),
      request_id: request.id,
    });
}

function context<T>(input: BindGateInput<T>): CreanceSettleContext {
  return {
    request: {
      adapter: {
        getHeader: (name: string) => headerOf(input.request, name),
        getMethod: () => input.request.method,
        getPath: () => input.request.url.split('?')[0] ?? input.request.url,
        getUrl: () => `${input.gate.config.publicBaseUrl}${input.request.url}`,
        getAcceptHeader: () => headerOf(input.request, 'accept') ?? '',
        getUserAgent: () => headerOf(input.request, 'user-agent') ?? '',
      },
      path: input.request.url.split('?')[0] ?? input.request.url,
      method: input.request.method,
    },
  };
}

function headerOf(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}
