import type { Metadata } from 'next';

import { OCCUPATIONS } from '../../lib/occupations';
import { readPurchase } from '../../lib/purchase-session';
import { OccupationPicker } from './occupation-picker';

/**
 * The occupation picker, docs/DESIGN-TOKENS-ADDENDUM.md "Occupation picker
 * correction": fifteen rows in that order, no armed forces row, no section
 * headers, detailed groups rendering exactly like the majors.
 *
 * The rows are static, so this route only reads which one is already chosen.
 */

export const metadata: Metadata = {
  title: 'What do you do?',
  description:
    'Pick your occupation from the fifteen groups the index follows. The quote comes from that group and nothing else.',
  alternates: { canonical: '/occupation' },
};

export const dynamic = 'force-dynamic';

export default async function OccupationPage() {
  const session = await readPurchase();
  return <OccupationPicker chosen={session?.group ?? null} rows={OCCUPATIONS} />;
}
