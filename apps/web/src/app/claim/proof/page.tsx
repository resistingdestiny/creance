import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { readClaim } from '../../../lib/claim-session';
import { ProofScreen } from './proof-screen';

/**
 * C3, Add proof.
 *
 * The files live in the claim session between here and C5, so what this route
 * hands the screen is the names and the sizes of what has already been added,
 * and never the bytes.
 */

export const metadata: Metadata = { title: 'Add proof' };

export const dynamic = 'force-dynamic';

export default async function ProofPage() {
  const session = await readClaim();
  if (session?.policyId == null) redirect('/home');
  if (session.separationType === null) redirect('/claim/job');

  return (
    <ProofScreen
      files={session.evidence.map((file) => ({ name: file.filename, bytes: file.bytes }))}
    />
  );
}
