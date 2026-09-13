import { money, type Money } from '@creance/client';
import type { FastifyPluginAsync } from 'fastify';

import {
  EthersVaultGateway,
  mapSubscribeRevert,
  type SubscriptionGateway,
} from '../chain/vault.js';
import { findAccount, findSeries, type RoleAccount, type SeriesConfig } from '../config.js';
import { AppError } from '../errors.js';
import { hashscanUrl } from '../investor/view.js';
import type { Services } from '../services.js';
import { requiredAmount, requiredString } from './quote.js';

/// POST /v1/subscribe
///
/// Put principal into a series of Displacement Bond Notes. It is the one write
/// the investor screens have, and until it existed the subscribe screen could
/// only report the position the chain already held.
///
/// On chain it is the two calls contracts/coupons/vault.ts already makes and
/// has already proven, in the same order:
///
///   1  `approve(vault, amount)` on the settlement token, from the api account,
///      where the standing allowance does not already cover the amount
///   2  `subscribe(seriesId, holder, amount)` on the vault
///
/// The api account is both halves of that: it holds SUBSCRIPTION_ROLE and the
/// vault pulls the principal from `msg.sender`, so the money comes out of the
/// API's own settlement balance and the vault records the holder named in the
/// call. That is DESIGN.md 3.8, the API paying on the investor's behalf, and it
/// is why `holder` is held to an account this deployment already speaks for:
/// paying for any address a caller cared to name would be a faucet with the api
/// account's money in it. It is a demonstration posture and not a custody
/// model, it is said plainly in the response, and a deployment with no key for
/// the api account answers 503 rather than pretending to have one.
///
/// **It adds. It does not top up to a total.** `subscribe` on the vault is
/// `_subscription[seriesId][holder] += amount`, and this route passes the
/// amount through: a holder already carrying 50,000 who subscribes 25,000 ends
/// up with 75,000. contracts/coupons/vault.ts is the other choice, and it makes
/// the other one deliberately, because it is a seeding script working towards a
/// wanted total and a second run of it must not subscribe twice. A person
/// pressing a button that says "Subscribe 25,000" means 25,000 more, so that is
/// what this does. The consequence is that the route is not idempotent: a retry
/// after a timeout subscribes again, and `subscription_before` and
/// `subscription_after` on the response are how a caller tells what it did.
///
/// Three reads come before anything is signed. An approve through the ERC-20
/// facade costs about 1.7 HBAR (docs/HEDERA.md, "Measured gas") and it is sent
/// first, so a subscription the vault was always going to refuse would cost
/// that much to learn what `eth_call` has already said. The reads are the
/// series in the vault, the holder's standing subscription, and the paying
/// account's balance.

/**
 * The most one call may move, in settlement asset minor units: 50,000.
 *
 * The route restricts who a subscription can be credited to, which stops the
 * api account's money leaving for a stranger's address. It does not stop the
 * money leaving. Without a ceiling, one anonymous request can put the whole of
 * that account's settlement balance into a series, and the balance is what
 * every other paid path on this deployment spends, so draining it takes the
 * demonstration down with it.
 *
 * 50,000 is the top of the subscribe screen's own slider, so the ceiling
 * refuses nothing a person can ask for and refuses everything larger. It is
 * deliberately not a rate limit: this is a testnet demonstration and a cap that
 * bounds the worst single call is the proportionate thing, where a limiter
 * would need state this API does not keep.
 */
export const SUBSCRIPTION_CEILING = 50_000_000_000n;

export interface SubscribeBody {
  series?: unknown;
  holder?: unknown;
  amount?: unknown;
}

export interface SubscriptionParty {
  role: string;
  /** Null for an account the day 0 record does not name, which only the payer can be. */
  account_id: string | null;
  address: string;
  hashscan: string;
}

export interface SubscriptionView {
  network: string;
  series_id: string;
  series_key: string;
  holder: SubscriptionParty;
  /**
   * The account that paid and signed. Named rather than left implicit: the
   * money left this account and not the holder's, which is the one thing about
   * a subscription on this deployment that a reader should not have to guess.
   */
  paid_by: SubscriptionParty;
  amount: Money;
  subscription_before: Money;
  subscription_after: Money;
  transactions: { approve: string | null; subscribe: string };
  gas_used: string;
  hashscan: string;
}

export interface SubscribePluginOptions {
  services: Services;
  /** The chain, or a fake in a test. Built from the configuration by default. */
  vault?: SubscriptionGateway;
}

export const subscribeRoutes: FastifyPluginAsync<SubscribePluginOptions> = async (app, options) => {
  const { services } = options;
  const vault =
    options.vault ??
    new EthersVaultGateway(
      services.config.vaultAddress,
      services.config.settlementToken.address,
      services.config.rpcUrl,
      services.config.chainId,
      services.config.api.key,
    );

  app.post<{ Body: SubscribeBody }>('/v1/subscribe', async (request, reply) => {
    const view = await subscribe(services, vault, request.body ?? {});
    return reply.status(201).send(view);
  });
};

export async function subscribe(
  services: Services,
  vault: SubscriptionGateway,
  body: SubscribeBody,
): Promise<SubscriptionView> {
  const series = seriesOr404(services, requiredString(body.series, 'series'));
  const holder = holderOr400(services, requiredString(body.holder, 'holder'));
  const amount = requiredAmount(body.amount, 'amount');
  if (amount <= 0n) {
    throw new AppError(
      400,
      'amount_invalid',
      'Amount refused',
      'A subscription is more than nought, in the settlement asset minor units.',
    );
  }
  if (amount > SUBSCRIPTION_CEILING) {
    throw new AppError(
      400,
      'amount_above_ceiling',
      'Amount refused',
      `One subscription moves at most ${SUBSCRIPTION_CEILING.toString()} and this one is ${amount.toString()}.`,
    );
  }
  if (!vault.canSign) {
    throw new AppError(
      503,
      'subscription_writes_unavailable',
      'Subscribing is not available here',
      'This deployment reads the series but holds no key for the account that pays for a subscription, so it cannot send one.',
    );
  }

  const [terms, before, balance] = await Promise.all([
    vault.seriesTerms(series.seriesId),
    vault.subscriptionOf(series.seriesId, holder.address),
    vault.settlementBalanceOf(vault.payer ?? services.config.api.address),
  ]);
  // A series the vault never opened reads back as a zeroed struct rather than a
  // revert, so a zero maturity is how "this series is in the record but not in
  // this vault" is told from "this series has no principal yet".
  if (terms.maturityAt === 0) {
    throw new AppError(
      404,
      'series_not_open',
      'Series not open',
      'The vault has no series with that key, so there is nothing to subscribe to.',
    );
  }
  if (terms.maturityAt <= Math.floor(Date.now() / 1000)) {
    throw new AppError(
      409,
      'series_matured',
      'Series matured',
      'That series has reached maturity, so it takes no further subscriptions.',
    );
  }
  if (balance < amount) {
    throw new AppError(
      409,
      'settlement_balance_short',
      'Subscription refused',
      `The account that pays for a subscription holds ${balance.toString()} and this one is ${amount.toString()}. Nothing was sent.`,
    );
  }

  let written;
  try {
    written = await vault.subscribe(series.seriesId, holder.address, amount);
  } catch (error) {
    throw mapSubscribeRevert(error);
  }
  // Read back rather than added up. The figure on the response is the vault's
  // own, so a subscription that landed for a different amount than it asked for
  // is visible instead of being papered over by arithmetic on this side.
  const after = await vault.subscriptionOf(series.seriesId, holder.address);

  const asset = services.config.settlementToken;
  const inAsset = (value: bigint): Money => money(value.toString(), asset.tokenId, asset.decimals);
  // The payer is looked up rather than assumed to be the configured api
  // account: `HEDERA_API_KEY` can name a different key, and a response that
  // reported one account's id beside another account's address would be wrong
  // in the one field somebody would check it by.
  const payerAddress = vault.payer ?? services.config.api.address;
  const payer = findAccount(services.config, payerAddress);
  return {
    network: services.config.network,
    series_id: series.label,
    series_key: series.seriesId,
    holder: party(holder, services.config.network),
    paid_by:
      payer === undefined
        ? {
            role: 'api',
            account_id: null,
            address: payerAddress,
            hashscan: hashscanUrl('account', payerAddress, services.config.network),
          }
        : party(payer, services.config.network),
    amount: inAsset(amount),
    subscription_before: inAsset(before),
    subscription_after: inAsset(after),
    transactions: { approve: written.approveTx, subscribe: written.subscribeTx },
    gas_used: written.gasUsed,
    hashscan: hashscanUrl('transaction', written.subscribeTx, services.config.network),
  };
}

function party(account: RoleAccount, network: string): SubscriptionParty {
  return {
    role: account.role,
    account_id: account.accountId,
    address: account.address,
    hashscan: hashscanUrl('account', account.accountId, network),
  };
}

function seriesOr404(services: Services, id: string): SeriesConfig {
  const series = findSeries(services.config, id);
  if (series === undefined) {
    throw new AppError(
      404,
      'series_not_found',
      'Series not found',
      'No series with that id is deployed on this network.',
    );
  }
  return series;
}

function holderOr400(services: Services, id: string): RoleAccount {
  const holder = findAccount(services.config, id);
  if (holder === undefined) {
    throw new AppError(
      400,
      'holder_unknown',
      'Subscription refused',
      `This deployment cannot subscribe for "${id}". It pays for the accounts in its own record and for no others.`,
    );
  }
  return holder;
}
