'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { AppFrame } from '../../components/app-frame';
import { BottomSheet } from '../../components/bottom-sheet';
import { ListRow } from '../../components/list-row';
import { PillButton } from '../../components/pill-button';
import { SurfaceGroup } from '../../components/surface-group';
import { FailureBody } from '../../components/toast';
import { purchaseFailedCopy } from '../../lib/claim-model';
import { payAndBind } from '../purchase-actions';

/**
 * "Confirm your cover", its five rows and "Pay {premium}", verbatim from
 * docs/DESIGN-TOKENS.md section 8. The button names the outcome, so the number
 * on it is the premium.
 *
 * "Pays from" is the Hedera account id the quote returns, not a shortened EVM
 * address. The two name the same account; the account id is what the receipt,
 * the policy NFT and HashScan all say, and shortening it would invent a format
 * for a string that is already eleven characters. See docs/DECISIONS.md.
 *
 * The line above the button says what the press does. The first month's premium
 * is settled out of the wallet named in the "Pays from" row, over the x402 gate
 * T08 put in front of the bind, and the cover is real from that moment. It is
 * said before the press rather than after it, which is the same rule the
 * subscribe screen follows.
 *
 * A payment that does not go through opens the Payment failed sheet, which is
 * the deck's own state for it: the title verbatim, the amount interpolated, and
 * one sentence saying what happened and what to do next. Its second sentence in
 * the deck is written for a lapsed cover that is unchanged until its due date,
 * and there is no cover yet at this point in the flow, so the sentence here is
 * the one the API's own problem document justifies. See docs/DECISIONS.md.
 */

export function PayScreen({
  cover,
  occupation,
  premium,
  paysFrom,
  walletLabel,
}: {
  cover: string;
  occupation: string;
  premium: string;
  paysFrom: string;
  walletLabel: string | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const confirm = () => {
    setError(null);
    startTransition(async () => {
      const result = await payAndBind();
      if (result.ok) router.push('/home?bound=1');
      else setError(result.error);
    });
  };

  return (
    <AppFrame>
      <main className="relative flex min-h-dvh flex-col gap-2 px-5 py-10">
        <h1 className="text-title font-display font-semibold tracking-title text-ink">
          Cover amount
        </h1>
        <p className="text-display-l font-display font-semibold tracking-display tabular-nums text-ink">
          {premium} a month
        </p>

        <BottomSheet inline onClose={() => router.push('/amount')} open title="Confirm your cover">
          <div className="flex flex-col gap-5">
            <SurfaceGroup>
              <ListRow label="Cover" value={cover} />
              <ListRow label="Occupation" value={occupation} />
              <ListRow label="Monthly payment" value={premium} />
              <ListRow label="First payment today" value={premium} />
              <ListRow
                caption={walletLabel}
                label="Pays from"
                value={<span className="tabular-nums">{paysFrom}</span>}
              />
            </SurfaceGroup>

            <p className="text-secondary text-ink-2">
              Testnet only. The first payment leaves the wallet above as soon as you press.
            </p>

            {error === null ? (
              <PillButton className="w-full" loading={pending} onClick={confirm}>
                {`Pay ${premium}`}
              </PillButton>
            ) : (
              <div data-testid="payment-failed">
                <FailureBody {...purchaseFailedCopy(premium, error)} onAction={confirm} />
              </div>
            )}
          </div>
        </BottomSheet>
      </main>
    </AppFrame>
  );
}
