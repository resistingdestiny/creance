import type { Contract } from 'ethers';

import { send } from '../ats/chain.js';
import { GAS } from './config.js';
import type { CouponContext, Party } from './context.js';
import type { SubscriptionRecord } from './record.js';

/// Vault moves both the coupon settlement and the maturity demonstration need.

/**
 * Subscribe one noteholder into a vault series.
 *
 * `subscribe` pulls the settlement token from `msg.sender`, which is the api
 * account holding SUBSCRIPTION_ROLE, and credits the holder named in the call.
 * That is the shape DESIGN.md 3.8 describes, the API paying on the investor's
 * behalf after the ATS mint, so the investor sends its principal to the api
 * account first and the vault records the investor as the subscriber.
 *
 * Idempotent against the chain rather than against the record: a holder already
 * carrying the wanted subscription is left alone.
 */
export async function subscribeInvestor(
  context: CouponContext,
  seriesId: string,
  investor: Party,
  wanted: bigint,
): Promise<SubscriptionRecord | null> {
  const already = (await context.vault.getFunction('subscriptionOf')(
    seriesId,
    investor.address,
  )) as bigint;
  if (already >= wanted) {
    console.log(`  ${investor.role} already subscribed ${already}`);
    return null;
  }
  const amount = wanted - already;
  // Only the shortfall moves. A run that sent the principal and then failed on
  // the approve or the subscribe would otherwise send it a second time, and the
  // investor would be out the difference with the vault none the wiser.
  const held = await tokenBalanceOf(context, context.api.address);
  const short = amount > held ? amount - held : 0n;
  const fund =
    short === 0n
      ? undefined
      : await send(
          `${investor.role} sends its principal to the api account`,
          (context.token.connect(investor.wallet) as Contract).getFunction('transfer')(
            context.api.address,
            short,
            { gasLimit: GAS.transfer },
          ),
        );
  const approve = await send(
    'approve the vault',
    (context.token.connect(context.api.wallet) as Contract).getFunction('approve')(
      context.vault.target as string,
      amount,
      { gasLimit: GAS.approve },
    ),
  );
  const subscribed = await send(
    `subscribe ${investor.role}`,
    context.vault.getFunction('subscribe')(seriesId, investor.address, amount, {
      gasLimit: GAS.subscribe,
    }),
  );
  return {
    role: investor.role,
    accountId: investor.accountId,
    address: investor.address,
    amount: wanted.toString(),
    ...(fund === undefined ? {} : { fundTx: fund.hash }),
    approveTx: approve.hash,
    subscribeTx: subscribed.hash,
    gasUsed: subscribed.gasUsed,
  };
}

/// Enough HBAR to pay for a call at the relay's gas price. ethers reserves
/// twice the base fee times the gas limit before it will send, so an account
/// with a 2,000,000 gas call ahead of it needs about five HBAR free even though
/// the call itself costs a fraction of that.
const HBAR_TARGET = 12n * 10n ** 18n;

/**
 * Top the accounts that send their own transactions up to twelve HBAR.
 *
 * The stand-in premium payer and both noteholders sign their own transfers, and
 * the api account pays for the coupon schedules, each of which costs about 1.3
 * HBAR because it carries a contract call. An account cannot send a call at all
 * unless it holds twice the gas limit times the base fee, whatever the call
 * ends up costing.
 */
export async function fundAccounts(context: CouponContext): Promise<void> {
  for (const party of [context.policyholder, ...context.investors, context.api]) {
    const held = await context.provider.getBalance(party.address);
    if (held >= HBAR_TARGET) {
      console.log(`  ${party.role} holds ${held / 10n ** 18n} HBAR, enough`);
      continue;
    }
    const tx = await context.operator.wallet.sendTransaction({
      to: party.address,
      value: HBAR_TARGET - held,
      gasLimit: 500_000,
    });
    await tx.wait();
    console.log(`  topped ${party.role} up to 12 HBAR in ${tx.hash}`);
  }
}

/** The settlement token balance of an account, through the ERC-20 facade. */
export async function tokenBalanceOf(context: CouponContext, address: string): Promise<bigint> {
  return (await context.token.getFunction('balanceOf')(address)) as bigint;
}
