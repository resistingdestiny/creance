import type { FastifyPluginAsync, FastifyRequest } from 'fastify';

import { findSeries } from '../config.js';
import type { PaymentRow, PolicyRow } from '../db/types.js';
import { AppError } from '../errors.js';
import { newId, nullifierToBytes32, toBytes32 } from '../ids.js';
import { mapRevert } from '../chain/cover-pool.js';
import {
  encodeTopicMessage,
  policyBindingMessage,
  policyBoundMessage,
} from '../receipts.js';
import type { Services } from '../services.js';
import { buildPolicyView, calendarDate, type PolicyView } from '../views.js';
import { seriesRowFrom } from '../series.js';
import { requiredString } from './quote.js';

/// POST /v1/bind
///
/// The whole body is a quote id. Everything else comes from the quote and from
/// the eligibility credential, server side: this endpoint never accepts an
/// amount, a wallet or a limit, because a request that can influence its own
/// price is not a price.
///
/// The order of the writes is the load-bearing part.
///
///   1  the quote and the credential are checked against each other
///   2  one database transaction takes the one-active-policy rule, consumes the
///      credential and the quote, checks the capacity and writes the policy at
///      status `binding` with an uncollected first premium
///   3  the HCS receipt is published, because `CoverPool.bind` takes its
///      sequence number as an input and so it has to exist first
///   4  `CoverPool.bind` runs; a revert maps to a caller-facing code and the
///      policy goes to `void` with a second receipt saying so
///   5  the policy NFT is minted to the holder, transferred and frozen
///   6  the policy reaches `bound` and a second receipt records the outcome
///
/// Step 3 before step 4 is forced by the contract. It means a receipt can be
/// orphaned by a revert, which is why there is a second message rather than
/// one: a reader takes the second as the outcome. See docs/DECISIONS.md.
///
/// There is no payment gate here yet. T08 adds it, and the payments row this
/// writes at `uncollected` with a null facilitator transaction is the row it
/// will settle.

export interface BindBody {
  quote_id?: unknown;
  eligibility?: unknown;
}

export const bindRoutes: FastifyPluginAsync<{ services: Services }> = async (app, options) => {
  const { services } = options;

  app.post<{ Body: BindBody }>('/v1/bind', async (request, reply) => {
    const view = await bind(services, request.body ?? {}, request);
    return reply.status(201).send(view);
  });
};

export async function bind(
  services: Services,
  body: BindBody,
  request: Pick<FastifyRequest, 'headers' | 'id'>,
): Promise<PolicyView> {
  const quoteId = requiredString(body.quote_id, 'quote_id');
  const token = credentialToken(body, request);
  const credential = await services.issuer.verify(token);

  const quote = await services.repository.quote(quoteId);
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

  // The credential is bound to the principal's wallet and the NFT is minted to
  // that wallet, never an agent's (DESIGN.md 3.6). So a disagreement between
  // the quote and the credential is refused rather than silently resolved in
  // favour of one of them.
  if (credential.wallet !== quote.wallet) {
    throw conflict('wallet_mismatch', 'Wallet mismatch', 'The quote and the check name different wallets.');
  }
  if (credential.group !== quote.groupKey) {
    throw conflict('group_mismatch', 'Occupation mismatch', 'The quote and the check name different occupations.');
  }
  if (credential.series_id !== quote.seriesId) {
    throw conflict('series_mismatch', 'Series mismatch', 'The quote and the check name different series.');
  }

  const stored = await services.repository.credential(credential.jti);
  if (stored === null) {
    throw new AppError(
      401,
      'credential_unknown',
      'Credential unknown',
      'This API did not issue that credential.',
    );
  }

  const seriesConfig = findSeries(services.config, quote.seriesId);
  if (seriesConfig === undefined) {
    throw new AppError(404, 'series_not_found', 'Series not found', 'That series is not deployed.');
  }
  const state = await services.chain.seriesState(seriesConfig.seriesId);
  if (state.status !== 'active' && state.status !== 'claims_open') {
    throw conflict(
      'series_not_open_for_binding',
      'Series not open',
      'That series is not taking new cover.',
    );
  }
  await services.repository.upsertSeries(seriesRowFrom(seriesConfig, state, services.config));

  const now = new Date();
  const limit = BigInt(quote.coverLimit);
  const premium = BigInt(quote.premium);
  const startAt = Math.floor(now.getTime() / 1000);
  const policyId = newId('policy', now.getTime());
  const endsAt = new Date((startAt + state.termSeconds) * 1000);
  const claimsPayableFrom = new Date((startAt + state.waitingPeriodSeconds) * 1000);

  const policy: PolicyRow = {
    policyId,
    seriesId: quote.seriesId,
    groupKey: quote.groupKey,
    nullifier: credential.nullifier,
    wallet: credential.wallet,
    walletEvm: credential.wallet_evm,
    coverLimit: quote.coverLimit,
    premium: quote.premium,
    asset: quote.asset,
    assetDecimals: quote.assetDecimals,
    status: 'binding',
    quoteId: quote.quoteId,
    credentialJti: credential.jti,
    startsAt: now.toISOString(),
    endsAt: endsAt.toISOString(),
    claimsPayableFrom: calendarDate(claimsPayableFrom),
    paidThrough: periodOf(now),
    nextDue: calendarDate(addOneMonth(now)),
    nftTokenId: null,
    nftSerial: null,
    hcsTopic: null,
    hcsReceiptSeq: null,
    bindTxId: null,
  };

  const payment: PaymentRow = {
    paymentId: newId('payment', now.getTime()),
    endpoint: 'POST /v1/bind',
    payer: credential.wallet,
    payTo: services.config.api.accountId,
    amount: quote.premium,
    asset: quote.asset,
    assetDecimals: quote.assetDecimals,
    facilitator: null,
    // No x402 gate in this ticket, so the first premium is recorded as owed
    // rather than paid. T08 settles this row rather than adding another.
    facilitatorTx: null,
    chainTxId: null,
    status: 'uncollected',
    ref: policyId,
    settledAt: null,
    hcsTopic: null,
    hcsSeq: null,
    requestId: String(request.id ?? 'unknown'),
  };

  await services.repository.upsertUser({
    nullifier: credential.nullifier,
    groupKey: credential.group,
    wallet: credential.wallet,
    walletEvm: credential.wallet_evm,
  });

  await services.repository.reservePolicy({
    policy,
    credentialJti: credential.jti,
    quoteId: quote.quoteId,
    activeExposure: state.activeExposure.toString(),
    principalRemaining: state.principalRemaining.toString(),
    payment,
  });

  const hedera = services.hedera;
  if (hedera === null) {
    await services.repository.updatePolicy(policyId, { status: 'void' });
    throw new AppError(
      503,
      'hedera_not_configured',
      'Binding is not configured',
      'This API has no Hedera keys, so it cannot publish a receipt or mint a policy receipt.',
    );
  }

  const receipt = await hedera.publish(
    services.config.paymentsTopicId,
    encodeTopicMessage(
      policyBindingMessage({
        seriesLabel: quote.seriesId,
        seriesKey: seriesConfig.seriesId,
        policyId,
        groupKey: quote.groupKey,
        holderAccountId: credential.wallet,
        holderAddress: credential.wallet_evm,
        limit,
        premium,
        tokenId: quote.asset,
        startAt: now,
        quotedAt: new Date(quote.expiresAt),
      }),
    ),
  );
  await services.repository.updatePayment(payment.paymentId, {
    hcsTopic: receipt.topicId,
    hcsSeq: receipt.sequenceNumber,
  });
  await services.repository.updatePolicy(policyId, {
    hcsTopic: receipt.topicId,
    hcsReceiptSeq: receipt.sequenceNumber,
  });

  let bindTx;
  try {
    bindTx = await services.chain.bind({
      policyId: toBytes32(policyId),
      seriesId: seriesConfig.seriesId,
      holder: credential.wallet_evm,
      nullifierHash: nullifierToBytes32(credential.nullifier),
      limit,
      premium,
      startAt,
      hcsReceiptSeq: receipt.sequenceNumber,
    });
  } catch (error) {
    const mapped = mapRevert(error);
    await services.repository.updatePolicy(policyId, { status: 'void' });
    // The receipt is already on the topic and cannot be withdrawn, so it is
    // resolved rather than left to be read as a policy that exists.
    await hedera.publish(
      services.config.paymentsTopicId,
      encodeTopicMessage(
        policyBoundMessage({
          seriesLabel: quote.seriesId,
          policyId,
          receiptSeq: receipt.sequenceNumber,
          reason: mapped.code,
        }),
      ),
    );
    throw mapped;
  }
  await services.repository.updatePolicy(policyId, {
    status: 'bound',
    bindTxId: bindTx.transactionHash,
  });

  // The receipt is minted after the chain write, not before: an NFT in a
  // stranger's wallet for cover the pool refused is worse than a slow receipt.
  const nft = await hedera.mintPolicyNft(
    credential.wallet,
    nftMetadata(policyId, quote.seriesId),
  );
  await services.repository.updatePolicy(policyId, {
    nftTokenId: nft.tokenId,
    nftSerial: nft.serial,
  });

  await hedera.publish(
    services.config.paymentsTopicId,
    encodeTopicMessage(
      policyBoundMessage({
        seriesLabel: quote.seriesId,
        policyId,
        receiptSeq: receipt.sequenceNumber,
        bindTx: bindTx.transactionHash,
        nftTokenId: nft.tokenId,
        serial: nft.serial,
      }),
    ),
  );

  const bound = await services.repository.policy(policyId);
  if (bound === null) throw new Error(`the policy ${policyId} vanished between writes`);
  return buildPolicyView(bound, services.config.coverPoolAddress);
}

/**
 * The credential arrives as a bearer token or as a body field, and both have to
 * work: the web app and a plain HTTP Steward call use the header, and some
 * x402 client wrappers own it. The header wins; two that disagree is a 400,
 * because guessing which the caller meant is how a bind ends up on the wrong
 * wallet.
 */
export function credentialToken(
  body: BindBody,
  request: Pick<FastifyRequest, 'headers'>,
): string {
  const header = request.headers.authorization;
  const fromHeader =
    typeof header === 'string' && /^Bearer\s+/i.test(header)
      ? header.replace(/^Bearer\s+/i, '').trim()
      : null;
  const fromBody = typeof body.eligibility === 'string' ? body.eligibility.trim() : null;
  if (fromHeader !== null && fromBody !== null && fromHeader !== fromBody) {
    throw new AppError(
      400,
      'credential_ambiguous',
      'Two different checks',
      'The header and the body carry different eligibility credentials.',
    );
  }
  const token = fromHeader ?? fromBody;
  if (token === null || token === '') {
    throw new AppError(
      401,
      'credential_missing',
      'Check required',
      'A bind needs an eligibility credential, as a bearer token or in the body.',
    );
  }
  return token;
}

/**
 * The NFT metadata, capped at 100 bytes, measured in bytes and not characters
 * (docs/HEDERA.md, day 0 findings). The policy id is 30 bytes and the series
 * label 16, so the JSON below is 60 and has room to spare.
 */
export function nftMetadata(policyId: string, seriesLabel: string): string {
  return JSON.stringify({ p: policyId, s: seriesLabel });
}

function conflict(code: string, title: string, detail: string): AppError {
  return new AppError(409, code, title, detail);
}

/** The month a policy starts in, as the YYYYMM the schema and the chain take. */
export function periodOf(at: Date): number {
  return at.getUTCFullYear() * 100 + at.getUTCMonth() + 1;
}

/** The same day next month, clamped to the length of the shorter month. */
export function addOneMonth(at: Date): Date {
  const next = new Date(
    Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1, 0, 0, 0),
  );
  const lastDay = new Date(
    Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0),
  ).getUTCDate();
  next.setUTCDate(Math.min(at.getUTCDate(), lastDay));
  return next;
}
