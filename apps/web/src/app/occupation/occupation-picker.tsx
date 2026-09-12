'use client';

import { useMemo, useState } from 'react';

import { AppFrame } from '../../components/app-frame';
import { FormField } from '../../components/form-field';
import { ListRow } from '../../components/list-row';
import { PillButton } from '../../components/pill-button';
import { SurfaceGroup } from '../../components/surface-group';
import {
  BAND_COUNT,
  filterOccupations,
  fundedBandCount,
  groupOccupations,
  hasCover,
  type FundedBands,
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
 *
 * Since cover is sold in three bands of experience, capacity is committed to an
 * occupation and a band together, and "can this be bought" has forty five
 * answers rather than fifteen. The split above is now "is any band funded", and
 * a row whose occupation is funded at some lengths of experience and not others
 * says so in a word. Which bands, and what each costs, is the next screen's
 * question; this one only has to stop somebody choosing an occupation that
 * nothing at all stands behind.
 */

export function OccupationPicker({
  rows,
  chosen,
  funded,
}: {
  rows: readonly Occupation[];
  chosen: string | null;
  /** What capital has chosen, per occupation. Absent when the read failed. */
  funded?: FundedBands;
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(chosen);
  const groups = useMemo(
    () => groupOccupations(filterOccupations(query, rows), funded),
    [query, rows, funded],
  );
  const nothing = groups.open.length === 0 && groups.noCover.length === 0;

  const renderRow = (row: Occupation) => {
    const available = hasCover(row, funded);
    return (
      <ListRow
        caption={captionFor(row, funded)}
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
 * What a row says under its name, which is now nothing at all unless the
 * occupation cannot be bought.
 *
 * It used to carry two facts about the occupation's history: that claims had
 * never opened for it since 2010, and that its level line had never been
 * reached since 2000, so only a sudden jump would open claims. Both are true
 * and both were cut to a single short sentence before Root asked for them to
 * go entirely. Five rows of fifteen carried one or both and ten carried
 * nothing, which made a chooser look like a list of warnings and made the
 * occupations with nothing said about them look like the safe ones, which is
 * the opposite of the truth.
 *
 * Neither fact is lost. A chooser is for choosing, and the place to read what
 * an occupation's index has done is the index: the explorer says "This cover
 * has never paid for this occupation since 2010." for exactly the series that
 * have not, and the worker's index tab explains that claims open in two ways,
 * a sudden jump or staying worse. `levelLineNeverReached` stays on the record
 * in src/lib/occupations.ts for whatever wants to say it next.
 *
 * What remains is the one line that is about the transaction rather than the
 * history: an occupation with no capacity behind it cannot be bought, and a
 * row that cannot be chosen has to say why. Since T39 issued capacity for all
 * fifteen it renders nowhere today, and it stays for the deployment where that
 * is not true.
 */
export function captionFor(row: Occupation, funded?: FundedBands): string | undefined {
  if (!hasCover(row, funded)) return NO_COVER_YET;
  const count = fundedBandCount(row, funded);
  // Nothing when every band is funded, and nothing when the read did not
  // happen. A partly funded occupation is the only case worth a word here, and
  // it gets a count rather than a list: which bands, and what each costs, is
  // the question the next screen exists to answer.
  return count === null || count === BAND_COUNT
    ? undefined
    : `Funded for ${count} of ${BAND_COUNT} experience bands.`;
}
