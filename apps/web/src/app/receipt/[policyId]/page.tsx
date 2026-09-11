import type { Metadata } from 'next';

import { AppFrame } from '../../../components/app-frame';
import { PillLink } from '../../../components/pill-button';
import { fetchAuditTrail } from '../../../lib/audit-api';
import { ReceiptScreen } from './receipt-screen';

/**
 * /receipt/:policyId
 *
 * The receipt for one cover, read from the API's audit endpoint on the server.
 * The entries are live: a payment reaches the topic seconds after it settles,
 * so there is nothing here to prerender.
 */

export const metadata: Metadata = { title: 'Receipt' };

export const dynamic = 'force-dynamic';

export default async function ReceiptPage({
  params,
}: {
  params: Promise<{ policyId: string }>;
}) {
  const { policyId } = await params;
  try {
    return <ReceiptScreen trail={await fetchAuditTrail(policyId)} />;
  } catch {
    return <ReceiptUnavailable policyId={policyId} />;
  }
}

/** No apology, what happened, and what to do next. The sheet's error rule. */
function ReceiptUnavailable({ policyId }: { policyId: string }) {
  return (
    <AppFrame>
      <main className="flex min-h-frame flex-col justify-between px-5 py-10">
        <div className="flex flex-col gap-4">
          <h1 className="text-headline font-display font-semibold tracking-headline text-ink">
            We couldn&apos;t load this receipt.
          </h1>
          <p className="text-body-lg text-ink-2">
            The payments are still recorded on Hedera. Try again in a moment.
          </p>
        </div>
        <PillLink href={`/receipt/${encodeURIComponent(policyId)}`}>Try again</PillLink>
      </main>
    </AppFrame>
  );
}
