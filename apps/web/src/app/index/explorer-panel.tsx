'use client';

import { useId, useMemo, useState, type ReactNode } from 'react';

import { ExplorerChart } from '../../components/explorer-chart';
import { ChevronRight } from '../../components/icons';
import { PlainChart } from '../../components/plain-chart';
import { StatusPill } from '../../components/status-pill';
import { TextLink } from '../../components/text-link';
import type { ExplorerData } from '../../lib/explorer-data';
import {
  bandCaption,
  chartName,
  clampMonth,
  headlineFor,
  latestMonth,
  latestMonthIndex,
  meterFraction,
  methodSteps,
  positionSentence,
  priceFor,
  rankByDistance,
  stateOf,
  stateWord,
  type ExplorerMonth,
  type ExplorerOccupation,
  type ExplorerState,
  type MethodStep,
} from '../../lib/explorer-model';
import { formatAmount, formatPeriod, formatPeriodShort } from '../../lib/format';
import { filterOccupations } from '../../lib/occupations';

/**
 * The substance of the public index explorer: the picker, the verdict for the
 * occupation and month in hand, the five year chart, the four steps that build
 * the number and the provenance under them.
 *
 * It is a component rather than part of `/index` because two pages render it.
 * `/index` is the page of record and the landing page carries the same explorer
 * (T34), and they carry the same one: the behaviour is not drawn twice, so a
 * change to the picker or the price cannot be true on one page and stale on the
 * other.
 *
 * Everything on it arrives in `data`, already read from the API on Hedera
 * testnet, and every sentence is composed in src/lib/explorer-model.ts. This
 * file holds no arithmetic and no figure of its own, so nothing here can print
 * a number nobody published.
 *
 * It is the light ground with hairline depth of docs/DESIGN-TOKENS.md, on both
 * pages. The marketing surface tokens belong to the landing page's own bands
 * and are not used here.
 *
 * Motion. Everything that moves on a user action moves in 200ms ease-out; the
 * one exception is the chart line, which tweens up to 520ms when the reader
 * picks another occupation. Nothing animates on scroll: there is no observer
 * and no scroll listener anywhere in this file, because on a data dense page
 * they read as flicker and in a screen recording as a rendering glitch.
 *
 * The heading above it belongs to the page: `/index` gives it the page's own
 * h1 and the landing gives it a section heading, so neither page has to borrow
 * the other's heading level.
 */

/** The capacity slider's stops, in whole percent. */
const CAPACITY_MAX = 95;
const CAPACITY_STEP = 5;
const CAPACITY_DEFAULT = 45;

/**
 * The occupation the panel opens on when nobody has said otherwise. It is the
 * one group with a series behind it, which is the same group the landing page
 * speaks for.
 */
const OPENS_ON = 'computer_math';

const DOT: Record<ExplorerState, string> = {
  covered: 'bg-covered',
  watch: 'bg-watch',
  open: 'bg-triggered',
};

const PILL: Record<ExplorerState, 'covered' | 'watch' | 'triggered'> = {
  covered: 'covered',
  watch: 'watch',
  open: 'triggered',
};

/**
 * What either page says when no reading could be bought at all. The strings
 * live here, beside the page that would otherwise be empty, so that the two
 * pages cannot come to say it differently.
 */
export const NO_READINGS = {
  title: 'The index is not answering.',
  line: 'Nothing on this page is shown from memory, so there is nothing to show. Try again.',
} as const;

export function ExplorerPanel({
  data,
  follows = null,
}: {
  data: ExplorerData;
  /**
   * An occupation the panel follows, for a page that has a second reason to
   * name one. The landing page passes the occupation its inline quote is for,
   * so picking an occupation to be quoted and looking at that occupation's
   * index are one act rather than two (T35). `/index` passes nothing and keeps
   * its own selection entirely.
   *
   * It is followed rather than obeyed: the reader can still pick any of the
   * fifteen here afterwards, and the next thing the quote names moves the panel
   * again. That way the panel is never a control with two owners.
   */
  follows?: string | null;
}) {
  const occupations = data.occupations;
  const [chosen, setChosen] = useState(follows ?? OPENS_ON);
  const [query, setQuery] = useState('');
  const [capacity, setCapacity] = useState(CAPACITY_DEFAULT);

  // React's own way to adjust state when a prop changes, rather than an effect
  // that would paint the old occupation for a frame first.
  // https://react.dev/learn/you-might-not-need-an-effect
  const [followed, setFollowed] = useState(follows);
  if (follows !== followed) {
    setFollowed(follows);
    if (follows !== null) setChosen(follows);
  }

  /**
   * The month the reader has scrubbed to, remembered against the occupation it
   * belongs to. A pick therefore lands on the month the feed published rather
   * than on whichever month the reader last dragged to, without an effect
   * having to reset anything.
   */
  const [scrub, setScrub] = useState<{ key: string; at: number } | null>(null);

  const found = occupations.findIndex((entry) => entry.key === chosen);
  const occupation = occupations[found === -1 ? 0 : found];

  const ranked = useMemo(() => rankByDistance(occupations), [occupations]);
  const matches = useMemo(() => {
    const keys = new Set(filterOccupations(query).map((row) => row.key));
    return occupations.filter((row) => keys.has(row.key));
  }, [occupations, query]);

  if (occupation === undefined) {
    return (
      <div className="flex flex-col gap-2">
        <p className="font-display text-title font-semibold tracking-title text-ink">
          {NO_READINGS.title}
        </p>
        <p className="text-body text-ink-2">{NO_READINGS.line}</p>
      </div>
    );
  }

  const at =
    scrub !== null && scrub.key === occupation.key ? scrub.at : latestMonthIndex(occupation);
  const month = occupation.months[clampMonth(occupation, at)] ?? null;
  const state = stateOf(month);
  const price = priceFor(month?.distance ?? null, capacity / 100);

  function pick(index: number) {
    const next = occupations[index];
    if (next === undefined) return;
    setChosen(next.key);
  }

  return (
    <div className="flex flex-col gap-10">
      <Picker
        matches={matches}
        occupations={occupations}
        onPick={pick}
        onQuery={setQuery}
        query={query}
        selected={occupation.key}
      />

      <div className="grid gap-10 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] lg:gap-14">
        <Verdict
          capacity={capacity}
          month={month}
          occupation={occupation}
          onCapacity={setCapacity}
          price={price}
          state={state}
        />

        <div className="flex flex-col gap-3">
          <ExplorerChart
            at={clampMonth(occupation, at)}
            caption={bandCaption(occupation)}
            name={chartName(occupation, month)}
            onScrub={(next) => setScrub({ key: occupation.key, at: clampMonth(occupation, next) })}
            points={occupation.months.map((entry) => ({
              period: entry.period,
              value: entry.value,
              open: entry.open,
            }))}
            scrubLabel={`Month, ${occupation.label}`}
            threshold={occupation.line}
            tweenKey={occupation.key}
          />
          <p className="text-secondary text-ink-2">
            The line rises when unemployment in a job rises faster than everyone else&apos;s. Up is
            towards a payout, and the red band is where claims open.
          </p>
          {occupation.form === 'level' && occupation.line < 0 ? (
            <p className="text-secondary text-ink-2">
              People in this occupation are usually unemployed less than average. The trigger is
              about getting worse than their own normal, not about being above zero.
            </p>
          ) : null}
          {occupation.everOpened ? null : (
            <p className="text-secondary text-ink-2">
              This cover has never paid for this occupation since 2010.
            </p>
          )}
        </div>
      </div>

      <Disclosure summary="How this number is built">
        <ol className="flex flex-col gap-8">
          {methodSteps(occupation, month).map((step, position) => (
            <Step
              key={step.title}
              month={month}
              numeral={position + 1}
              occupation={occupation}
              step={step}
            />
          ))}
        </ol>
      </Disclosure>

      <Disclosure summary="Every occupation, closest to opening first">
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ranked.map((row) => (
            <li key={row.occupation.key}>
              <button
                className={`flex min-h-11 w-full flex-col gap-1 rounded-2xl border p-4 text-left transition-colors duration-200 ease-out motion-reduce:transition-none ${
                  row.occupation.key === occupation.key
                    ? 'border-ink bg-surface'
                    : 'border-hairline bg-canvas hover:bg-surface'
                }`}
                onClick={() =>
                  pick(occupations.findIndex((entry) => entry.key === row.occupation.key))
                }
                type="button"
              >
                <span className="text-secondary font-medium text-ink">{row.occupation.label}</span>
                <span className="flex items-center gap-2 text-caption text-ink-2">
                  <span aria-hidden="true" className={`size-1.5 rounded-full ${DOT[row.state]}`} />
                  {row.gap}, {stateWord(row.state).toLowerCase()}
                </span>
                <span className="mt-2 h-10 w-full">
                  <PlainChart
                    height={40}
                    points={row.occupation.months.map((entry) => ({
                      period: entry.period,
                      value: entry.value,
                    }))}
                    threshold={row.occupation.line}
                    width={200}
                  />
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Disclosure>

      <Provenance data={data} />
    </div>
  );
}

/**
 * The search box and the fifteen chips, in the addendum's picker order.
 *
 * Every chip is a button, so the keyboard and the focus outline are the base
 * layer's, and each carries the state dot for the newest published month.
 *
 * The word for a focus outline is spelt out rather than abbreviated on purpose:
 * Tailwind scans this file for candidates and would compile the bare utility
 * out of a comment, which built-css.test.ts refuses because it sets a shadow.
 */
function Picker({
  matches,
  occupations,
  onPick,
  onQuery,
  query,
  selected,
}: {
  matches: readonly ExplorerOccupation[];
  occupations: readonly ExplorerOccupation[];
  onPick: (index: number) => void;
  onQuery: (query: string) => void;
  query: string;
  selected: string;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-hairline bg-surface p-4">
      <label className="flex flex-col gap-2">
        <span className="sr-only">Search occupations</span>
        <input
          autoComplete="off"
          className="h-13 w-full rounded-xl border border-hairline bg-canvas px-4 text-body text-ink placeholder:text-ink-3"
          onChange={(event) => onQuery(event.target.value)}
          placeholder="Search occupations"
          type="search"
          value={query}
        />
      </label>

      {matches.length === 0 ? (
        <p className="text-body text-ink-2">No occupation matches that.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {matches.map((occupation) => {
            const state = stateOf(latestMonth(occupation));
            return (
              <li key={occupation.key}>
                <button
                  aria-pressed={occupation.key === selected}
                  className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-secondary transition-colors duration-200 ease-out motion-reduce:transition-none ${
                    occupation.key === selected
                      ? 'border-ink bg-ink text-white'
                      : 'border-hairline bg-canvas text-ink hover:bg-surface'
                  }`}
                  onClick={() =>
                    onPick(occupations.findIndex((entry) => entry.key === occupation.key))
                  }
                  type="button"
                >
                  <span aria-hidden="true" className={`size-1.5 rounded-full ${DOT[state]}`} />
                  {occupation.label}
                  <span className="sr-only">, {stateWord(state).toLowerCase()}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** The verdict for the chosen occupation and month, and what it costs. */
function Verdict({
  capacity,
  month,
  occupation,
  onCapacity,
  price,
  state,
}: {
  capacity: number;
  month: ExplorerMonth | null;
  occupation: ExplorerOccupation;
  onCapacity: (value: number) => void;
  price: ReturnType<typeof priceFor>;
  state: ExplorerState;
}) {
  const fraction = meterFraction(occupation, month);
  const sentence = positionSentence(occupation, month);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <p className="text-secondary text-ink-2">
          {occupation.label}
          {month === null ? '' : `, ${formatPeriod(month.period)}`}
        </p>
        <p
          className={`font-display text-headline font-semibold tracking-headline tabular-nums lg:text-display-l lg:tracking-display ${
            state === 'open' ? 'text-triggered' : 'text-ink'
          }`}
        >
          {headlineFor(month)}
        </p>
        {sentence === null ? null : <p className="text-body text-ink-2">{sentence}</p>}
        <span>
          <StatusPill state={PILL[state]}>{stateWord(state)}</StatusPill>
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <div
          aria-hidden="true"
          className="h-2 w-full overflow-hidden rounded-full bg-surface"
          data-testid="explorer-meter"
        >
          <div
            className={`h-full rounded-full transition-[width] duration-200 ease-out motion-reduce:transition-none ${DOT[state]}`}
            style={{ width: `${String(Math.round(fraction * 100))}%` }}
          />
        </div>
        <div className="flex justify-between text-caption text-ink-2">
          <span>Payout</span>
          <span>Far from a payout</span>
        </div>
      </div>

      <Price
        capacity={capacity}
        buyable={occupation.buyable}
        onCapacity={onCapacity}
        price={price}
        seriesId={occupation.seriesId}
      />
    </div>
  );
}

/**
 * The price block. The guide price is what the index says the risk is worth;
 * the market price is what capital that chose this occupation will take it for.
 *
 * Capacity is committed per occupation (docs/DECISIONS.md), so an occupation
 * with no series behind it shows the guide price and says plainly that there is
 * nothing to buy, rather than quoting a premium nobody can pay.
 */
function Price({
  buyable,
  capacity,
  onCapacity,
  price,
  seriesId,
}: {
  buyable: boolean;
  capacity: number;
  onCapacity: (value: number) => void;
  price: ReturnType<typeof priceFor>;
  seriesId: string | null;
}) {
  const capacityId = useId();
  if (price === null) return null;

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-hairline bg-surface p-4">
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-secondary text-ink-2">
          {buyable ? 'Monthly premium' : 'Guide price'} for {formatAmount(price.cover)} of cover
        </span>
        <span className="text-body-lg font-medium tabular-nums text-ink">
          {buyable ? price.monthly : price.guide}
        </span>
      </div>

      {buyable ? (
        <>
          <p className="text-caption text-ink-2">
            Guide price {price.guide} from the index. Capital adds {String(price.addOn)} percent.
          </p>
          <div className="flex flex-col gap-2">
            <label className="text-secondary text-ink-2" htmlFor={capacityId}>
              How much capital wants this risk
            </label>
            <input
              aria-valuetext={`${String(capacity)} percent of this pool already used`}
              className="amount-slider h-11"
              id={capacityId}
              max={CAPACITY_MAX}
              min={0}
              onChange={(event) => onCapacity(Number(event.target.value))}
              step={CAPACITY_STEP}
              style={{
                ['--amount-slider-filled' as string]: `${String((capacity / CAPACITY_MAX) * 100)}%`,
              }}
              type="range"
              value={capacity}
            />
            <span className="text-caption tabular-nums text-ink-2">
              {String(capacity)} percent of this pool already used
            </span>
          </div>
          {seriesId === null ? null : (
            <p className="text-caption text-ink-2">Capacity from {seriesId}.</p>
          )}
        </>
      ) : (
        <p className="text-caption text-ink-2">
          No cover is on sale for this occupation today. Capacity is committed one occupation at a
          time, and none has been committed to this one.
        </p>
      )}
    </div>
  );
}

/** One of the four steps, with its own chart. */
function Step({
  month,
  numeral,
  occupation,
  step,
}: {
  month: ExplorerMonth | null;
  numeral: number;
  occupation: ExplorerOccupation;
  step: MethodStep;
}) {
  const series = (which: MethodStep['line'] | MethodStep['against']) =>
    occupation.months.map((entry) => ({
      period: entry.period,
      value:
        which === 'rate'
          ? entry.rate
          : which === 'allRate'
            ? entry.allRate
            : which === 'excess'
              ? entry.excess
              : which === 'smoothed'
                ? entry.smoothed
                : entry.value,
    }));

  return (
    <li className="grid gap-4 lg:grid-cols-2 lg:items-center">
      <div className="flex flex-col gap-2">
        <p className="text-caption text-ink-3">Step {String(numeral)}</p>
        <h3 className="text-body-lg font-medium text-ink">{step.title}</h3>
        <p className="text-body text-ink-2">{step.body}</p>
        {month === null ? null : (
          <p className="text-caption text-ink-3">
            {formatPeriodShort(occupation.months[0]?.period ?? month.period)} to{' '}
            {formatPeriodShort(occupation.months.at(-1)?.period ?? month.period)}
          </p>
        )}
      </div>
      <div className="h-25 w-full">
        <PlainChart
          against={step.against === null ? undefined : series(step.against)}
          height={100}
          points={series(step.line)}
          strokeWidth={1.5}
          threshold={step.threshold ? occupation.line : undefined}
          width={620}
        />
      </div>
    </li>
  );
}

/**
 * A native details element, shut on load. No JavaScript opens or closes it, so
 * it works before hydration and it is the platform's own disclosure for a
 * screen reader.
 */
function Disclosure({ children, summary }: { children: ReactNode; summary: string }) {
  return (
    <details className="group border-t border-hairline pt-6">
      {/* A flex summary loses the browser's own marker, so the chevron is the
          affordance and it turns a quarter when the disclosure opens. */}
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 text-body-lg font-medium text-ink [&::-webkit-details-marker]:hidden">
        <ChevronRight className="shrink-0 transition-transform duration-200 ease-out group-open:rotate-90 motion-reduce:transition-none" />
        {summary}
      </summary>
      <div className="pt-6">{children}</div>
    </details>
  );
}

/** Where the numbers came from, and where the same record can be read. */
function Provenance({ data }: { data: ExplorerData }) {
  const { provenance } = data;
  return (
    <div className="flex flex-col gap-2 border-t border-hairline pt-6 text-caption text-ink-2">
      <p>
        Newest published month{' '}
        <span className="tabular-nums text-ink">
          {provenance.asOf === null ? 'none' : formatPeriod(provenance.asOf)}
        </span>
        .{' '}
        {provenance.from === null || provenance.to === null
          ? null
          : `${String(provenance.months)} months on screen, ${formatPeriodShort(provenance.from)} to ${formatPeriodShort(provenance.to)}.`}
      </p>
      <p>Source: {provenance.source}.</p>
      <p>
        {provenance.topicId === null || provenance.hashscan === null ? (
          'The settled record is published on the index topic.'
        ) : (
          <>
            Every month is settled on Hedera topic{' '}
            <TextLink href={provenance.hashscan} rel="noreferrer" target="_blank">
              {provenance.topicId}
            </TextLink>
            , so the same figures can be read without trusting this page.
          </>
        )}
      </p>
      {data.missing.length === 0 ? null : (
        <p>
          {String(data.missing.length)} of the fifteen occupations had no reading to show when this
          page was built.
        </p>
      )}
    </div>
  );
}
