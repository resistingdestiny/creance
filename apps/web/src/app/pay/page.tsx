import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { readPurchase } from '../../lib/purchase-session';
import { openPayment } from '../purchase-actions';
import { PayScreen } from './pay-screen';
import { WorkerUnavailable } from '../unavailable';

/**
 * The Pay sheet, docs/DESIGN-TOKENS.md section 8.
 *
 * It is a route and not only a sheet. The person is about to make a payment and
 * may be bounced to a wallet, and coming back to a page whose sheet has closed
 * and whose quote has expired is the worst moment in the flow to lose state.
 * T37 puts the same step on the landing card as well; this route is unchanged
 * and still resumes a purchase begun there.
 *
 * The quote is taken fresh on entry, because the figure on the button is the
 * figure that will be bound and a quote lasts fifteen minutes. `openPayment` is
 * that read, shared with the landing page so there is one of it.
 */

export const metadata: Metadata = { title: 'Confirm your cover' };

export const dynamic = 'force-dynamic';

export default async function PayPage() {
  const session = await readPurchase();
  if (!session?.group) redirect('/occupation');
  if (session.credential === null) redirect('/verify');

  const confirmation = await openPayment();
  if (confirmation === null) return <WorkerUnavailable retryHref="/pay" />;

  return (
    <PayScreen
      cover={confirmation.cover}
      occupation={confirmation.occupation}
      paysFrom={confirmation.paysFrom}
      premium={confirmation.premium}
      walletLabel={confirmation.walletLabel}
    />
  );
}
