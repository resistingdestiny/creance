'use client';

import { useEffect, useTransition } from 'react';

import { AppFrame } from '../../components/app-frame';
import { CopyButton } from '../../components/copy-button';
import { CoverCard } from '../../components/cover-card';
import { CoverHistory } from '../../components/cover-history';
import { DisplayNumber } from '../../components/display-number';
import { IndexChart, type IndexPoint } from '../../components/index-chart';
import { ListRow } from '../../components/list-row';
import { PillButton, PillLink } from '../../components/pill-button';
import { ReplayBar } from '../../components/replay-bar';
import { SurfaceGroup } from '../../components/surface-group';
import { TextLink } from '../../components/text-link';
import type { AuditEntry } from '../../lib/audit-api';
import type { HomeView } from '../../lib/claim-model';
import { beginClaim } from '../claim-actions';
import { CoverTabs } from '../cover-tabs';
import { signOutOfCover } from '../purchase-actions';
import {
  HISTORY_EMPTY,
  HISTORY_HEADING,
  HISTORY_LIMIT,
  KEY_HEADING,
  KEY_KEEP,
  KEY_REVEAL,
  SIGN_OUT,
  statusSentence,
} from './home-copy';
import { OfflineNotice } from './offline-notice';

/**
 * Home: the card, the next payment, the index row and the way to the index,
 * in whichever of its five states the cover is in.
 *
 * The addendum replaces the old Triggered state with Claims open, an amber
 * pill and one line saying when a claim would be payable and for how much. Red
 * now means only two things: a claim that has paid, and a payment that is due.
 *
 * The one orchestrated moment in the design happens here, once, after a payment
 * confirms: the card slides up over 420ms ease-out while the amount counts up
 * over 600ms (docs/DESIGN-TOKENS.md section 6). Under prefers-reduced-motion
 * both are replaced by an instant state change. The slide is a CSS animation
 * turned off by `motion-reduce:animate-none`, so the card is simply in place on
 * the first paint rather than being moved there by a script; the count-up is
 * skipped inside DisplayNumber, which is the one piece of motion CSS cannot
 * switch off.
 *
 * It runs on arriving from the Pay sheet and never again. The query that says
 * so is dropped from the address as soon as it has been read, so a reload is a
 * plain Home rather than a second performance.
 *
 * T41 made it a dashboard rather than a screen. What was added is what the
 * ticket names and nothing invented: whether you are covered said in words, the
 * index reading drawn at the size docs/DESIGN-TOKENS.md section 5 gives the
 * Home row, what has happened on the cover from the audit trail, and the cover
 * key, shown back only from inside a session that already holds this cover.
 */

/** The Home row's chart, docs/DESIGN-TOKENS.md section 5: 64 by 20, no band unless triggered. */
export interface HomeChart {
  readonly points: readonly IndexPoint[];
  readonly threshold: number;
  readonly bandLabel: string;
  readonly description: string;
  readonly open: boolean;
}

export function HomeScreen({
  view,
  bound,
  demo = false,
  chart = null,
  history = [],
  coverKey = '',
}: {
  view: HomeView;
  bound: boolean;
  /** Rendered from fixtures by the demo control. Says so on screen. */
  demo?: boolean;
  /** The index line beside the reading. Null where there is no reading. */
  chart?: HomeChart | null;
  /** What has happened on this cover, oldest first. */
  history?: readonly AuditEntry[];
  /** Shown only from inside a session that already holds this cover. */
  coverKey?: string;
}) {
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (bound) window.history.replaceState(null, '', '/home');
  }, [bound]);

  const state = view.status.state;

  return (
    <AppFrame>
      <div className="flex min-h-dvh flex-col">
        <main className="flex flex-1 flex-col gap-6 px-5 py-10">
          <div className="flex items-baseline justify-between gap-4">
            <h1 className="text-title font-display font-semibold tracking-title text-ink">
              Cover
            </h1>
            {view.replayBadge === null ? null : (
              <ReplayBar label={view.replayBadge} variant="compact" />
            )}
          </div>

          {demo ? (
            <p className="text-secondary text-ink-2">
              Demo state. Nothing on this screen came from the API.
            </p>
          ) : null}

          <div
            className={bound ? 'cover-card-enter motion-reduce:animate-none' : undefined}
            data-testid="home-card"
          >
            <CoverCard
              amount={<DisplayNumber countUp={bound} size="display-l" value={view.cover} />}
              occupation={view.occupation}
              state={view.status.pill}
              statusLabel={view.status.label}
            />
          </div>

          <p className="text-body-lg text-ink">{statusSentence(state)}</p>

          {view.claimsOpen === null ? null : (
            <p className="text-body text-ink-2">{view.claimsOpen}</p>
          )}

          <SurfaceGroup>
            {view.paid === null ? (
              <ListRow label="Next payment" value={view.nextPayment} />
            ) : (
              <ListRow
                caption={view.paid.day}
                label="Payout"
                value={<span className="tabular-nums">{`${view.paid.amount} received`}</span>}
              />
            )}
            {view.index === null ? null : (
              <ListRow
                caption={view.index.caption}
                label="Index"
                value={
                  <span className="flex items-center gap-3">
                    {chart === null ? null : (
                      <IndexChart
                        bandLabel={chart.bandLabel}
                        description={chart.description}
                        label={view.occupation}
                        points={chart.points}
                        size="small"
                        state={chart.open ? 'triggered' : 'flat'}
                        threshold={chart.threshold}
                      />
                    )}
                    <span className="tabular-nums">{view.index.value}</span>
                  </span>
                }
              />
            )}
          </SurfaceGroup>

          {/* The status pill already carries "Payment due", so the state adds
              the one line that says by when, and the button says what to do. */}
          {view.lapsed === null ? null : (
            <p className="text-body text-ink-2">{view.lapsed.line}</p>
          )}

          <section className="flex flex-col gap-3">
            <h2 className="text-secondary text-ink-2">{HISTORY_HEADING}</h2>
            {history.length === 0 ? (
              <p className="text-body text-ink-2">{HISTORY_EMPTY}</p>
            ) : (
              <CoverHistory entries={history} limit={HISTORY_LIMIT} />
            )}
          </section>

          {coverKey === '' ? null : (
            <details className="flex flex-col gap-2" data-testid="cover-key">
              <summary className="min-h-11 cursor-pointer py-3 text-body text-ink">
                {KEY_REVEAL}
              </summary>
              <SurfaceGroup>
                <ListRow
                  caption={KEY_KEEP}
                  label={KEY_HEADING}
                  value={
                    <span className="flex items-center gap-1">
                      <span className="tabular-nums">{grouped(coverKey)}</span>
                      <CopyButton value={coverKey} what="cover key" />
                    </span>
                  }
                />
              </SurfaceGroup>
            </details>
          )}

          <OfflineNotice />

          <div className="flex flex-col items-start gap-5">
            {state === 'claims_open' ? (
              <PillButton
                className="w-full"
                loading={pending}
                onClick={() => startTransition(() => beginClaim(view.policyId))}
              >
                Start a claim
              </PillButton>
            ) : null}
            {state === 'claim_in_progress' ? (
              <PillLink className="w-full" href="/claim/status" variant="secondary">
                See your claim
              </PillLink>
            ) : null}
            {state === 'paid' ? (
              <PillLink
                className="w-full"
                href={`/receipt/${encodeURIComponent(view.policyId)}`}
                variant="secondary"
              >
                View receipt
              </PillLink>
            ) : null}
            {view.lapsed === null ? null : (
              <PillLink className="w-full" href="/pay">
                {view.lapsed.action}
              </PillLink>
            )}
            <TextLink href="/cover/index">See the index</TextLink>
            {demo ? null : (
              <form action={signOutOfCover}>
                <button
                  className="min-h-11 text-secondary text-ink-2 underline underline-offset-[3px]"
                  type="submit"
                >
                  {SIGN_OUT}
                </button>
              </form>
            )}
          </div>
        </main>
        <CoverTabs active="cover" />
      </div>
    </AppFrame>
  );
}

/** The key in groups of four, which is how it was printed at purchase. */
function grouped(key: string): string {
  return (key.match(/.{1,4}/g) ?? []).join(' ');
}
