import { Suspense, use, type ReactNode } from 'react';

import { DesktopFrame } from '../../components/desktop-frame';
import { Skeleton } from '../../components/skeleton';
import { StatusPill } from '../../components/status-pill';
import { TextLink } from '../../components/text-link';
import {
  ACTIVITY_SOURCES,
  activitySource,
  hashscanSourceUrl,
  type ActivityEntry,
  type ActivitySourceKey,
} from '../../lib/activity-model';
import { PER_SOURCE_ON_A_PAGE, type ActivityFeed } from '../../lib/activity-data';
import { formatAge, formatInstant } from '../../lib/format';
import type { Streamed } from '../../lib/investor-data';

/**
 * The activity page: everything this product has done on Hedera testnet, newest
 * first, one line each.
 *
 * Why the page exists. All of this product's record is on testnet and none of it
 * was visible from the outside. The index page cites the topic its months settle
 * on, the investor board links each vault, a receipt links its own bind, and a
 * reader who wanted to know whether any of it was real had to collect those one
 * at a time. This is the one place that answers it: the product running, live,
 * with every line clickable through to the chain.
 *
 * A list and not cards. Fifty rows of four short fields is a scanning job, and
 * scanning is what a column of times down the left edge is for. The same
 * argument the market board makes for a table applies here with more force,
 * because these rows are not being compared with each other, they are being read
 * in order.
 *
 * Every line links out. The link is the identifier under the sentence, the way
 * the market board puts each series' id under its name, and it goes to the
 * transaction on HashScan: a topic message to the transaction that submitted it,
 * a contract call to the call itself. HashScan has no page for a topic message
 * on its own, so the submit transaction is the record, which is the form
 * docs/HEDERA.md uses whenever it cites a sequence number.
 *
 * The filter and the paging are in the address, not in state. That is the
 * decision src/app/invest/market-board.tsx made for its sort, for the same
 * reasons: the server does the work, nothing waits on hydration, and a judge can
 * send somebody a link to the thing they just watched happen.
 *
 * It is the light ground with hairline depth of docs/DESIGN-TOKENS.md, in the
 * desktop frame, which is what `/index` and `/invest` stand in.
 */

/**
 * What the page says when nothing could be read. The first line is a heading and
 * the second is the promise this whole product makes about figures: nothing on
 * screen is remembered, so when the chain cannot be read there is nothing to
 * show. It is the public explorer's wording, because it is the same promise.
 */
export const NO_ACTIVITY = {
  title: 'Hedera is not answering.',
  line: 'Nothing on this page is shown from memory, so there is nothing to show. Try again.',
} as const;

const PAGE_LINE = 'Everything this product does on Hedera testnet, newest first.';

export interface ActivityScreenProps {
  feed: Streamed<ActivityFeed>;
  /** Which of the seven places is being shown, or all of them. */
  filter: ActivitySourceKey | null;
  /** The cursor this page was reached with, so it can offer the way back to the live edge. */
  before: string | null;
  /** The moment the ages on screen are measured against. */
  now: number;
}

export function ActivityScreen({ feed, filter, before, now }: ActivityScreenProps) {
  return (
    <DesktopFrame current="activity">
      <header className="flex flex-col gap-1 border-b border-hairline pb-6">
        <h1 className="text-title font-display font-semibold tracking-title text-ink lg:text-landing-head lg:tracking-display">
          Activity
        </h1>
        <p className="text-body text-ink-2">{PAGE_LINE}</p>
      </header>

      <Filters filter={filter} />

      <Suspense fallback={<Resting />}>
        <Feed before={before} feed={feed} filter={filter} now={now} />
      </Suspense>
    </DesktopFrame>
  );
}

/**
 * The figure, or the figure once it arrives. The route hands this screen a
 * promise so the heading and the filters are on the first byte and nobody looks
 * at a white screen while seven reads are in flight; a test hands it the value
 * and the same components render it with no boundary in between. It is the
 * helper the investor screens already use, for the same reason.
 */
function figureOf<T>(value: Streamed<T>): T {
  return value !== null && typeof (value as Promise<T>).then === 'function'
    ? use(value as Promise<T>)
    : (value as T);
}

function Feed({
  before,
  feed,
  filter,
  now,
}: {
  before: string | null;
  feed: Streamed<ActivityFeed>;
  filter: ActivitySourceKey | null;
  now: number;
}) {
  const view = figureOf(feed);

  if (view.entries.length === 0) {
    return (
      <div className="mt-10 flex flex-col gap-2">
        <p className="font-display text-title font-semibold tracking-title text-ink">
          {view.unread.length === 0 ? 'Nothing to show here yet.' : NO_ACTIVITY.title}
        </p>
        <p className="text-body text-ink-2">
          {view.unread.length === 0
            ? 'Nothing has been written to this part of the chain in the window this page reads.'
            : NO_ACTIVITY.line}
        </p>
        {before === null ? null : (
          <p className="text-body">
            <TextLink href={href(filter, null)}>Back to the newest</TextLink>
          </p>
        )}
      </div>
    );
  }

  return (
    <>
      <ActivityTable entries={view.entries} now={now} />

      <div className="mt-6 flex flex-wrap items-center gap-6 text-body">
        {before === null ? null : <TextLink href={href(filter, null)}>Back to the newest</TextLink>}
        {/* The way back through the history is endless by construction, so it
            is marked for a crawler not to walk it. A reader follows it; a
            crawler that followed it would walk to the first day of testnet. */}
        {view.older === null ? null : (
          <TextLink href={href(filter, view.older)} rel="nofollow">
            Older activity
          </TextLink>
        )}
      </div>

      <Provenance view={view} />
    </>
  );
}

/** The address for a filter and a place in the history. */
function href(filter: ActivitySourceKey | null, before: string | null): string {
  const query = new URLSearchParams();
  if (filter !== null) query.set('source', filter);
  if (before !== null) query.set('before', before);
  const text = query.toString();
  return text === '' ? '/activity' : `/activity?${text}`;
}

/**
 * Which of the seven places to show.
 *
 * Links and not buttons, for the reasons the market board's column headings are
 * links: the server filters, it works before hydration, and a filtered page can
 * be sent to somebody. Choosing a place always returns to the newest of it,
 * because a cursor taken in one place means nothing in another.
 */
function Filters({ filter }: { filter: ActivitySourceKey | null }) {
  return (
    <nav aria-label="Filter by where it happened" className="mt-6 flex flex-wrap gap-2">
      {[null, ...ACTIVITY_SOURCES.map((source) => source.key)].map((key) => {
        const active = key === filter;
        return (
          <a
            aria-current={active ? 'page' : undefined}
            className={`inline-flex min-h-11 items-center rounded-full border px-4 text-secondary no-underline transition-colors duration-200 ease-out motion-reduce:transition-none ${
              active
                ? 'border-ink bg-surface font-medium text-ink'
                : 'border-hairline bg-canvas text-ink-2 hover:bg-surface hover:text-ink'
            }`}
            href={href(key, null)}
            key={key ?? 'all'}
          >
            {key === null ? 'Everything' : activitySource(key).label}
          </a>
        );
      })}
    </nav>
  );
}

/**
 * The stream itself.
 *
 * Four columns at the desktop width. At 390 the amount and the place fold away
 * and the two that carry the page stay: when it happened and what happened, with
 * the link to the record inside the second.
 *
 * The two that stay carry no minimum width, unlike the market board's, and that
 * is deliberate. The board can be scrolled sideways because its far columns are
 * extra figures; here the thing in the second column is the link out, which is
 * the one thing every line has to offer, and a link a phone reader has to scroll
 * to find is a link they will not find. So the sentence wraps instead. The
 * region is still scrollable and focusable for the desktop width, where the four
 * columns do have a measure.
 */
function ActivityTable({ entries, now }: { entries: readonly ActivityEntry[]; now: number }) {
  return (
    <div
      aria-label="On chain activity"
      className="mt-8 overflow-x-auto"
      role="region"
      tabIndex={0}
    >
      {/* Fixed layout below the desktop breakpoint so the two columns divide the
          width a phone has rather than the width their longest line wants, and
          the sentence wraps instead of the table growing past the screen. From
          lg the four columns have room and the browser measures them. */}
      <table className="w-full table-fixed border-collapse text-body lg:table-auto lg:min-w-[56rem]">
        <caption className="sr-only">
          Everything this product has done on Hedera testnet, newest first, each line linking to
          the record on HashScan
        </caption>
        <thead>
          <tr className="border-b border-hairline">
            <Th className="w-32 lg:w-auto">When</Th>
            <Th>What happened</Th>
            <Th numeric wide>
              Amount
            </Th>
            <Th wide>Where</Th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr className="border-b border-hairline align-top" key={entry.key}>
              <Td>
                <span className="flex flex-col gap-0.5 whitespace-nowrap">
                  <span>{formatAge(entry.at, now)}</span>
                  <span className="text-caption text-ink-2">{formatInstant(entry.at)}</span>
                </span>
              </Td>
              <Td>
                <Happened entry={entry} />
              </Td>
              <Td numeric wide>
                {entry.amount}
              </Td>
              <Td wide>
                <span className="whitespace-nowrap text-ink-2">
                  {activitySource(entry.source).label}
                </span>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * What happened, and where the same thing can be read without this page.
 *
 * The sentence is composed in src/lib/activity-model.ts and not here, so nothing
 * on screen is a phrase this file invented. Under it is the one fact that tells
 * this line from the one above it, and the link out, which every line carries
 * because a line a reader cannot check is a line they have to take on trust.
 *
 * A refused call is still a line. The chain refusing a transfer to somebody who
 * has not been through the compliance check is the control working, and it is
 * evidence in exactly the way a settled one is.
 */
function Happened({ entry }: { entry: ActivityEntry }) {
  return (
    <span className="flex flex-col gap-1 py-1">
      <span className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 text-ink">{entry.title}</span>
        {entry.refused ? <StatusPill state="triggered">Refused</StatusPill> : null}
      </span>
      <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-caption text-ink-2">
        {entry.detail === null ? null : (
          <span className="min-w-0 break-all tabular-nums">{entry.detail}</span>
        )}
        {entry.href === null ? null : (
          <a
            className="underline-offset-[3px] hover:underline"
            href={entry.href}
            rel="noreferrer"
            target="_blank"
          >
            See it on HashScan
          </a>
        )}
      </span>
    </span>
  );
}

function Th({
  children,
  className,
  numeric = false,
  wide = false,
}: {
  children: ReactNode;
  className?: string;
  numeric?: boolean;
  wide?: boolean;
}) {
  return (
    <th
      className={[
        'h-10 px-4 text-secondary font-normal text-ink-2 first:pl-0 last:pr-0',
        numeric ? 'text-right tabular-nums whitespace-nowrap' : 'text-left',
        wide ? 'hidden lg:table-cell' : undefined,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      scope="col"
    >
      {children}
    </th>
  );
}

function Td({
  children,
  numeric = false,
  wide = false,
}: {
  children: ReactNode;
  numeric?: boolean;
  wide?: boolean;
}) {
  return (
    <td
      className={[
        'py-3 px-4 text-ink first:pl-0 last:pr-0',
        numeric ? 'text-right tabular-nums whitespace-nowrap' : 'text-left',
        wide ? 'hidden lg:table-cell' : undefined,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </td>
  );
}

/**
 * Where the lines came from, and where the same records can be read without this
 * page.
 *
 * It is the block `/index` and `/invest` both end on, for the reason they have
 * one: a record a reader cannot check is a record they have to take on trust.
 * Here it also does a second job, which is to say what the seven places are,
 * since the "Where" column only has room for one word each.
 */
function Provenance({ view }: { view: ActivityFeed }) {
  return (
    <div className="mt-10 flex flex-col gap-3 border-t border-hairline pt-6 text-caption text-ink-2">
      <p>
        Read from Hedera testnet through the public mirror node at{' '}
        <span className="text-ink">{formatInstant(view.readAt)}</span>. Nothing on this page is
        stored by this product and nothing is shown from memory.
      </p>
      {/* The one thing on the page that is not simply newest first, said where a
          reader will look for it. Payments outnumbers everything else many times
          over, so a page of everything holds it back to leave room for the rest;
          choosing a place shows that place with nothing left out. */}
      {view.capped ? (
        <p>
          One place can fill a page on its own, so no place takes more than{' '}
          {String(PER_SOURCE_ON_A_PAGE)} lines here. Choose a place above to see all of it.
        </p>
      ) : null}
      <ul className="flex flex-col gap-1">
        {ACTIVITY_SOURCES.map((source) => (
          <li key={source.key}>
            <span className="text-ink">{source.label}</span>, {source.what}:{' '}
            <TextLink href={hashscanSourceUrl(source)} rel="noreferrer" target="_blank">
              {source.id}
            </TextLink>
          </li>
        ))}
      </ul>
      {view.unread.length === 0 ? null : (
        <p>
          {view.unread.map((key) => activitySource(key).label).join(', ')} could not be read when
          this page was built, so nothing from{' '}
          {view.unread.length === 1 ? 'it' : 'them'} is shown.
        </p>
      )}
      <p>
        The settlement token every amount here moves is TUSD on testnet, and the whole deployment
        is testnet only.
      </p>
    </div>
  );
}

/**
 * The page at the height it stands at once the lines are in it: the filter row
 * is already drawn above this, so what rests is the heading row and fifty rows,
 * with the provenance block under them. A line landing changes what is in a
 * space and never how much space there is.
 */
function Resting() {
  return (
    <div className="mt-8" data-testid="activity-resting">
      <Skeleton className="h-10 w-full" />
      <Skeleton className="mt-2 h-[1200px] w-full" />
      <Skeleton className="mt-10 h-40 w-full max-w-[720px]" />
    </div>
  );
}
