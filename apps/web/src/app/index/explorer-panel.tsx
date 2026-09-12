'use client';

import { useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

import { ExplorerChart } from '../../components/explorer-chart';
import { Check, ChevronRight } from '../../components/icons';
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
  settledLead,
  stateOf,
  stateWord,
  type ExplorerMonth,
  type ExplorerOccupation,
  type ExplorerState,
  type MethodStep,
} from '../../lib/explorer-model';
import { formatAmount, formatPeriod, formatPeriodShort } from '../../lib/format';
import { CHOOSE_OCCUPATION, filterOccupations } from '../../lib/occupations';

/**
 * The substance of the public index explorer: the picker, the verdict for the
 * occupation and month in hand, the five year chart, the price for that month
 * across the full width under them both, the four steps that build the number
 * and the provenance under those.
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

/**
 * The capacity slider's stops, in whole percent.
 *
 * There is no default. The slider opens at the occupation's own utilisation,
 * read live from `GET /v1/cover/bands` and carried on the round, so the price
 * above it is the price the API would quote for that occupation and not a
 * position somebody chose. It used to open at a flat 45 for every one of the
 * fifteen, which made this the only surface in the product that disagreed with
 * the quote, the market board and the series page, and it did so under a
 * caption naming the real series the capacity supposedly came from.
 *
 * The reader can still move it, and the moment they do the block says the
 * number is a what if and says where the live one is.
 */
const CAPACITY_MAX = 100;
const CAPACITY_STEP = 1;

/**
 * The occupation the panel opens on when nobody has said otherwise.
 *
 * It has capacity behind it, so the price under it is a premium somebody can
 * pay rather than a guide price, and its claims have opened before, so a reader
 * who has never seen the index meets a series with something to watch.
 *
 * This is the explorer's own opening only. The occupation a quote starts on is
 * LANDING_GROUP in src/lib/landing-model.ts, which the hero card, the from
 * price and the quote all read: the two are deliberately separate, because the
 * panel may be pointed at any of the fifteen and the quote may not (T35).
 */
const OPENS_ON = 'arts_design_ent_media';

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
  stepHeading = 'h3',
}: {
  data: ExplorerData;
  /**
   * The heading level of the four method steps, which is the level under the
   * heading this panel sits beneath. The landing page puts the panel under an
   * h2, so its steps are h3s; `/index` puts it straight under its h1, so the
   * steps there are h2s (T53). The panel itself has no heading of its own, so
   * the caller says where in the outline it stands.
   */
  stepHeading?: 'h2' | 'h3';
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
  /**
   * Where the reader has dragged the capacity slider, in whole percent, or null
   * while it is still where the occupation's own utilisation put it. Null is
   * not a synonym for nought: it is the difference between the live price and a
   * what if, and it is what the two captions under the slider turn on.
   */
  const [capacity, setCapacity] = useState<number | null>(null);

  // React's own way to adjust state when a prop changes, rather than an effect
  // that would paint the old occupation for a frame first.
  // https://react.dev/learn/you-might-not-need-an-effect
  const [followed, setFollowed] = useState(follows);
  if (follows !== followed) {
    setFollowed(follows);
    if (follows !== null && follows !== chosen) {
      setChosen(follows);
      setCapacity(null);
    }
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

  /**
   * The occupation's own utilisation, as a fraction, or null when the free
   * capacity read did not answer for it. Null costs the block its market price
   * and its slider and leaves the guide price, which is the price before
   * capital has said what it will take the risk for: a guide price labelled as
   * one is true, and a market price struck at a utilisation nobody read is not.
   */
  const live = data.utilisation[occupation.key] ?? null;
  const used = capacity === null ? (live ?? 0) : capacity / 100;
  const price = priceFor(month?.distance ?? null, used);

  function pick(index: number) {
    const next = occupations[index];
    if (next === undefined) return;
    setChosen(next.key);
    // The slider belongs to the occupation under it. A what if carried across
    // a pick would price the next occupation at the last one's capacity.
    setCapacity(null);
  }

  return (
    <div className="flex flex-col gap-10">
      <Picker
        current={occupation}
        matches={matches}
        occupations={occupations}
        onPick={pick}
        onQuery={setQuery}
        query={query}
      />

      <div
        className="grid gap-10 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] lg:gap-14"
        data-testid="explorer-columns"
      >
        <Verdict month={month} occupation={occupation} state={state} />

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
          {/* One line under the chart, and one fact where there is one to
              state. Everything else that stood here said again what the
              verdict beside it, the band caption on the chart and the four
              steps behind the number already say. */}
          <p className="text-secondary text-ink-2">
            Up is towards a payout, and the red band is where claims open.
          </p>
          {occupation.everOpened ? null : (
            <p className="text-secondary text-ink-2">
              This cover has never paid for this occupation since 2010.
            </p>
          )}
        </div>
      </div>

      <Price
        buyable={occupation.buyable}
        capacity={capacity}
        live={live}
        onCapacity={setCapacity}
        price={price}
        seriesId={occupation.seriesId}
      />

      <Disclosure summary="How this number is built">
        <ol className="flex flex-col gap-8">
          {methodSteps(occupation, month).map((step, position) => (
            <Step
              heading={stepHeading}
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
 * The occupation chooser: one row that says which occupation is on screen, and
 * a panel under it with the search box and the fifteen occupations in the
 * addendum's picker order.
 *
 * It was the search box over a wall of fifteen pills wrapping four rows deep,
 * which was the first thing on both pages and pushed the verdict below the
 * fold (T52). A person picking one of fifteen things needs a control and a
 * clear statement of what is picked, not every option at once, so the row is
 * the statement and the panel is the control. The panel is in the markup at
 * all times and hidden with the attribute, so both pages still carry every
 * occupation and every one is still a button; opening the row shows them.
 *
 * Keyboard, in full. The row is a button with `aria-expanded`; Enter or Space
 * opens the panel and puts the caret in the search box; typing filters; the
 * arrow keys walk the options, Home and End jump to the ends, Enter in the
 * box picks the first match, Escape closes and returns focus to the row; Tab
 * walks the same options in order and leaving the whole control closes it.
 * Pointer: press the row, press an option. Options keep the caret in the
 * search box while they are pressed, because a browser that does not focus a
 * button on press would otherwise close the panel under the pointer before
 * the press lands.
 *
 * Every option is a button with `aria-pressed`, so the keyboard and the focus
 * outline are the base layer's, and each carries the state dot for the newest
 * published month. The panel floats under the row rather than pushing the page
 * down, and it is a hairline border on canvas: no shadow, as the sheet says.
 *
 * The word for a focus outline is spelt out rather than abbreviated on purpose:
 * Tailwind scans this file for candidates and would compile the bare utility
 * out of a comment, which built-css.test.ts refuses because it sets a shadow.
 */
function Picker({
  current,
  matches,
  occupations,
  onPick,
  onQuery,
  query,
}: {
  matches: readonly ExplorerOccupation[];
  occupations: readonly ExplorerOccupation[];
  onPick: (index: number) => void;
  onQuery: (query: string) => void;
  query: string;
  /** The occupation on screen, which the row names. */
  current: ExplorerOccupation;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const labelId = useId();
  const valueId = useId();
  const root = useRef<HTMLDivElement>(null);
  const row = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  const currentState = stateOf(latestMonth(current));
  const selected = current.key;

  function show() {
    setOpen(true);
    // The panel is hidden until the state lands, so the caret is placed once
    // it has: a frame later is the earliest the box can take it.
    requestAnimationFrame(() => search.current?.focus());
  }

  function hide(returnFocus: boolean) {
    setOpen(false);
    onQuery('');
    if (returnFocus) row.current?.focus();
  }

  function choose(occupation: ExplorerOccupation) {
    onPick(occupations.findIndex((entry) => entry.key === occupation.key));
    hide(true);
  }

  /** The option buttons the panel is showing, in order. */
  function options(): HTMLButtonElement[] {
    return [...(list.current?.querySelectorAll('button') ?? [])];
  }

  function moveFocus(from: HTMLElement, step: 1 | -1 | 'first' | 'last') {
    const all = options();
    if (all.length === 0) return;
    const at = all.indexOf(from as HTMLButtonElement);
    const next =
      step === 'first'
        ? all[0]
        : step === 'last'
          ? all[all.length - 1]
          : all[(at + step + all.length) % all.length];
    next?.focus();
  }

  function onSearchKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveFocus(event.currentTarget, 'first');
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveFocus(event.currentTarget, 'last');
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const first = matches[0];
      if (first !== undefined) choose(first);
    }
  }

  function onOptionKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveFocus(event.currentTarget, 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveFocus(event.currentTarget, -1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      moveFocus(event.currentTarget, 'first');
    } else if (event.key === 'End') {
      event.preventDefault();
      moveFocus(event.currentTarget, 'last');
    }
  }

  return (
    <div
      className="flex flex-col gap-2"
      onBlur={(event) => {
        // Focus left the whole control, for anywhere but inside it.
        if (open && !root.current?.contains(event.relatedTarget as Node | null)) hide(false);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.preventDefault();
          hide(true);
        }
      }}
      ref={root}
    >
      {/* The control is a bordered box carrying an occupation's name, which on
          a page whose heading is also an occupation's name reads as a subtitle
          rather than as something to press. Every other field in the product
          carries a visible label above it at the secondary scale, so this one
          does too, and it says what pressing it does rather than naming the
          thing it holds. The button takes its accessible name from the label
          and then from its own contents, so it is announced as "Choose an
          occupation, Arts, design, entertainment and media". */}
      <span className="text-secondary text-ink-2" id={labelId}>
        {CHOOSE_OCCUPATION}
      </span>
      <div className="relative">
        <button
          aria-controls={panelId}
          aria-expanded={open}
          aria-labelledby={`${labelId} ${valueId}`}
          className="flex min-h-13 w-full items-center justify-between gap-3 rounded-xl border border-hairline bg-canvas px-4 text-left text-body text-ink transition-colors duration-200 ease-out hover:border-ink-3 hover:bg-surface motion-reduce:transition-none lg:w-auto lg:min-w-[400px]"
          id={valueId}
          onClick={() => (open ? hide(true) : show())}
          ref={row}
          type="button"
        >
          <span className="flex items-center gap-2">
            <span aria-hidden="true" className={`size-1.5 rounded-full ${DOT[currentState]}`} />
            <span className="font-medium">{current.label}</span>
            <span className="sr-only">, {stateWord(currentState).toLowerCase()}</span>
          </span>
          <ChevronRight className={`shrink-0 transition-transform duration-200 ease-out motion-reduce:transition-none ${open ? '-rotate-90' : 'rotate-90'}`} />
        </button>

      <div
        className="absolute left-0 right-0 top-full z-20 mt-2 flex max-h-[420px] flex-col gap-2 overflow-y-auto rounded-2xl border border-hairline bg-canvas p-2 lg:right-auto lg:w-[400px]"
        hidden={!open}
        id={panelId}
      >
        <label className="flex flex-col gap-2">
          <span className="sr-only">Search occupations</span>
          <input
            autoComplete="off"
            className="h-13 w-full rounded-xl border border-hairline bg-surface px-4 text-body text-ink placeholder:text-ink-3"
            onChange={(event) => onQuery(event.target.value)}
            onKeyDown={onSearchKey}
            placeholder="Search occupations"
            ref={search}
            type="search"
            value={query}
          />
        </label>

        {matches.length === 0 ? (
          <p className="px-3 py-2 text-body text-ink-2">No occupation matches that.</p>
        ) : (
          <ul className="flex flex-col" ref={list}>
            {matches.map((occupation) => {
              const state = stateOf(latestMonth(occupation));
              const chosen = occupation.key === selected;
              return (
                <li key={occupation.key}>
                  <button
                    aria-pressed={chosen}
                    className={`flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-body transition-colors duration-200 ease-out motion-reduce:transition-none ${
                      chosen ? 'bg-surface font-medium text-ink' : 'text-ink hover:bg-surface'
                    }`}
                    onClick={() => choose(occupation)}
                    onKeyDown={onOptionKey}
                    onPointerDown={(event) => event.preventDefault()}
                    type="button"
                  >
                    <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${DOT[state]}`} />
                    <span className="flex-1">{occupation.label}</span>
                    <span className="sr-only">, {stateWord(state).toLowerCase()}</span>
                    {chosen ? <Check className="shrink-0" /> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        </div>
      </div>
    </div>
  );
}

/** The verdict for the chosen occupation and month: where it stands, in words. */
function Verdict({
  month,
  occupation,
  state,
}: {
  month: ExplorerMonth | null;
  occupation: ExplorerOccupation;
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
    </div>
  );
}

/**
 * The price block. The guide price is what the cover has to charge to fund
 * itself: the risk this occupation carries, which is the part the index
 * measures, plus the cost of the capital held against the cover, which is the
 * same for every occupation and is the larger of the two. The market price is
 * what capital that chose this occupation will take it for on top of that.
 *
 * Both parts are on the screen. The guide price alone would tell a reader
 * comparing two occupations almost nothing, because the capital charge they
 * share swamps the difference between them, and the difference is the whole of
 * what the index has to say.
 *
 * Capacity is committed per occupation (docs/DECISIONS.md), so an occupation
 * with no series behind it shows the guide price and says plainly that there is
 * nothing to buy, rather than quoting a premium nobody can pay. An occupation
 * whose capacity could not be read shows the guide price too, and says that
 * instead: a market price needs a utilisation, and one nobody read would be a
 * quote struck at a number this page made up.
 *
 * The slider opens at the occupation's live utilisation, so the premium on the
 * screen is the premium the API would quote. Moving it is a what if, and it
 * says so from the first move: the label over the number names the capacity it
 * was struck at and the caption under the slider names the live one.
 *
 * It stands the full width of the panel, under both columns, rather than in the
 * narrow column beside the chart. It carries the premium, which is the thing a
 * buyer came for, and at a third of the width under a five year chart it read
 * as a footnote to the chart. The price and the capacity that moves it sit side
 * by side at desktop width and stack at phone width.
 */
function Price({
  buyable,
  capacity,
  live,
  onCapacity,
  price,
  seriesId,
}: {
  buyable: boolean;
  /** Where the reader dragged the slider, or null while it is on the live value. */
  capacity: number | null;
  /** The occupation's own utilisation as a fraction, or null when unread. */
  live: number | null;
  onCapacity: (value: number) => void;
  price: ReturnType<typeof priceFor>;
  seriesId: string | null;
}) {
  const capacityId = useId();
  if (price === null) return null;

  // A market price needs a utilisation. Without one the block shows the guide
  // price and says so, which is the same rule an occupation with no series
  // behind it follows one line above.
  const quoted = buyable && live !== null;
  const usedPercent = capacity ?? (live === null ? 0 : live * 100);
  const livePercent = live === null ? null : percent(live * 100);
  const moved = capacity !== null;

  return (
    <div
      className="flex flex-col gap-6 rounded-2xl border border-hairline bg-surface p-5 lg:flex-row lg:items-center lg:justify-between lg:gap-14 lg:p-6"
      data-testid="explorer-price"
    >
      <div className="flex flex-col gap-1">
        <span className="text-secondary text-ink-2">
          {quoted
            ? moved
              ? `Monthly premium at ${percent(usedPercent)} percent used, for ${formatAmount(price.cover)} of cover`
              : `Monthly premium for ${formatAmount(price.cover)} of cover`
            : `Guide price for ${formatAmount(price.cover)} of cover`}
        </span>
        <span className="font-display text-title font-semibold tracking-title tabular-nums text-ink">
          {quoted ? price.monthly : price.guide}
        </span>
        {quoted ? (
          <>
            <span className="text-caption text-ink-2">
              Guide price {price.guide}, of which {price.risk} is this occupation&rsquo;s own risk.
              Capital adds {String(price.addOn)} percent for how full the pool is.
            </span>
            {/* Why a price this close to the line is not closer to the limit.
                The premium looks small beside the cover until you know that
                two things have to happen, not one. This is the sentence that
                answers it, and it sits with the number rather than in a note
                further down the page, because it is the number it explains. */}
            <span className="text-caption text-ink-2">
              A payout needs two things: the index opens for your occupation, and you lose the
              job involuntarily while it is open.
            </span>
          </>
        ) : null}
      </div>

      {quoted ? (
        <div className="flex flex-col gap-2 lg:w-[380px] lg:shrink-0">
          <label className="text-secondary text-ink-2" htmlFor={capacityId}>
            How much capital wants this risk
          </label>
          <input
            aria-valuetext={`${percent(usedPercent)} percent of this pool already used`}
            className="amount-slider h-11"
            id={capacityId}
            max={CAPACITY_MAX}
            min={0}
            onChange={(event) => onCapacity(Number(event.target.value))}
            step={CAPACITY_STEP}
            style={{
              ['--amount-slider-filled' as string]: `${String((usedPercent / CAPACITY_MAX) * 100)}%`,
            }}
            type="range"
            value={Math.round(usedPercent)}
          />
          {/* The live figure never leaves the block. Before the slider is
              touched the caption says the number above it was read from the
              series; after it is touched the caption is where the live figure
              still stands, so a reader can always get back to the real one. */}
          <span className="flex items-baseline justify-between gap-4 text-caption text-ink-2">
            <span className="tabular-nums">
              {percent(usedPercent)} percent of this pool already used
            </span>
            {seriesId === null ? null : (
              <span>
                {moved
                  ? `${seriesId} is at ${livePercent ?? '0'} percent.`
                  : `Read from ${seriesId}.`}
              </span>
            )}
          </span>
        </div>
      ) : buyable ? (
        <p className="text-caption text-ink-2 lg:max-w-[380px]">
          How much of this occupation&rsquo;s capacity is already used could not be read, so this
          is the guide price rather than a quote.
        </p>
      ) : (
        <p className="text-caption text-ink-2 lg:max-w-[380px]">
          No cover is on sale for this occupation today. Capacity is committed one occupation at a
          time, and none has been committed to this one.
        </p>
      )}
    </div>
  );
}

/**
 * A share of a pool, in whole percent where it is one and to two places where
 * it is not.
 *
 * Utilisation is published to four places, so a series at 0.8866 is at 88.66
 * percent and not at 89. The price above the caption is struck at the exact
 * figure, so a caption that rounded it would be naming a capacity the number
 * was not priced at.
 */
function percent(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

/** One of the four steps, with its own chart. */
function Step({
  heading: Heading,
  month,
  numeral,
  occupation,
  step,
}: {
  heading: 'h2' | 'h3';
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
        <Heading className="text-body-lg font-medium text-ink">{step.title}</Heading>
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
            {settledLead(provenance.published, provenance.groups, provenance.deepest)}{' '}
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
