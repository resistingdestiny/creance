import { Suspense, use, type ReactNode } from 'react';

import { DataTable, type TableRowData } from '../../components/table';
import { CoverCardShell } from '../../components/cover-card';
import { DesktopFrame } from '../../components/desktop-frame';
import { ListRow } from '../../components/list-row';
import { PillLink } from '../../components/pill-button';
import { PrincipalBar } from '../../components/principal-bar';
import { Skeleton } from '../../components/skeleton';
import { StatusPill } from '../../components/status-pill';
import { SurfaceGroup } from '../../components/surface-group';
import { TextLink } from '../../components/text-link';
import { formatDayWithYear, formatWholeMoney, shortenAddress } from '../../lib/format';
import type { CouponsView, SeriesListEntry, SeriesView } from '../../lib/investor-api';
import type { Streamed } from '../../lib/investor-data';
import {
  type NextPayment,
  capacityLine,
  couponHistory,
  couponLine,
  earnedToDate,
  holderFor,
  isoDay,
  nextPayment,
  principalAtRisk,
  principalCaption,
  principalSegments,
  recordDatesBroughtForward,
  seriesName,
  termLine,
} from '../../lib/investor-model';
import { DEMO_WALLET_LABEL, type WalletAccount } from '../../lib/wallet';
import { SeriesChooser } from './series-chooser';

/**
 * The investor overview, desktop, from the "Investor" block of the copy deck in
 * docs/DESIGN-TOKENS.md section 8 with the two rows and the three-segment bar
 * that docs/DESIGN-TOKENS-ADDENDUM.md adds.
 *
 * Every figure on it comes from the two investor endpoints, which read the
 * vault, the note and the CoverPool on Hedera testnet. Nothing here is a
 * constant: the principal, the reserve, the claims paid, the coupon rate, the
 * term, the maturity, the capacity, the coupons and the next payment are all
 * reads, and a field the chain cannot answer is a row that does not render
 * rather than a placeholder.
 *
 * The coupon history comes first, because what has been paid is what an
 * investor came to see, and it opens with the position rather than with the
 * transactions: what this account has earned to date, and when the next
 * payment falls due. The series terms and the principal at risk follow.
 *
 * T49 drew the position on the metal. The note is a certificate, so the
 * "Earned to date" figure and the "Next payment" row sit on a certificate card
 * in the same material as the cover card, with this screen's one shimmer
 * (docs/DESIGN-TOKENS-ADDENDUM.md, "The metal"). Everything else on the page
 * is ordinary content and stays on canvas and surface: the coupon history is a
 * table, the terms are rows, and the material carries neither.
 *
 * Since T51 the screen is drawn before its figures arrive. The two reads
 * behind them go through the JSON-RPC relay to the mirror node and take up to
 * two seconds each, so the route hands them to this component as promises
 * rather than awaiting them: the heading, the chooser, the copy and the
 * subscribe action are on the first byte, and each figure is behind a
 * Suspense boundary of its own so that a slow coupon history cannot hold up
 * the terms and neither can hold up the page. Each boundary rests at the
 * height its figure takes on the demo series, measured in a browser at 390
 * and 1440, using the sheet's own Skeleton: the exact final dimensions, at the
 * field radius, no animation and no copy. A figure landing changes what is in
 * a space and never how much space there is.
 *
 * A read that fails costs the page that figure and never the page. The series
 * read failing takes the terms, the principal bar and the HashScan links and
 * leaves the honest line in their place; the coupon history failing takes the
 * table the same way. Nothing is ever put where a figure would have been
 * except the sentence saying it could not be read.
 *
 * The component is pure, and synchronous when handed values. Every test in
 * apps/web/test/investor.test.tsx hands it the two responses themselves and
 * renders it with renderToStaticMarkup, with no resting state in between; the
 * route hands it promises and the same components render them as they land.
 */

/** docs/DESIGN-TOKENS.md section 8, verbatim. */
const EXPLAINER =
  'You earn coupons from premiums. If the index for this occupation is triggered, part of your principal pays out to policyholders. Anything left is returned at maturity.';

/**
 * Said out loud wherever the compressed cadence is on screen, because the
 * record dates on these coupons are not where a live series would put them.
 * The payments themselves are real and every one of them resolves on HashScan.
 */
const BROUGHT_FORWARD =
  'The record dates on these coupons were brought forward so several months could be paid inside the demonstration. Every payment below settled on Hedera testnet.';

export interface InvestorOverviewProps {
  /** The series on screen. Known from the list before anything is read. */
  seriesId: string;
  /** The series read, or null when it could not be read. */
  series: Streamed<SeriesView | null>;
  /** Its coupon history, or null when it could not be read. */
  coupons: Streamed<CouponsView | null>;
  /** The noteholder this screen speaks to. See src/lib/wallet.ts. */
  investor: WalletAccount;
  /** Every series the API serves, so the screen can offer a choice. */
  choices?: readonly SeriesListEntry[];
}

export function InvestorOverview({
  seriesId,
  series,
  coupons,
  investor,
  choices = [],
}: InvestorOverviewProps) {
  // An identifier is not a name. What the series covers comes from the group
  // the API lists it under, through src/lib/occupations.ts, and the list is
  // in hand before either chain read is, so the name is on the first byte.
  const listed = choices.find((choice) => choice.series_id === seriesId);
  const name = listed === undefined ? null : seriesName(listed);
  // The first series in the list is the route's own default, so it needs no
  // query string. Anything else does.
  const head = seriesId === choices[0]?.series_id;
  const query = `?series=${encodeURIComponent(seriesId)}`;
  const subscribeHref = head ? '/invest/subscribe' : `/invest/subscribe${query}`;
  const retryHref = head ? '/invest' : `/invest${query}`;

  return (
    <DesktopFrame current="invest">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-hairline pb-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-title font-display font-semibold tracking-title tabular-nums text-ink">
            {seriesId}
          </h1>
          {name === null ? null : <p className="text-body text-ink-2">{name}</p>}
        </div>
        <Suspense fallback={<KycResting />}>
          <KycPill investor={investor} series={series} />
        </Suspense>
      </header>

      <SeriesChooser base="/invest" choices={choices} current={seriesId} />

      <section className="mt-10">
        <h2 className="mb-4 text-body-lg font-medium text-ink">Coupon history</h2>

        <Suspense fallback={<PositionResting />}>
          <Position coupons={coupons} investor={investor} series={series} />
        </Suspense>

        <Suspense fallback={<HistoryResting />}>
          <History coupons={coupons} retryHref={retryHref} seriesId={seriesId} />
        </Suspense>
      </section>

      <div className="mt-12 grid gap-10 lg:grid-cols-2">
        <section>
          <h2 className="sr-only">Series terms</h2>
          <Suspense fallback={<TermsResting />}>
            <Terms retryHref={retryHref} series={series} />
          </Suspense>
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="text-body-lg font-medium text-ink">Principal at risk</h2>
          <Suspense fallback={<PrincipalResting />}>
            <Principal series={series} />
          </Suspense>
          <p className="text-secondary text-ink-2">{EXPLAINER}</p>
          <div className="mt-2 flex flex-col gap-3">
            <PillLink href={subscribeHref}>Subscribe</PillLink>
            <WalletLine account={investor} />
          </div>
        </section>
      </div>

      <Suspense fallback={<HashScanResting />}>
        <HashScanLinks series={series} />
      </Suspense>
    </DesktopFrame>
  );
}

/**
 * The figure, or the figure once it arrives.
 *
 * The route hands this screen promises so that neither is awaited before the
 * first byte; a test hands it the values themselves and the same components
 * render them with no boundary in between. `use` on a promise is what
 * suspends the one boundary waiting for it, and it is called conditionally on
 * purpose: there is nothing to wait for when there is a value. It is the
 * landing page's own helper (src/components/landing/landing-screen.tsx),
 * repeated here rather than shared, because that file is the landing's and
 * five lines is less than a module.
 */
function figureOf<T>(value: Streamed<T>): T {
  return isPromised(value) ? use(value) : value;
}

function isPromised<T>(value: Streamed<T>): value is Promise<T> {
  return value !== null && typeof (value as Promise<T>).then === 'function';
}

/**
 * The note's own internal KYC register decides whether a transfer settles, so
 * this pill is that read and not a status of ours. A series that could not be
 * read has no register to consult, and the pill says nothing rather than
 * "Verification needed", which would be a claim about an account the note was
 * never asked about.
 */
function KycPill({
  investor,
  series,
}: {
  investor: WalletAccount;
  series: Streamed<SeriesView | null>;
}) {
  const view = figureOf(series);
  if (view === null) return null;
  const granted = holderFor(view, investor.evmAddress)?.kyc.granted === true;
  return (
    <StatusPill state={granted ? 'covered' : 'watch'}>
      {granted ? 'KYC approved' : 'Verification needed'}
    </StatusPill>
  );
}

/**
 * The pill before the register has been read: the same pill at the same
 * height, with a bar the height of its caption line where the words go and no
 * dot, because neither colour may be shown before it is known.
 */
function KycResting() {
  return (
    <span data-testid="investor-resting">
      <StatusPill state="none">
        <RestingBar className="h-[18px] w-24" />
      </StatusPill>
    </span>
  );
}

/**
 * A resting bar that may stand inside a paragraph or a pill, where the sheet's
 * Skeleton, a div, is not allowed. Same surface, same radius, no animation.
 */
function RestingBar({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={['inline-block rounded-field bg-surface', className].filter(Boolean).join(' ')}
    />
  );
}

/**
 * The position: what this account has earned to date, and when the note pays
 * next. Earned to date is read from the coupon history and the next payment
 * from the series, so this is the one place both figures are needed.
 *
 * A coupon history that could not be read leaves earned to date out, exactly
 * as a series that has paid this account nothing does: nothing known is not
 * nought. A series that could not be read leaves the next payment out, which
 * is the T47 rule that an unknown next payment renders as no row and never as
 * "no further payments".
 */
function Position({
  coupons,
  investor,
  series,
}: {
  coupons: Streamed<CouponsView | null>;
  investor: WalletAccount;
  series: Streamed<SeriesView | null>;
}) {
  const history = figureOf(coupons);
  const view = figureOf(series);
  const earned = history === null ? null : earnedToDate(history, investor.evmAddress);
  const next = view === null ? null : nextPayment(view);

  if (earned === null) {
    return next === null ? null : (
      <SurfaceGroup className="mb-6 max-w-[520px]">
        <NextPaymentRow next={next} />
      </SurfaceGroup>
    );
  }
  return (
    <NoteCertificate
      caption={`${earned.coupons} coupon${earned.coupons === 1 ? '' : 's'} paid to ${investor.accountId}`}
      earned={earned.amount}
      next={next}
    />
  );
}

/**
 * The certificate at the height it stands at once its figures are in it: the
 * headline block and the next payment row, inside the card's own padding,
 * measured in a browser on the demo series at both widths. It is taller at
 * 390 because the row's caption wraps there.
 */
function PositionResting() {
  return (
    <div data-testid="investor-resting">
      <Skeleton className="mb-6 h-[321px] w-full max-w-[720px] rounded-card lg:h-[293px]" />
    </div>
  );
}

/**
 * The coupon history, from the coupons endpoint alone.
 *
 * A history that could not be read is said so, in place of the table. It is
 * not "No coupons yet.", which is a fact about the note and not about the
 * read.
 */
function History({
  coupons,
  retryHref,
  seriesId,
}: {
  coupons: Streamed<CouponsView | null>;
  retryHref: string;
  seriesId: string;
}) {
  const history = figureOf(coupons);
  if (history === null) return <CannotLoad retryHref={retryHref} what="the coupon history" />;

  const rows = couponHistory(history);
  if (rows.length === 0) {
    return (
      <div className="flex flex-col gap-1">
        <p className="text-body text-ink">No coupons yet.</p>
        <p className="text-secondary text-ink-2">Coupons are paid monthly from the premium account.</p>
      </div>
    );
  }

  return (
    <>
      {recordDatesBroughtForward(history) ? (
        <p className="mb-4 max-w-[720px] text-secondary text-ink-2">{BROUGHT_FORWARD}</p>
      ) : null}
      {/* Five columns do not fit 390 wide. The table keeps its shape and
          the region scrolls, and it is focusable so a keyboard reaches
          the scroll as well as the links inside it. */}
      <div aria-label="Coupon history" className="overflow-x-auto" role="region" tabIndex={0}>
        <div className="min-w-[44rem]">
          <DataTable
            caption={`Coupons paid on ${seriesId}`}
            columns={[
              { key: 'period', label: 'Period' },
              { key: 'holder', label: 'Noteholder' },
              { key: 'state', label: 'State' },
              { key: 'amount', label: 'Amount', numeric: true },
              { key: 'receipt', label: 'Receipt' },
            ]}
            rows={rows.map(
              (row): TableRowData => ({
                key: row.key,
                cells: [
                  row.period,
                  <span className="tabular-nums" key="holder">
                    {row.accountId}
                  </span>,
                  <span className="flex flex-col items-start gap-1" key="state">
                    <StatusPill state={row.settled ? 'covered' : 'none'}>
                      {row.settled ? 'Settled' : 'Not settled'}
                    </StatusPill>
                    {row.settled ? (
                      <span className="text-caption tabular-nums text-ink-2">{row.day}</span>
                    ) : null}
                  </span>,
                  row.amount,
                  row.transaction === null ? null : (
                    <TextLink href={row.transaction} key="receipt" rel="noreferrer" target="_blank">
                      HashScan
                    </TextLink>
                  ),
                ],
              }),
            )}
          />
        </div>
      </div>
    </>
  );
}

/**
 * The history at the height it takes on the demo series: the brought forward
 * line and six rows of two noteholders over three periods, measured in a
 * browser at both widths. The line wraps to four at 390 and two at 1440, and
 * the table's cells wrap inside the scrolling region at 390, which is where
 * the difference comes from.
 */
function HistoryResting() {
  return (
    <div data-testid="investor-resting">
      <Skeleton className="mb-4 h-[80px] w-full max-w-[720px] lg:h-[40px]" />
      <Skeleton className="h-[466.5px] w-full lg:h-[358.5px]" />
    </div>
  );
}

/** The series terms: rows in a surface group, every one of them a read. */
function Terms({
  retryHref,
  series,
}: {
  retryHref: string;
  series: Streamed<SeriesView | null>;
}) {
  const view = figureOf(series);
  if (view === null) return <CannotLoad retryHref={retryHref} what="the series" />;

  const segments = principalSegments(view);
  const decimals = view.vault.principal_funded.decimals;
  const coupon = couponLine(view);
  const term = termLine(view);
  const capacity = capacityLine(view);
  return (
    <SurfaceGroup>
      <ListRow label="Principal" value={formatWholeMoney(segments.funded, decimals)} />
      <ListRow label="Reserved for claims" value={formatWholeMoney(segments.reserved, decimals)} />
      <ListRow label="Paid to policyholders" value={formatWholeMoney(segments.paid, decimals)} />
      {coupon === null ? null : <ListRow label="Coupon" value={coupon} />}
      {term === null ? null : <ListRow label="Term" value={term} />}
      <ListRow label="Matures" value={formatDayWithYear(isoDay(view.vault.matures_at))} />
      {capacity === null ? null : <ListRow label="Capacity used" value={capacity} />}
    </SurfaceGroup>
  );
}

/**
 * Seven rows of 52px with six hairlines between them, at the group radius.
 * At 390 the coupon row wraps to two lines and the group is 21px taller.
 */
function TermsResting() {
  return (
    <div data-testid="investor-resting">
      <Skeleton className="h-[385px] w-full rounded-group lg:h-[364px]" />
    </div>
  );
}

/**
 * The bar, its caption and the two lines under it, from the series alone. A
 * series that could not be read draws no bar: the terms beside it carry the
 * sentence, and a bar at some width would be a figure nobody read.
 */
function Principal({ series }: { series: Streamed<SeriesView | null> }) {
  const view = figureOf(series);
  if (view === null) return null;

  const segments = principalSegments(view);
  const atRisk = principalAtRisk(view);
  return (
    <>
      <PrincipalBar
        intactPercent={segments.intactPercent}
        label={principalCaption(view)}
        paidPercent={segments.paidPercent}
        reservedPercent={segments.reservedPercent}
      />
      <p className="text-secondary text-ink-2">{principalCaption(view)}</p>
      <p className="text-body text-ink">{atRisk.current}</p>
      {atRisk.ifTriggered === null ? null : <p className="text-body text-ink">{atRisk.ifTriggered}</p>}
    </>
  );
}

/**
 * The bar and its three lines at their own heights, with the section's gap
 * between them, so that the explainer under them does not move when they land.
 * Four pieces rather than one slab because the section is a column with a
 * gap, and the fallback has to be worth the same number of gaps. The caption
 * is two lines of secondary type at 390 and one from the landing breakpoint.
 * The third line is "if triggered", which renders only while a reserve is
 * held; the demo series holds one, so the space is kept for it.
 */
function PrincipalResting() {
  return (
    <div className="flex flex-col gap-4" data-testid="investor-resting">
      <Skeleton className="h-3 w-full rounded-full" />
      <Skeleton className="h-10 w-72 max-w-full lg:h-5" />
      <Skeleton className="h-6 w-64 max-w-full" />
      <Skeleton className="h-6 w-40 max-w-full" />
    </div>
  );
}

/**
 * The links, and the section that carries them. The note is a contract and not
 * an HTS token, so every link to it is a contract link (docs/ATS.md). The
 * heading is in the resting state as well as here, so it is on the first byte
 * whichever of the two is standing; a series that could not be read has no
 * links and the section closes rather than showing a heading over nothing.
 */
function HashScanLinks({ series }: { series: Streamed<SeriesView | null> }) {
  const view = figureOf(series);
  if (view === null) return null;
  return (
    <HashScanSection>
      {view.note === null ? null : (
        <TextLink href={view.note.hashscan} rel="noreferrer" target="_blank">
          Note
        </TextLink>
      )}
      <TextLink href={view.vault.hashscan} rel="noreferrer" target="_blank">
        Vault
      </TextLink>
      {view.cover_pool === null ? null : (
        <TextLink href={view.cover_pool.hashscan} rel="noreferrer" target="_blank">
          Cover pool
        </TextLink>
      )}
      {view.links.payments_topic === null ? null : (
        <TextLink href={view.links.payments_topic} rel="noreferrer" target="_blank">
          Payments topic
        </TextLink>
      )}
    </HashScanSection>
  );
}

function HashScanSection({ children }: { children: ReactNode }) {
  return (
    <section className="mt-10 border-t border-hairline pt-6">
      <h2 className="text-secondary text-ink-2">On HashScan</h2>
      <div className="mt-2 flex flex-wrap items-center gap-6">{children}</div>
    </section>
  );
}

/**
 * The links at the link's own 44px minimum height: one row at 1440, two with
 * the gap between them at 390.
 */
function HashScanResting() {
  return (
    <div data-testid="investor-resting">
      <HashScanSection>
        <Skeleton className="h-[112px] w-80 max-w-full lg:h-11" />
      </HashScanSection>
    </div>
  );
}

/**
 * What stands where a figure would have been when its read failed. The two
 * sentences are the ones src/app/invest/unavailable.tsx already says for the
 * whole page, and "Retry" is a link back to the same address, because a fresh
 * request is the whole of the retry.
 */
function CannotLoad({ retryHref, what }: { retryHref: string; what: string }) {
  return (
    <div className="flex flex-col items-start gap-1" data-testid="investor-unavailable">
      <p className="text-body text-ink">We can&apos;t load {what} right now.</p>
      <p className="text-secondary text-ink-2">
        The series data comes from the API. Start it with pnpm api:dev, then try again.
      </p>
      <TextLink href={retryHref}>Retry</TextLink>
    </div>
  );
}

/**
 * The note as an object: what it has paid this holder, and when it pays next.
 *
 * It is the certificate treatment of the cover card, because a note is a
 * certificate whichever treatment the cover card itself follows, and it is the
 * one shimmering element on this screen. The headline is "Earned to date" at
 * display-l, the weight the addendum gives a headline figure; the row under it
 * is the same ListRow the surface group used, on the metal now, where the
 * card's own rule turns its ink-2 to ink. The label, the caption and then the
 * figure are in that order in the markup, so the screen reads exactly as it
 * did when they were a row.
 *
 * Nothing on it is a moving light under text: the shimmer is a layer under
 * `.cover-card__content`, as on every card.
 */
function NoteCertificate({
  earned,
  caption,
  next,
}: {
  earned: string;
  caption: string;
  next: NextPayment | null;
}) {
  return (
    <CoverCardShell className="mb-6 max-w-[720px]" metal="shimmer" treatment="certificate">
      <div className="cover-card__content flex flex-col gap-4">
        <div className="flex flex-col items-center gap-1 py-6 text-center">
          <p className="text-secondary font-medium text-ink">Earned to date</p>
          <p className="text-caption text-ink">{caption}</p>
          <p className="mt-2 font-display text-display-l font-medium tracking-display tabular-nums text-ink">
            {earned}
          </p>
        </div>
        {next === null ? null : (
          <div className="border-t border-hairline">
            <NextPaymentRow next={next} />
          </div>
        )}
      </div>
    </CoverCardShell>
  );
}

/** "Next payment" as the addendum specifies it: the date, captioned with the period. */
function NextPaymentRow({ next }: { next: NextPayment }) {
  return (
    <ListRow
      caption={`Coupon ${next.couponId}, accruing ${next.period}`}
      label="Next payment"
      value={<span className="tabular-nums whitespace-nowrap">{next.day}</span>}
    />
  );
}

/**
 * Which account the screen is speaking for. The investor screens are desktop
 * and may show the account id plainly; the demo label is never hidden, because
 * a judge who cannot tell whether a position is real assumes it is not.
 */
export function WalletLine({ account }: { account: WalletAccount }) {
  return (
    <p className="text-secondary text-ink-2">
      <span className="tabular-nums">
        {account.accountId} {shortenAddress(account.evmAddress)}
      </span>
      {'. '}
      {DEMO_WALLET_LABEL}
    </p>
  );
}
