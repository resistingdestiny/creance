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
  const fund = await send(
    `${investor.role} sends its principal to the api account`,
    (context.token.connect(investor.wallet) as Contract).getFunction('transfer')(
      context.api.address,
      amount,
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
    fundTx: fund.hash,
    approveTx: approve.hash,
    subscribeTx: subscribed.hash,
    gasUsed: subscribed.gasUsed,
  };
}

/** The settlement token balance of an account, through the ERC-20 facade. */
export async function tokenBalanceOf(context: CouponContext, address: string): Promise<bigint> {
  return (await context.token.getFunction('balanceOf')(address)) as bigint;
}
