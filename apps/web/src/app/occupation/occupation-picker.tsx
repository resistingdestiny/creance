'use client';

import { useMemo, useState } from 'react';

import { AppFrame } from '../../components/app-frame';
import { FormField } from '../../components/form-field';
import { ListRow } from '../../components/list-row';
import { PillButton } from '../../components/pill-button';
import { SurfaceGroup } from '../../components/surface-group';
import { filterOccupations, hasCover, type Occupation } from '../../lib/occupations';
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
 * them anything.
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
  const visible = useMemo(() => filterOccupations(query, rows), [query, rows]);

  return (
    <AppFrame>
      <main className="flex min-h-dvh flex-col gap-6 px-5 py-10">
        <h1 className="text-title font-display font-semibold tracking-title text-ink">
          What do you do?
        </h1>
        <FormField
          autoComplete="off"
          label="Search occupations"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search occupations"
          type="search"
          value={query}
        />

        {visible.length === 0 ? (
          <p className="text-secondary text-ink-2">
            Nothing matches that. This cover is sold by occupation group, not by job title.
          </p>
        ) : (
          <SurfaceGroup>
            {visible.map((row) => {
              const available = hasCover(row);
              const caption = captionFor(row);
              return (
                <ListRow
                  caption={caption}
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
            })}
          </SurfaceGroup>
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
 * What a row says under its name. Both lines are facts, not marketing: the
 * first is capacity, the second is the backtest in docs/INDEX.md.
 */
export function captionFor(row: Occupation): string | undefined {
  const lines: string[] = [];
  if (!hasCover(row)) lines.push('No cover behind this occupation yet.');
  if (row.lastOpenPeriod === null) {
    lines.push('Claims have never opened for this occupation since 2010.');
  }
  return lines.length === 0 ? undefined : lines.join(' ');
}
