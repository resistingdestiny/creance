import { Fragment, Suspense, use } from 'react';

import type { LandingExplorerView, Streamed } from '../../lib/landing-data';
import { CoverCardShell } from '../cover-card';
import { PlainChart } from '../plain-chart';
import { Skeleton } from '../skeleton';
import { StatusPill } from '../status-pill';

/**
 * When does it pay, as a sum you watch being made.
 *
 * The copy is Root's own and does not change: levels of job loss rise in your
 * occupation, and you lose your job, and you get paid. Two conditions and a
 * result, which is a sum, so it is drawn as one and the operators are real.
 *
 * What changed is everything around the words. This was three grey boxes of
 * one line each in a 337px band, and three grey boxes is not a picture of
 * anything: a person who did not already understand the product learned
 * nothing from looking at it, and it could not carry the front door. Each
 * condition now stands in a panel tall enough to show what it means, and the
 * thing it shows is the product's own drawing rather than an illustration of
 * it:
 *
 * - the index crossing its line is the real chart, the same `PlainChart` the
 *   explorer draws fifteen of, on the real history of the occupation this page
 *   is about, with the real frozen threshold and the same two reds. It is not
 *   a sketch of a chart. If the feed cannot be read the panel keeps its words
 *   and loses its picture, which is why the chart is the only part of this
 *   section inside a boundary;
 * - losing the job is the notice that proves it, which is the document a claim
 *   is actually filed with;
 * - getting paid is the cover card from the top of this page, the same object,
 *   now carrying a paid pill. The payoff of the sum is the thing the visitor
 *   was looking at ninety seconds earlier.
 *
 * Deliberately not said here: that the rise is caused by AI. The index fires
 * on any cause and cannot tell them apart, so the hero's promise is the
 * framing and this is the mechanism, and the mechanism may not claim something
 * it does not measure.
 *
 * The motion is in globals.css under `.pay-step`. There is still no observer
 * and no scroll listener on this page.
 */

/** The three lines, which are the acceptance and are not to be reworded. */
const STEPS = [
  'Job losses rise in your occupation',
  'You lose your job',
  'You get paid',
] as const;

export function PaySteps({
  explorer,
  group,
}: {
  explorer: Streamed<LandingExplorerView>;
  group: string;
}) {
  return (
    <section className="mx-5 pb-20 pt-20 lg:mx-10 lg:pb-28 lg:pt-28">
      <div className="mx-auto flex w-full max-w-[1080px] flex-col gap-10 lg:gap-14">
        <h2 className="font-display text-title font-semibold tracking-title text-ink lg:text-landing-ledger lg:tracking-landing-ledger">
          When does it pay.
        </h2>
        {/* The operators are aria-hidden and the list carries the meaning for a
            reader who is not seeing it, which is why the steps are an ordered
            list rather than three divs with symbols between them. */}
        <ol className="flex flex-col items-stretch gap-4 lg:flex-row lg:gap-5">
          {STEPS.map((step, index) => (
            <Fragment key={step}>
              {index === 0 ? null : (
                <li
                  aria-hidden="true"
                  className={`pay-mark flex shrink-0 items-center justify-center font-display text-title text-ink-3 lg:text-headline ${
                    index === STEPS.length - 1 ? 'pay-mark-2' : ''
                  }`}
                >
                  {index === STEPS.length - 1 ? '=' : '+'}
                </li>
              )}
              <li
                className={`pay-step pay-step-${String(index + 1)} flex flex-1 flex-col justify-between gap-8 rounded-hero px-6 pb-6 pt-6 lg:min-h-[440px] lg:px-8 lg:pb-8 lg:pt-8 ${
                  index === STEPS.length - 1 ? 'bg-ink text-canvas' : 'bg-surface text-ink'
                }`}
              >
                {/* One fixed band for all three pictures rather than three
                    boxes each as tall as whatever is in it. Without it the
                    chart, the notice and the card each centred in their own
                    panel and the three sat at three different heights, which
                    reads as a row that was assembled rather than drawn. */}
                <div className="flex h-[168px] items-center justify-center lg:h-[268px]">
                  {index === 0 ? (
                    <Suspense fallback={<TriggerResting />}>
                      <TriggerGraphic explorer={explorer} group={group} />
                    </Suspense>
                  ) : index === 1 ? (
                    <NoticeGraphic />
                  ) : (
                    <PaidGraphic />
                  )}
                </div>
                <p className="text-body-lg font-medium lg:text-landing-lead">{step}</p>
              </li>
            </Fragment>
          ))}
        </ol>
      </div>
    </section>
  );
}

function figureOf<T>(value: Streamed<T>): T {
  return value !== null && typeof (value as Promise<T>).then === 'function'
    ? use(value as Promise<T>)
    : (value as T);
}

/**
 * The index against its line, on the occupation this page is about.
 *
 * `PlainChart` is the explorer's own drawing: no axis, no dots, no gridlines,
 * and the band is the same two reds as everywhere else in the product, so the
 * red above the line here means what the red above the line means on /index.
 * The chart is aria-hidden and carries no label, because the sentence under it
 * says what it shows, which is the rule the four steps on the explorer follow.
 *
 * It renders nothing at all when the round could not be read. A panel that
 * keeps its sentence and loses its picture is a page with one less thing on
 * it; a panel that draws a made up line would be a page that lies.
 */
function TriggerGraphic({
  explorer,
  group,
}: {
  explorer: Streamed<LandingExplorerView>;
  group: string;
}) {
  const round = figureOf(explorer).round;
  const occupation = round?.occupations.find((entry) => entry.key === group) ?? null;
  if (occupation === undefined || occupation === null) return null;
  // The newest four years. The panel is 360 wide and the explorer's own read is
  // sixty months, which at this size is a month every six pixels: the shape of
  // the rise disappears into the noise of it. Four years still carries the
  // climb and the approach to the line, which is what the sentence under it
  // claims. The explorer beside this section draws the whole history.
  const points = occupation.months.slice(-48).map((month) => ({
    period: month.period,
    value: month.value,
  }));
  if (points.length === 0) return null;

  return (
    <figure className="m-0 flex w-full flex-col">
      <div className="pay-draw h-[112px] w-full lg:h-[196px]">
        <PlainChart
          height={196}
          points={points}
          strokeWidth={1.8}
          threshold={occupation.line}
          width={360}
        />
      </div>
      {/* The one label the picture needs, and it is the band's own name from
          docs/DESIGN-TOKENS.md section 5 rather than a caption written here. */}
      <figcaption className="mt-4 flex items-center gap-2 text-caption text-ink-2">
        {/* The band's own two reds, as a swatch. Its outline is a border,
            because the utility that would otherwise draw it emits a box
            shadow, and built-css.test.ts holds the rule that this surface
            carries none but its one permitted elevation. Watch the wording
            here as well as the classes: Tailwind v4 takes candidates out of
            prose, so naming that utility in this comment is enough to emit it
            and fail the same test. The fill is heavier than the band's 6
            percent because a 10px square at 6 percent is not there at all. */}
        <span
          aria-hidden="true"
          className="h-2.5 w-2.5 rounded-[3px] border border-triggered/40 bg-triggered/15"
        />
        Claims open
      </figcaption>
    </figure>
  );
}

function TriggerResting() {
  return (
    <div className="flex w-full flex-col">
      <Skeleton className="h-[112px] w-full lg:h-[196px]" />
      <Skeleton className="mt-4 h-[18px] w-28" />
    </div>
  );
}

/**
 * The notice, which is the document a claim is filed with.
 *
 * Redacted rather than written: a sample letter with words in it would be a
 * page inventing an employer and a name, and the shape is what is being shown.
 * The bars are the only decoration on this page that stands for text, and they
 * are aria-hidden with the heading read instead.
 */
function NoticeGraphic() {
  return (
    <div className="pay-notice w-full max-w-[280px] rounded-group border border-hairline bg-canvas px-5 py-5">
      <p className="text-caption font-medium text-ink">Notice of termination</p>
      <div aria-hidden="true" className="mt-4 flex flex-col gap-2">
        <span className="h-2 w-full rounded-full bg-hairline" />
        <span className="h-2 w-[86%] rounded-full bg-hairline" />
        <span className="h-2 w-[64%] rounded-full bg-hairline" />
      </div>
      <div className="mt-5">
        <StatusPill state="triggered">Claim open</StatusPill>
      </div>
    </div>
  );
}

/**
 * The cover card, paid.
 *
 * The same object the hero stands on, at a quarter of the size and with the
 * paid pill on it, so the end of the sum is the thing the visitor was looking
 * at at the top of the page. It is the still finish and not the shimmering
 * one: the addendum allows one shimmering element in view at a time and the
 * hero has spent it.
 *
 * The amount is the page's own default cover, which the hero card carries and
 * the quote opens on. It is an example on both, and it is the same example.
 */
function PaidGraphic() {
  return (
    <CoverCardShell className="pay-card w-full max-w-[300px]" metal="still">
      <div className="cover-card__content flex flex-col gap-6">
        <div className="flex items-start justify-between gap-3">
          <p className="max-w-[180px] text-secondary font-medium text-ink">
            Computer and mathematical
          </p>
          <StatusPill state="covered">Paid</StatusPill>
        </div>
        <div className="flex flex-col gap-1">
          <p className="text-secondary text-ink">Cover</p>
          <p className="font-display text-display-l font-semibold tracking-display tabular-nums text-ink">
            5,000
          </p>
        </div>
      </div>
    </CoverCardShell>
  );
}
