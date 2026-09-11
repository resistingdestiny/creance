import { Check, ChevronRight } from '../../components/icons';
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
 * One row and a disclosure, not a wall (T52). Sixteen pills wrapping four rows
 * deep were the first thing on the investor page and pushed the coupon
 * history below the fold. The row names the series on screen, and the
 * choices are a native disclosure under it: no client JS, Enter or Space on
 * the row opens it, Tab walks the links, every series is still a plain link,
 * and the one on screen carries `aria-current`. The screens are server
 * rendered and each series is a different read of the chain, so the choice is
 * a navigation and there is nothing for the browser to do.
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
  const chosen = choices.find((choice) => choice.series_id === current);
  const chosenName = chosen === undefined ? current : (seriesName(chosen) ?? chosen.series_id);
  return (
    <details className="group relative mt-6">
      {/* A flex summary loses the browser's own marker, so the chevron is the
          affordance and it turns a quarter when the disclosure opens. */}
      <summary
        className="flex min-h-13 w-full cursor-pointer list-none items-center justify-between gap-3 rounded-xl border border-hairline bg-canvas px-4 text-body font-medium text-ink transition-colors duration-200 ease-out hover:bg-surface motion-reduce:transition-none [&::-webkit-details-marker]:hidden lg:w-auto lg:min-w-[380px]"
        title={current}
      >
        {chosenName}
        <ChevronRight className="shrink-0 rotate-90 transition-transform duration-200 ease-out group-open:-rotate-90 motion-reduce:transition-none" />
      </summary>
      <nav
        aria-label="Series"
        className="absolute left-0 right-0 top-full z-20 mt-2 flex max-h-[420px] flex-col overflow-y-auto rounded-2xl border border-hairline bg-canvas p-2 lg:right-auto lg:w-[480px]"
      >
        {choices.map((choice) => {
          const here = choice.series_id === current;
          const name = seriesName(choice);
          return (
            <a
              aria-current={here ? 'page' : undefined}
              className={[
                'flex min-h-11 items-center gap-3 rounded-xl px-3 text-body no-underline transition-colors duration-200 ease-out motion-reduce:transition-none',
                here ? 'bg-surface font-medium text-ink' : 'text-ink hover:bg-surface',
              ].join(' ')}
              href={`${base}?series=${encodeURIComponent(choice.series_id)}`}
              key={choice.series_id}
              // The identifier for anyone who came looking for one, on a link
              // whose label is the occupation.
              title={choice.series_id}
            >
              <span className="flex-1">{name ?? choice.series_id}</span>
              {here ? <Check className="shrink-0" /> : null}
            </a>
          );
        })}
      </nav>
    </details>
  );
}
