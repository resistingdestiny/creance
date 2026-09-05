import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { reportUnreachable } from '../../lib/api';

import { AMOUNT_DEFAULT } from '../../lib/cover-amount';
import { readPurchase } from '../../lib/purchase-session';
import { occupationLabel } from '../../lib/occupations';
import { DEMO_ACCOUNT } from '../../lib/wallet';
import { requestQuote, toMinorUnits } from '../../lib/worker-api';
import { coverAmount, paysOutSentence, premiumAmount } from '../../lib/worker-model';
import { AmountScreen } from './amount-screen';
import { WorkerUnavailable } from '../unavailable';

/**
 * Cover amount, docs/DESIGN-TOKENS.md section 8.
 *
 * The price is a real quote rather than an estimate: a quote takes no capacity
 * hold and expires in fifteen minutes, so pricing the slider is the same call
 * the Pay sheet makes and the figure on screen is a binding price.
 */

export const metadata: Metadata = { title: 'Cover amount' };

export const dynamic = 'force-dynamic';

export default async function AmountPage() {
  const session = await readPurchase();
  const group = session?.group;
  if (!group) redirect('/occupation');

  const limit = session?.limit ?? AMOUNT_DEFAULT;
  try {
    const quote = await requestQuote({
      group,
      limit: toMinorUnits(limit),
      wallet: DEMO_ACCOUNT.accountId,
    });
    return (
      <AmountScreen
        initial={{
          limit: coverAmount(quote.limit),
          premium: premiumAmount(quote.premium),
          sentence: paysOutSentence(quote),
          usedPercent: quote.capacity.used_pct,
          full: false,
          error: null,
        }}
        limit={limit}
        occupation={occupationLabel(group)}
      />
    );
  } catch (cause) {
    reportUnreachable('the cover amount screen', cause);
    return <WorkerUnavailable retryHref="/amount" />;
  }
}
