import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { AMOUNT_DEFAULT } from '../../components/amount-slider';
import { occupationLabel } from '../../lib/occupations';
import { readPurchase, updatePurchase } from '../../lib/purchase-session';
import { DEMO_ACCOUNT, DEMO_WALLET_LABEL } from '../../lib/wallet';
import { requestQuote, toMinorUnits } from '../../lib/worker-api';
import { coverAmount, premiumAmount } from '../../lib/worker-model';
import { PayScreen } from './pay-screen';
import { WorkerUnavailable } from '../unavailable';

/**
 * The Pay sheet, docs/DESIGN-TOKENS.md section 8.
 *
 * It is a route and not only a sheet. The person is about to make a payment and
 * may be bounced to a wallet, and coming back to a page whose sheet has closed
 * and whose quote has expired is the worst moment in the flow to lose state.
 *
 * The quote is taken fresh on entry, because the figure on the button is the
 * figure that will be bound and a quote lasts fifteen minutes.
 */

export const metadata: Metadata = { title: 'Confirm your cover' };

export const dynamic = 'force-dynamic';

export default async function PayPage() {
  const session = await readPurchase();
  if (!session?.group) redirect('/occupation');
  if (session.credential === null) redirect('/verify');

  const group = session.group;
  const limit = session.limit ?? AMOUNT_DEFAULT;
  try {
    const quote = await requestQuote({
      group,
      limit: toMinorUnits(limit),
      wallet: DEMO_ACCOUNT.accountId,
    });
    await updatePurchase({ quoteId: quote.quote_id, premiumMinorUnits: quote.premium.amount });
    return (
      <PayScreen
        cover={coverAmount(quote.limit)}
        occupation={occupationLabel(group)}
        paysFrom={quote.pays_from}
        premium={premiumAmount(quote.premium)}
        walletLabel={DEMO_WALLET_LABEL}
      />
    );
  } catch {
    return <WorkerUnavailable retryHref="/pay" />;
  }
}
