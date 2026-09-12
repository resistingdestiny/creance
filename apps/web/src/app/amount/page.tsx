import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { reportUnreachable } from '../../lib/api';

import { bandLabel } from '../../lib/bands';
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
 *
 * The line under the heading names the occupation and the experience band,
 * because both went into the price: the occupation decided the risk that was
 * measured and the band decided which capital it is written against. It is one
 * line rather than a sentence, because the screen that asked the question
 * already said what the answer changes and what it does not.
 */

export const metadata: Metadata = { title: 'Cover amount' };

export const dynamic = 'force-dynamic';

export default async function AmountPage() {
  const session = await readPurchase();
  const group = session?.group;
  if (!group) redirect('/occupation');
  if (!session?.band) redirect('/experience');

  const limit = session?.limit ?? AMOUNT_DEFAULT;
  try {
    const quote = await requestQuote({
      group,
      limit: toMinorUnits(limit),
      // The wallet the cover binds to, which is the demo one until somebody
      // connects their own at the payment step.
      wallet: (session?.wallet ?? DEMO_ACCOUNT).accountId,
      band: session.band,
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
        occupation={`${occupationLabel(group)}, ${bandLabel(session.band)}`}
      />
    );
  } catch (cause) {
    reportUnreachable('the cover amount screen', cause);
    return <WorkerUnavailable retryHref="/amount" />;
  }
}
