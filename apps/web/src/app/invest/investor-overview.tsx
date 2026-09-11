import { DataTable, type TableRowData } from '../../components/table';
import { CoverCardShell } from '../../components/cover-card';
import { DesktopFrame } from '../../components/desktop-frame';
import { ListRow } from '../../components/list-row';
import { PillLink } from '../../components/pill-button';
import { PrincipalBar } from '../../components/principal-bar';
import { StatusPill } from '../../components/status-pill';
import { SurfaceGroup } from '../../components/surface-group';
import { TextLink } from '../../components/text-link';
import { formatDayWithYear, formatWholeMoney, shortenAddress } from '../../lib/format';
import type { CouponsView, SeriesListEntry, SeriesView } from '../../lib/investor-api';
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
 * The component is pure and synchronous. The fetch is the route's, which keeps
 * this testable with renderToStaticMarkup like the rest of the app.
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
  series: SeriesView;
  coupons: CouponsView;
  /** The noteholder this screen speaks to. See src/lib/wallet.ts. */
  investor: WalletAccount;
  /** Every series the API serves, so the screen can offer a choice. */
  choices?: readonly SeriesListEntry[];
}

export function InvestorOverview({
  series,
  coupons,
  investor,
  choices = [],
}: InvestorOverviewProps) {
  const holder = holderFor(series, investor.evmAddress);
  const segments = principalSegments(series);
  const atRisk = principalAtRisk(series);
  const decimals = series.vault.principal_funded.decimals;
  const coupon = couponLine(series);
  const term = termLine(series);
  const capacity = capacityLine(series);
  const name = seriesName(series);
  const rows = couponHistory(coupons);
  const earned = earnedToDate(coupons, investor.evmAddress);
  const next = nextPayment(series);
  // The first series in the list is the route's own default, so it needs no
  // query string. Anything else does.
  const subscribeHref =
    series.series_id === choices[0]?.series_id
      ? '/invest/subscribe'
      : `/invest/subscribe?series=${encodeURIComponent(series.series_id)}`;

  return (
    <DesktopFrame>
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-hairline pb-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-title font-display font-semibold tracking-title tabular-nums text-ink">
            {series.series_id}
          </h1>
          {/* An identifier is not a name. What the series covers comes from the
              group the API serves, through src/lib/occupations.ts. */}
          {name === null ? null : <p className="text-body text-ink-2">{name}</p>}
        </div>
        {/* The note's own internal KYC register decides whether a transfer
            settles, so this pill is that read and not a status of ours. */}
        <StatusPill state={holder?.kyc.granted ? 'covered' : 'watch'}>
          {holder?.kyc.granted ? 'KYC approved' : 'Verification needed'}
        </StatusPill>
      </header>

      <SeriesChooser base="/invest" choices={choices} current={series.series_id} />

      <section className="mt-10">
        <h2 className="mb-4 text-body-lg font-medium text-ink">Coupon history</h2>

        {earned === null ? (
          next === null ? null : (
            <SurfaceGroup className="mb-6 max-w-[520px]">
              <NextPaymentRow next={next} />
            </SurfaceGroup>
          )
        ) : (
          <NoteCertificate
            caption={`${earned.coupons} coupon${earned.coupons === 1 ? '' : 's'} paid to ${investor.accountId}`}
            earned={earned.amount}
            next={next}
          />
        )}

        {rows.length === 0 ? (
          <div className="flex flex-col gap-1">
            <p className="text-body text-ink">No coupons yet.</p>
            <p className="text-secondary text-ink-2">
              Coupons are paid monthly from the premium account.
            </p>
          </div>
        ) : (
          <>
            {recordDatesBroughtForward(coupons) ? (
              <p className="mb-4 max-w-[720px] text-secondary text-ink-2">{BROUGHT_FORWARD}</p>
            ) : null}
            {/* Five columns do not fit 390 wide. The table keeps its shape and
                the region scrolls, and it is focusable so a keyboard reaches
                the scroll as well as the links inside it. */}
            <div
              aria-label="Coupon history"
              className="overflow-x-auto"
              role="region"
              tabIndex={0}
            >
              <div className="min-w-[44rem]">
                <DataTable
                  caption={`Coupons paid on ${series.series_id}`}
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
                          <TextLink
                            href={row.transaction}
                            key="receipt"
                            rel="noreferrer"
                            target="_blank"
                          >
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
        )}
      </section>

      <div className="mt-12 grid gap-10 lg:grid-cols-2">
        <section>
          <h2 className="sr-only">Series terms</h2>
          <SurfaceGroup>
            <ListRow label="Principal" value={formatWholeMoney(segments.funded, decimals)} />
            <ListRow
              label="Reserved for claims"
              value={formatWholeMoney(segments.reserved, decimals)}
            />
            <ListRow
              label="Paid to policyholders"
              value={formatWholeMoney(segments.paid, decimals)}
            />
            {coupon === null ? null : <ListRow label="Coupon" value={coupon} />}
            {term === null ? null : <ListRow label="Term" value={term} />}
            <ListRow
              label="Matures"
              value={formatDayWithYear(isoDay(series.vault.matures_at))}
            />
            {capacity === null ? null : <ListRow label="Capacity used" value={capacity} />}
          </SurfaceGroup>
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="text-body-lg font-medium text-ink">Principal at risk</h2>
          <PrincipalBar
            intactPercent={segments.intactPercent}
            label={principalCaption(series)}
            paidPercent={segments.paidPercent}
            reservedPercent={segments.reservedPercent}
          />
          <p className="text-secondary text-ink-2">{principalCaption(series)}</p>
          <p className="text-body text-ink">{atRisk.current}</p>
          {atRisk.ifTriggered === null ? null : (
            <p className="text-body text-ink">{atRisk.ifTriggered}</p>
          )}
          <p className="text-secondary text-ink-2">{EXPLAINER}</p>
          <div className="mt-2 flex flex-col gap-3">
            <PillLink href={subscribeHref}>Subscribe</PillLink>
            <WalletLine account={investor} />
          </div>
        </section>
      </div>

      <section className="mt-10 border-t border-hairline pt-6">
        <h2 className="text-secondary text-ink-2">On HashScan</h2>
        <div className="mt-2 flex flex-wrap items-center gap-6">
          {/* The note is a contract and not an HTS token, so every link to it
              is a contract link. docs/ATS.md. */}
          {series.note === null ? null : (
            <TextLink href={series.note.hashscan} rel="noreferrer" target="_blank">
              Note
            </TextLink>
          )}
          <TextLink href={series.vault.hashscan} rel="noreferrer" target="_blank">
            Vault
          </TextLink>
          {series.cover_pool === null ? null : (
            <TextLink href={series.cover_pool.hashscan} rel="noreferrer" target="_blank">
              Cover pool
            </TextLink>
          )}
          {series.links.payments_topic === null ? null : (
            <TextLink href={series.links.payments_topic} rel="noreferrer" target="_blank">
              Payments topic
            </TextLink>
          )}
        </div>
      </section>
    </DesktopFrame>
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
