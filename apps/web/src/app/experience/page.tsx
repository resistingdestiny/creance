import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { reportUnreachable } from '../../lib/api';
import { BAND_QUESTION } from '../../lib/bands';
import { AMOUNT_DEFAULT } from '../../lib/cover-amount';
import { occupationLabel } from '../../lib/occupations';
import { readPurchase } from '../../lib/purchase-session';
import { fetchBands, toMinorUnits } from '../../lib/worker-api';
import { premiumAmount } from '../../lib/worker-model';
import { WorkerUnavailable } from '../unavailable';
import { ExperienceScreen, type BandChoice } from './experience-screen';

/**
 * The experience question, between the occupation and the amount.
 *
 * Every figure on it is read live from GET /v1/cover/bands, because every
 * figure on it is about what real capital has done: what is behind each band is
 * the sum of real subscriptions to that band, and what each band costs falls
 * out of that in exactly the way the price has always moved with utilisation.
 * There is no table of band multipliers anywhere in this product, and a band
 * with nothing behind it has no price rather than a default one.
 *
 * The premium shown is for the default cover amount, which is what the amount
 * screen opens on. Moving the slider re-prices against the same band.
 */

export const metadata: Metadata = {
  title: BAND_QUESTION,
  description:
    'Cover is sold in three bands of experience. The band changes the price, because it changes which capital the cover is written against. It changes nothing about when the cover pays.',
  alternates: { canonical: '/experience' },
};

export const dynamic = 'force-dynamic';

export default async function ExperiencePage() {
  const session = await readPurchase();
  const group = session?.group;
  if (!group) redirect('/occupation');

  try {
    const view = await fetchBands(group, toMinorUnits(session?.limit ?? AMOUNT_DEFAULT));
    const bands: BandChoice[] = view.bands.map((row) => ({
      band: row.band,
      label: row.label,
      available: row.available,
      reason: row.reason,
      premium: row.premium === null ? null : premiumAmount(row.premium),
    }));
    return (
      <ExperienceScreen
        bands={bands}
        chosen={session?.band ?? null}
        occupation={occupationLabel(group)}
      />
    );
  } catch (cause) {
    reportUnreachable('the experience screen', cause);
    return <WorkerUnavailable retryHref="/experience" />;
  }
}
