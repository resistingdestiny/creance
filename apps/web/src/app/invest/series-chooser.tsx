import type { SeriesListEntry } from '../../lib/investor-api';
import { seriesName } from '../../lib/investor-model';

/**
 * The series an investor can open, from GET /v1/series.
 *
 * Both investor screens used to carry one series id as a constant, so there
 * was nothing to choose from and the second series was reachable only by
 * typing a query string. The list is the API's own, so a series registered on
 * chain appears here without a deploy of the web app.
 *
 * Each choice is named for what it covers, because `ODI-TRAN-2026-01` tells a
 * person nothing about whether it is the series behind their occupation. The
 * identifier is still on screen: it is the title of the series the choice
 * opens. A series whose group this bundle cannot name falls back to the
 * identifier rather than to a guess.
 *
 * Plain links, not a select. The screens are server rendered and each series
 * is a different read of the chain, so the choice is a navigation and there is
 * nothing for the browser to do.
 */

export interface SeriesChooserProps {
  choices: readonly SeriesListEntry[];
  /** The series on screen, which is drawn as the current one. */
  current: string;
  /** The route the links point at, without a query string. */
  base: string;
}

export function SeriesChooser({ choices, current, base }: SeriesChooserProps) {
  if (choices.length < 2) return null;
  return (
    <nav aria-label="Series" className="mt-6 flex flex-wrap gap-2">
      {choices.map((choice) => {
        const chosen = choice.series_id === current;
        const name = seriesName(choice);
        return (
          <a
            aria-current={chosen ? 'page' : undefined}
            className={[
              'inline-flex min-h-11 items-center rounded-full border px-4 text-secondary tabular-nums transition-opacity duration-200 ease-out hover:opacity-70 motion-reduce:transition-none',
              chosen ? 'border-transparent bg-ink text-canvas' : 'border-hairline text-ink',
            ].join(' ')}
            href={`${base}?series=${encodeURIComponent(choice.series_id)}`}
            key={choice.series_id}
            // The identifier for anyone who came looking for one, on a link
            // whose label is the occupation.
            title={choice.series_id}
          >
            {name ?? choice.series_id}
          </a>
        );
      })}
    </nav>
  );
}
