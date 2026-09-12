import type { Metadata } from 'next';

import { readFundedBands } from '../../lib/cover-availability';
import { OCCUPATIONS } from '../../lib/occupations';
import { readPurchase } from '../../lib/purchase-session';
import { OccupationPicker } from './occupation-picker';

/**
 * The occupation picker, docs/DESIGN-TOKENS-ADDENDUM.md "Occupation picker
 * correction": fifteen rows in that order, no armed forces row, no section
 * headers, detailed groups rendering exactly like the majors.
 *
 * The rows are static, so this route only reads which one is already chosen and
 * which experience bands capital has actually funded behind each of them. The
 * second is not a constant and cannot be: capital commits to an occupation and
 * a band together, and whether it has done so is a fact about real
 * subscriptions. It is a held read, and a failed one leaves the list as it was
 * rather than emptying it. See src/lib/cover-availability.ts.
 */

export const metadata: Metadata = {
  title: 'What do you do?',
  description:
    'Pick your occupation from the fifteen groups the index follows. The quote comes from that group and nothing else.',
  alternates: { canonical: '/occupation' },
};

export const dynamic = 'force-dynamic';

export default async function OccupationPage() {
  const [session, funded] = await Promise.all([readPurchase(), readFundedBands()]);
  return (
    <OccupationPicker chosen={session?.group ?? null} funded={funded} rows={OCCUPATIONS} />
  );
}
