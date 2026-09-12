'use client';

import { useState } from 'react';

import { AppFrame } from '../../components/app-frame';
import { ListRow } from '../../components/list-row';
import { PillButton } from '../../components/pill-button';
import { SurfaceGroup } from '../../components/surface-group';
import { BAND_EFFECT, BAND_QUESTION, bandCaption, type SeniorityBand } from '../../lib/bands';
import { chooseBand } from '../purchase-actions';

/**
 * "How long have you been working?", the screen between the occupation and the
 * amount.
 *
 * It asks one question and shows what each answer costs before anything is
 * pressed. A band that no capital has chosen says so on its own row, in place
 * of a price, rather than being discovered after it is tapped: being told that
 * cover does not exist for you only once you have picked yourself out of a list
 * is the worst version of this screen.
 *
 * An unfunded band is not an error and is not drawn as one. There is no red, no
 * icon and no apology: it is capital not having chosen that risk, which is a
 * true and ordinary thing about an insurance market and one that a screen
 * almost never shows. The row is simply not selectable, the way an occupation
 * with no series behind it is not selectable on the picker before it.
 *
 * The one sentence under the question is the whole of what a band does. It
 * changes the price, because it changes which capital the cover is written
 * against. It changes nothing about the trigger or the payout, which are the
 * occupation's index and the cover amount and are identical in all three
 * bands. Nothing on this screen may suggest the index knows anything about how
 * long somebody has worked, because it does not: the published data has no
 * occupation-by-age series in it at all.
 */

export interface BandChoice {
  readonly band: SeniorityBand;
  readonly label: string;
  readonly available: boolean;
  readonly reason: 'none' | 'no_capital' | 'no_free_capacity';
  /** The monthly premium, already formatted, or null when there is no price. */
  readonly premium: string | null;
}

export function ExperienceScreen({
  bands,
  chosen,
  occupation,
}: {
  bands: readonly BandChoice[];
  chosen: SeniorityBand | null;
  occupation: string;
}) {
  const [selected, setSelected] = useState<SeniorityBand | null>(chosen);
  const none = bands.every((row) => !row.available);

  return (
    <AppFrame>
      <main className="flex min-h-frame flex-col gap-6 px-5 py-10">
        <div className="flex flex-col gap-2">
          <h1 className="text-title font-display font-semibold tracking-title text-ink">
            {BAND_QUESTION}
          </h1>
          <p className="text-secondary text-ink-2">{occupation}</p>
        </div>

        <SurfaceGroup>
          {bands.map((row) => (
            <ListRow
              caption={bandCaption(row.reason)}
              key={row.band}
              label={
                <span className={row.available ? 'text-body text-ink' : 'text-body text-ink-2'}>
                  {row.label}
                </span>
              }
              onSelect={row.available ? () => setSelected(row.band) : undefined}
              trailing={selected === row.band ? 'check' : 'none'}
              /* No premium is printed for a band with no price. A dash or a
                 zero in that column would read as a cheap band rather than as
                 one that is not for sale. */
              value={row.premium === null ? null : `${row.premium} a month`}
            />
          ))}
        </SurfaceGroup>

        <p className="text-secondary text-ink-2">{BAND_EFFECT}</p>

        {none ? (
          <p className="text-secondary text-ink-2" role="status">
            No capital has chosen this occupation yet, at any length of
            experience. Nothing can be bought here today.
          </p>
        ) : null}

        <form action={chooseBand} className="mt-auto flex flex-col gap-3">
          <input name="band" type="hidden" value={selected ?? ''} />
          <PillButton disabled={selected === null} type="submit">
            Continue
          </PillButton>
        </form>
      </main>
    </AppFrame>
  );
}
