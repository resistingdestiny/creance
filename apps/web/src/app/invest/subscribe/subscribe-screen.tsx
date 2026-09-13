'use client';

import { useState, useTransition } from 'react';

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
import { subscribe, type SubscribeResult } from './subscribe-actions';

/**
 * The subscribe screen, desktop, from the "Investor" block of the copy deck in
 * docs/DESIGN-TOKENS.md section 8: an amount, a confirm sheet whose button
 * names the outcome ("Subscribe 25,000"), then "You're subscribed" with "First
 * coupon" and "View the series".
 *
 * The press settles a subscription on Hedera testnet. It did not used to: the
 * confirm set a piece of local state and the screen that followed reported the
 * position the chain already held, because there was no endpoint to call.
 * `POST /v1/subscribe` is that endpoint now, and src/app/invest/subscribe/
 * subscribe-actions.ts is what the button posts to.
 *
 * What this screen still does not do is sign. DESIGN.md 3.8 makes a
 * subscription a call by an account the browser does not hold: the vault pulls
 * the principal from whoever calls it, and the account holding
 * SUBSCRIPTION_ROLE is the api account, so the API approves the vault and
 * subscribes on the investor's behalf and the vault records the investor as the
 * subscriber. No key is in the browser and none ever will be: the demo wallet
 * holds an account id and an address and nothing that can move value. So the
 * confirm says who settles it before the press, and what follows is what the
 * vault said afterwards rather than the figure that was on the slider. MISSION
 * rule 8: nothing shown here runs against a mock, and nothing here claims a
 * transaction that did not happen. See docs/DECISIONS.md.
 */

/** The demo subscription in the copy deck, which is what the slider opens on. */
const DEFAULT_AMOUNT = 25_000;
const MIN_AMOUNT = 5_000;
const MAX_AMOUNT = 50_000;
const STEP = 5_000;

const SETTLES_LINE =
  'This screen holds no key. The API settles the subscription on Hedera testnet: it approves the vault from the api account and calls subscribe under the subscription role, and the vault records this account as the subscriber.';

/** Said after the fact, where the line above is said before it. */
const SETTLED_LINE =
  'The api account approved the vault and subscribed under the subscription role, and the vault records this account as the subscriber.';

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
  /** The subscription that landed, or null while there has not been one. */
  const [sent, setSent] = useState<SubscribeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * Set when the refusal is one another press cannot get past: a matured
   * series, a deployment that cannot settle a subscription at all. The button
   * goes with it, because a button that says "Subscribe 25,000" under a
   * sentence saying it cannot be subscribed is the screen telling a person to
   * do the one thing that will not work. See subscribeRefusal in
   * src/lib/investor-model.ts.
   */
  const [blocked, setBlocked] = useState(false);
  const [pending, startTransition] = useTransition();

  const holder = holderFor(series, investor.evmAddress);
  // Bare /invest is the market board, so a way back to the series this screen
  // is subscribing to always names it.
  const seriesHref = `/invest?series=${encodeURIComponent(series.series_id)}`;

  const send = () => {
    setError(null);
    startTransition(async () => {
      const form = new FormData();
      form.set('series', series.series_id);
      form.set('amount', String(amount));
      const result = await subscribe(form);
      if (result.ok) {
        setSheetOpen(false);
        setSent(result);
        return;
      }
      setError(result.error);
      setBlocked(!result.retry);
    });
  };

  if (sent !== null) {
    return (
      <Subscribed
        coupons={coupons}
        holder={holder}
        investor={investor}
        sent={sent}
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
        {error === null ? null : (
          <p className="mt-3 text-secondary text-triggered" role="status">
            {error}
          </p>
        )}
        <div className="mt-4">
          {blocked ? (
            <PillLink className="w-full" href={seriesHref}>
              View the series
            </PillLink>
          ) : (
            <PillButton className="w-full" loading={pending} onClick={send}>
              {label}
            </PillButton>
          )}
        </div>
      </BottomSheet>
    </DesktopFrame>
  );
}

/**
 * What the chain says about this noteholder, once a subscription has landed.
 *
 * "You're subscribed" is the copy deck's string and it is a receipt now rather
 * than a statement about somebody else's position. The figure on the row is the
 * vault's own `subscriptionOf` for this account, read back by the API after the
 * write and passed through here, so it is the total the account carries and not
 * the amount that was on the slider: a subscription adds to what is already
 * there. `holder.subscription` is the same read from the page's own load and is
 * what shows if the response somehow carried none.
 *
 * The transaction is linked because a receipt a person cannot check is not one.
 */
function Subscribed({
  series,
  coupons,
  holder,
  investor,
  sent,
  seriesHref,
}: {
  series: SeriesView;
  coupons: CouponsView;
  holder: ReturnType<typeof holderFor>;
  investor: WalletAccount;
  sent: SubscribeResult;
  seriesHref: string;
}) {
  const fromChain = holder === null ? 0n : BigInt(holder.subscription.amount);
  const subscription = sent.subscribed === null ? fromChain : BigInt(sent.subscribed);
  const decimals = series.vault.principal_funded.decimals;
  const firstCoupon = firstSettledCoupon(coupons, investor.evmAddress);

  return (
    <DesktopFrame current="invest">
      <main className="flex max-w-[640px] flex-col items-start gap-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-title font-display font-semibold tracking-title text-ink">
            You&apos;re subscribed
          </h1>
          <p className="text-secondary text-ink-2">{SETTLED_LINE}</p>
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

        {sent.transaction === null ? null : (
          <TextLink href={sent.transaction} rel="noreferrer" target="_blank">
            This subscription on HashScan
          </TextLink>
        )}

        {firstCoupon?.transaction === undefined || firstCoupon?.transaction === null ? null : (
          <TextLink href={firstCoupon.transaction} rel="noreferrer" target="_blank">
            The first coupon on HashScan
          </TextLink>
        )}

        <WalletLine account={investor} />
        {/* The one way on from a screen that has finished, so it is the
            primary. It was a secondary, which left a dead end with nothing on
            it ranked as the thing to do next. */}
        <PillLink href={seriesHref}>View the series</PillLink>
      </main>
    </DesktopFrame>
  );
}
