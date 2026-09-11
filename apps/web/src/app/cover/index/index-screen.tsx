import { AppFrame } from '../../../components/app-frame';
import { IndexChart, type IndexPoint } from '../../../components/index-chart';
import { ReplayBar } from '../../../components/replay-bar';
import { formatPeriodShort } from '../../../lib/format';
import type { BacktestMonth } from '../../../lib/worker-model';
import { CoverTabs } from '../../cover-tabs';

/**
 * The Index tab, with every sentence verbatim from docs/DESIGN-TOKENS.md
 * section 8 and docs/DESIGN-TOKENS-ADDENDUM.md.
 *
 * The reading at the top is the distance to a payout and not the index value.
 * docs/DECISIONS.md: a consumer is never shown a signed index value, because a
 * negative level line is correct and unreadable, and the same number framed as
 * a distance removes the sign without changing the maths.
 *
 * The last caption is how close the call was (T56): the published margin to
 * each line for the newest month, and that the first published value settles.
 * The demonstration months clear their line by less than the largest
 * correction the source has made, and a buyer deserves to find that on the
 * page rather than hear it later. It is a fact about precision, in the same
 * voice and the same element as the never-paid caption above it.
 */

export function IndexScreen({
  occupation,
  distance,
  sentence,
  points,
  threshold,
  bandLabel,
  description,
  negativeLine,
  neverOpened,
  margins = [],
  months,
  open,
  replayBadge = null,
}: {
  occupation: string;
  distance: string | null;
  sentence: string | null;
  points: readonly IndexPoint[];
  threshold: number;
  bandLabel: string;
  description: string;
  negativeLine: boolean;
  neverOpened: boolean;
  /**
   * How close the call was for the newest published month, from the feed's
   * own margins, and the sentence that the first published value settles.
   * Empty where no margin was published (T56).
   */
  margins?: readonly string[];
  months: readonly BacktestMonth[];
  open: boolean;
  /** "Replay: Jul 2026" while the demo clock is walking, null when it is live. */
  replayBadge?: string | null;
}) {
  return (
    <AppFrame>
      <div className="flex min-h-frame flex-col">
        <main className="flex flex-1 flex-col gap-8 px-5 py-10">
          <div className="flex flex-col gap-2">
            {replayBadge === null ? null : <ReplayBar label={replayBadge} variant="compact" />}
            <h1 className="text-title font-display font-semibold tracking-title text-ink">
              {occupation}
            </h1>
            {distance === null ? null : (
              <p className="text-display-xl font-display font-semibold tracking-display tabular-nums text-ink">
                {distance}
              </p>
            )}
            {sentence === null ? null : <p className="text-body-lg text-ink-2">{sentence}</p>}
          </div>

          <div className="flex flex-col gap-3">
            <IndexChart
              bandLabel={bandLabel}
              description={description}
              height={180}
              label={occupation}
              points={points}
              size="large"
              state={open ? 'triggered' : 'flat'}
              threshold={threshold}
              width={344}
            />
            {negativeLine ? (
              <p className="text-secondary text-ink-2">
                People in this occupation are usually unemployed less than average. The trigger is
                about getting worse than their own normal, not about being above zero.
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-3">
            <p className="text-body text-ink">
              It counts unemployment in your occupation, compared with everyone else&apos;s.
            </p>
            <p className="text-body text-ink">
              It is smoothed over three months, so one bad month does not move it.
            </p>
            <p className="text-body text-ink">
              It is compared with a year ago, so it shows change, not level.
            </p>
            <p className="text-body text-ink">
              Claims open in two ways. A sudden jump past this occupation&apos;s trigger line, or
              staying worse than anything in the decade before AI.
            </p>
            {/* The index reads unemployment and nothing else, so it cannot see a
                reason. A buyer weighing this cover against a worry about AI has
                to be told that in the block that explains the trigger, not
                further down the page. */}
            <p className="text-body text-ink">
              It cannot tell why anyone lost their job, and any cause counts.
            </p>
          </div>

          <WhatWouldHaveHappened months={months} />

          {neverOpened ? (
            <p className="text-secondary text-ink-2">
              This cover has never paid for this occupation since 2010.
            </p>
          ) : null}
          {margins.length === 0 ? null : (
            <p className="text-secondary text-ink-2">{margins.join(' ')}</p>
          )}
        </main>
        <CoverTabs active="index" />
      </div>
    </AppFrame>
  );
}

/**
 * One mark per published month, closed or open, oldest first.
 *
 * The two item key under it is the only legend in the whole design. It earns
 * its place: the marks are otherwise unreadable, and the alternative is a
 * second axis on a phone.
 */
function WhatWouldHaveHappened({ months }: { months: readonly BacktestMonth[] }) {
  const first = months[0];
  const last = months.at(-1);
  if (first === undefined || last === undefined) return null;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-body-lg font-medium text-ink">What would have happened</h2>
      <div aria-hidden="true" className="flex h-10 items-stretch gap-[3px]">
        {months.map((month) => (
          <span
            className={`w-full rounded-full ${month.open ? 'bg-triggered' : 'bg-hairline'}`}
            key={month.period}
          />
        ))}
      </div>
      <div className="flex justify-between text-caption text-ink-2">
        <span>{formatPeriodShort(first.period)}</span>
        <span>{formatPeriodShort(last.period)}</span>
      </div>
      <ul className="flex gap-4 text-caption text-ink-2">
        <li className="flex items-center gap-2">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-hairline" />
          No payout
        </li>
        <li className="flex items-center gap-2">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-triggered" />
          Paid out
        </li>
      </ul>
      <p className="sr-only">
        {`${months.filter((month) => month.open).length} of the ${months.length} months shown would have opened claims.`}
      </p>
    </section>
  );
}
