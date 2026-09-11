'use client';

import { useMemo, useState } from 'react';

import { AppFrame } from '../../components/app-frame';
import { FormField } from '../../components/form-field';
import { ListRow } from '../../components/list-row';
import { PillButton } from '../../components/pill-button';
import { SurfaceGroup } from '../../components/surface-group';
import {
  filterOccupations,
  groupOccupations,
  hasCover,
  type Occupation,
} from '../../lib/occupations';
import { chooseOccupation } from '../purchase-actions';

/**
 * "What do you do?" and "Search occupations", docs/DESIGN-TOKENS.md section 8.
 *
 * The search field is a filter over the fifteen labels: case-insensitive
 * substring, no fuzzy matching, no synonyms. A person who types a job title
 * gets nothing, which is honest, because the product covers occupation groups.
 *
 * Tapping a row selects it and does not navigate. Being thrown forward by a tap
 * is the standard way to make a picker feel like a trap, so "Continue" is its
 * own control at the bottom.
 *
 * Capacity is committed per occupation (docs/DECISIONS.md), so fourteen of the
 * fifteen have no series behind them and cannot be chosen. The row says so
 * rather than quoting a price nobody can buy. Where the backtest shows claims
 * have never opened for an occupation since 2010 the row says that too: it is
 * the one fact a buyer most needs and it is on the first screen that offers
 * them anything. Where the whole published history shows the level line has
 * never been reached, the row says that beside it (T56), so a distance to that
 * line is never read as a countdown.
 *
 * T38 puts the list in that shape: the one occupation that can be bought comes
 * first under its own heading, and the fourteen sink to the bottom under
 * theirs. A search filters first and groups after, so a query that matches
 * only unbuyable occupations still shows them rather than looking like nothing
 * matched. The landing quote groups the same list the same way.
 */

export function OccupationPicker({
  rows,
  chosen,
}: {
  rows: readonly Occupation[];
  chosen: string | null;
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(chosen);
  const groups = useMemo(() => groupOccupations(filterOccupations(query, rows)), [query, rows]);
  const nothing = groups.open.length === 0 && groups.noCover.length === 0;

  const renderRow = (row: Occupation) => {
    const available = hasCover(row);
    return (
      <ListRow
        caption={captionFor(row)}
        key={row.key}
        label={
          <span className={available ? 'text-body text-ink' : 'text-body text-ink-2'}>
            {row.label}
          </span>
        }
        onSelect={available ? () => setSelected(row.key) : undefined}
        trailing={selected === row.key ? 'check' : 'none'}
      />
    );
  };

  return (
    <AppFrame>
      <main className="flex min-h-frame flex-col gap-6 px-5 py-10">
        <h1 className="text-title font-display font-semibold tracking-title text-ink">
          What do you do?
        </h1>
        {/* No placeholder. FormField's rule is that every field has a visible
            label and the placeholder is never a substitute for it, and a
            placeholder repeating the label word for word is the label printed
            twice. */}
        <FormField
          autoComplete="off"
          label="Search occupations"
          onChange={(event) => setQuery(event.target.value)}
          type="search"
          value={query}
        />

        {nothing ? (
          <p className="text-secondary text-ink-2">
            Nothing matches that. This cover is sold by occupation group, not by job title.
          </p>
        ) : (
          /* The headings name two parts of a split list, so they are drawn
             only where the list is actually split. Since T39 issued capacity
             for all fifteen there is usually one part, and "Open to buy (15)"
             over every occupation there is names nothing: a heading that
             cannot be contrasted with anything is a label on the page. */
          <div className="flex flex-col gap-6">
            {groups.open.length === 0 ? null : (
              <section className="flex flex-col gap-2">
                {groups.noCover.length === 0 ? null : (
                  <h2 className="text-secondary font-medium text-ink">
                    {occupationGroupHeading('open', groups.open.length)}
                  </h2>
                )}
                <SurfaceGroup>{groups.open.map(renderRow)}</SurfaceGroup>
              </section>
            )}
            {groups.noCover.length === 0 ? null : (
              <section className="flex flex-col gap-2">
                <h2 className="text-secondary font-medium text-ink">
                  {occupationGroupHeading('noCover', groups.noCover.length)}
                </h2>
                <SurfaceGroup>{groups.noCover.map(renderRow)}</SurfaceGroup>
              </section>
            )}
          </div>
        )}

        <form action={chooseOccupation} className="mt-auto flex flex-col gap-3">
          <input name="group" type="hidden" value={selected ?? ''} />
          <p className="text-secondary text-ink-2">
            You tell us your occupation. We do not check it against an employer.
          </p>
          <PillButton disabled={selected === null} type="submit">
            Continue
          </PillButton>
        </form>
      </main>
    </AppFrame>
  );
}

/**
 * What a row says when nothing has been committed to its occupation. It is
 * exported because the landing page's inline quote says the same thing in the
 * same words when such an occupation is the one in hand (T35), and one string
 * is the only way two surfaces cannot come to word it differently.
 */
export const NO_COVER_YET = 'No cover behind this occupation yet.';

/**
 * The heading over one part of the grouped list, with how many are in it.
 * One open row above fourteen with nothing behind them is a stark list, and
 * T38 states it rather than dressing it up. Exported for the same reason as
 * NO_COVER_YET: the landing quote groups the same list (T35), and the two
 * surfaces word the parts the same way or not at all.
 */
export function occupationGroupHeading(part: 'open' | 'noCover', count: number): string {
  return part === 'open' ? `Open to buy (${count})` : `No cover behind these yet (${count})`;
}

/**
 * What a row says when its level line has never been reached in the published
 * history, 2000 to 2026 (T56). The occupation can still open claims, because
 * the shock form is independent of the level form and does open; what the
 * sentence stops is a buyer reading a distance to that line as a countdown.
 *
 * It used to name the span, "never been reached in the published history since
 * 2000", and say what follows from it in a second clause. Five of the fifteen
 * rows carry this and ten carry nothing, so at three lines each it made the
 * list look broken rather than honest. The claim a buyer has to hear is the
 * consequence, and it is the same claim in a third of the words. The span it
 * was measured over is on the index page, which is where a reader who wants to
 * check it is going anyway. Exported so the test and the copy deck can hold it
 * to one string.
 */
export const LEVEL_LINE_NEVER_REACHED = 'Only a sudden jump would open claims here.';

/**
 * What a row says under its name. Every line is a fact, not marketing: the
 * first is capacity, the second is the backtest in docs/INDEX.md, the third
 * is the whole published history since 2000.
 *
 * Both history lines are cut to their consequence for the same reason, and
 * they collapse into one another: an occupation whose claims have never opened
 * and whose level line has never been reached does not need to be told twice
 * that nothing has happened to it.
 */
export function captionFor(row: Occupation): string | undefined {
  const lines: string[] = [];
  if (!hasCover(row)) lines.push(NO_COVER_YET);
  const neverOpened = row.lastOpenPeriod === null;
  if (neverOpened) lines.push('Claims have never opened here.');
  // Both lines together said "claims" twice and "here" twice in one breath.
  // After the first sentence the subject is already claims and the place is
  // already here, so the second says only what it adds.
  if (row.levelLineNeverReached) {
    lines.push(neverOpened ? 'Only a sudden jump would.' : LEVEL_LINE_NEVER_REACHED);
  }
  return lines.length === 0 ? undefined : lines.join(' ');
}
