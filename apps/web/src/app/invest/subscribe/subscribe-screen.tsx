'use client';

import { useState } from 'react';

import { AmountSlider } from '../../../components/amount-slider';
import { BottomSheet } from '../../../components/bottom-sheet';
import { DesktopFrame } from '../../../components/desktop-frame';
import { DisplayNumber } from '../../../components/display-number';
import { ListRow } from '../../../components/list-row';
import { PillButton, PillLink } from '../../../components/pill-button';
import { SurfaceGroup } from '../../../components/surface-group';
import { TextLink } from '../../../components/text-link';
import { formatAmount, formatDayWithYear, formatWholeMoney, shortenAddress } from '../../../lib/format';
import type { CouponsView, SeriesListEntry, SeriesView } from '../../../lib/investor-api';
import { SeriesChooser } from '../series-chooser';
import {
  couponLine,
  firstSettledCoupon,
  holderFor,
  isoDay,
  seriesName,
} from '../../../lib/investor-model';
import { WalletLine } from '../investor-overview';
import { DEMO_WALLET_LABEL, type WalletAccount } from '../../../lib/wallet';

/**
 * The subscribe screen, desktop, from the "Investor" block of the copy deck in
 * docs/DESIGN-TOKENS.md section 8: an amount, a confirm sheet whose button
 * names the outcome ("Subscribe 25,000"), then "You're subscribed" with "First
 * coupon" and "View the series".
 *
 * What this screen does not do is sign.
 *
 * DESIGN.md 3.8 makes a subscription two calls by two different holders of two
 * different roles: the operator issues the note to the investor through the
 * Asset Tokenization Studio under ROLE_ISSUER, and the api account pays the
 * vault on the investor's behalf under SUBSCRIPTION_ROLE. Neither key is in
 * the browser and neither ever will be: the demo wallet holds an account id
 * and an address and nothing that can move value. There is no subscribe
 * endpoint to call either. So the confirm says plainly, before the press, who
 * settles a subscription and where, and the screen that follows reports the
 * position the chain already holds rather than claiming to have created one.
 * MISSION rule 8: nothing shown here runs against a mock, and nothing here
 * claims a transaction that did not happen. See docs/DECISIONS.md.
 */

/** The demo subscription in the copy deck, which is what the slider opens on. */
const DEFAULT_AMOUNT = 25_000;
const MIN_AMOUNT = 5_000;
const MAX_AMOUNT = 50_000;
const STEP = 5_000;

const SETTLES_LINE =
  'This screen does not sign. A subscription settles on Hedera testnet in two calls: the issuer mints the note to your account, and the api account pays the vault for you under the subscription role.';

export interface SubscribeScreenProps {
  series: SeriesView;
  coupons: CouponsView;
  investor: WalletAccount;
  /** Every series the API serves, so the screen can offer a choice. */
  choices?: readonly SeriesListEntry[];
}

export function SubscribeScreen({
  series,
  coupons,
  investor,
  choices = [],
}: SubscribeScreenProps) {
  const [amount, setAmount] = useState(DEFAULT_AMOUNT);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const holder = holderFor(series, investor.evmAddress);
  // The first series in the list is the route's own default, so it needs no
  // query string. Anything else does.
  const seriesHref =
    series.series_id === choices[0]?.series_id
      ? '/invest'
      : `/invest?series=${encodeURIComponent(series.series_id)}`;

  if (confirmed) {
    return (
      <Subscribed
        coupons={coupons}
        holder={holder}
        investor={investor}
        series={series}
        seriesHref={seriesHref}
      />
    );
  }

  const coupon = couponLine(series);
  const matures = formatDayWithYear(isoDay(series.vault.matures_at));
  const label = `Subscribe ${formatAmount(amount)}`;
  const name = seriesName(series);

  return (
    <DesktopFrame current="invest">
      <header className="border-b border-hairline pb-6">
        <h1 className="text-title font-display font-semibold tracking-title text-ink">Subscribe</h1>
        <p className="mt-1 text-body text-ink-2 tabular-nums">{series.series_id}</p>
        {/* What the series covers. An identifier on its own does not say
            whose occupation this note funds. src/lib/investor-model.ts. */}
        {name === null ? null : <p className="text-secondary text-ink-2">{name}</p>}
        <SeriesChooser base="/invest/subscribe" choices={choices} current={series.series_id} />
      </header>

      <div className="mt-10 grid gap-10 lg:grid-cols-2">
        <section className="flex flex-col gap-8">
          <DisplayNumber value={amount} />
          <AmountSlider
            label="Amount"
            max={MAX_AMOUNT}
            min={MIN_AMOUNT}
            onChange={setAmount}
            step={STEP}
            value={amount}
          />
          <div className="flex flex-col gap-3">
            <PillButton onClick={() => setSheetOpen(true)}>{label}</PillButton>
            <WalletLine account={investor} />
          </div>
        </section>

        <section>
          <h2 className="sr-only">Series terms</h2>
          <SurfaceGroup>
            <ListRow label="Series" value={series.series_id} />
            {coupon === null ? null : <ListRow label="Coupon" value={coupon} />}
            <ListRow label="Matures" value={matures} />
            <ListRow
              label="Principal"
              value={formatWholeMoney(
                BigInt(series.vault.principal_funded.amount),
                series.vault.principal_funded.decimals,
              )}
            />
          </SurfaceGroup>
          <p className="mt-4 text-secondary text-ink-2">{SETTLES_LINE}</p>
        </section>
      </div>

      <BottomSheet onClose={() => setSheetOpen(false)} open={sheetOpen} title="Confirm your subscription">
        <SurfaceGroup>
          <ListRow label="Series" value={series.series_id} />
          <ListRow label="Amount" value={formatAmount(amount)} />
          {coupon === null ? null : <ListRow label="Coupon" value={coupon} />}
          <ListRow label="Matures" value={matures} />
          <ListRow
            label="Pays from"
            value={<span className="tabular-nums">{shortenAddress(investor.evmAddress)}</span>}
          />
        </SurfaceGroup>
        <p className="mt-4 text-secondary text-ink-2">{DEMO_WALLET_LABEL}</p>
        <p className="mt-2 text-secondary text-ink-2">{SETTLES_LINE}</p>
        <div className="mt-4">
          <PillButton
            className="w-full"
            onClick={() => {
              setSheetOpen(false);
              setConfirmed(true);
            }}
          >
            {label}
          </PillButton>
        </div>
      </BottomSheet>
    </DesktopFrame>
  );
}

/**
 * What the chain says about this noteholder, after the confirm.
 *
 * "You're subscribed" is the copy deck's string and it is true of the demo
 * investor: `pnpm coupons:pay subscribe` moved 50,000 TUSD into the vault for
 * each of the two noteholders, and `subscriptionOf` names them for the
 * redemption at maturity. Every figure below is that read. The line under the
 * title says what this screen did, which is nothing, so the title cannot be
 * mistaken for a receipt for the amount on the slider.
 */
function Subscribed({
  series,
  coupons,
  holder,
  investor,
  seriesHref,
}: {
  series: SeriesView;
  coupons: CouponsView;
  holder: ReturnType<typeof holderFor>;
  investor: WalletAccount;
  seriesHref: string;
}) {
  const subscription = holder === null ? 0n : BigInt(holder.subscription.amount);
  const decimals = series.vault.principal_funded.decimals;
  const firstCoupon = firstSettledCoupon(coupons, investor.evmAddress);

  if (subscription <= 0n) {
    return (
      <DesktopFrame current="invest">
        <main className="flex max-w-[640px] flex-col items-start gap-4">
          <h1 className="text-title font-display font-semibold tracking-title text-ink">
            Nothing was sent.
          </h1>
          <p className="text-body-lg text-ink-2">{SETTLES_LINE}</p>
          <p className="text-body text-ink-2">
            This account holds no subscription on the series today.
          </p>
          <WalletLine account={investor} />
          <PillLink href={seriesHref} variant="secondary">
            View the series
          </PillLink>
        </main>
      </DesktopFrame>
    );
  }

  return (
    <DesktopFrame current="invest">
      <main className="flex max-w-[640px] flex-col items-start gap-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-title font-display font-semibold tracking-title text-ink">
            You&apos;re subscribed
          </h1>
          <p className="text-secondary text-ink-2">{SETTLES_LINE}</p>
        </div>

        <div className="w-full">
          <SurfaceGroup>
            <ListRow label="Series" value={series.series_id} />
            <ListRow
              label="Subscribed"
              value={formatWholeMoney(subscription, decimals)}
            />
            {holder === null ? null : (
              <ListRow label="Note" value={`${holder.note_units} units`} />
            )}
            <ListRow
              label="First coupon"
              value={
                firstCoupon === null ? 'Not paid yet' : `${firstCoupon.day}, ${firstCoupon.amount}`
              }
            />
          </SurfaceGroup>
        </div>

        {firstCoupon?.transaction === undefined || firstCoupon?.transaction === null ? null : (
          <TextLink href={firstCoupon.transaction} rel="noreferrer" target="_blank">
            The first coupon on HashScan
          </TextLink>
        )}

        <WalletLine account={investor} />
        <PillLink href={seriesHref} variant="secondary">
          View the series
        </PillLink>
      </main>
    </DesktopFrame>
  );
}
