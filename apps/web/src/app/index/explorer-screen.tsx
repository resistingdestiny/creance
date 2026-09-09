import type { ReactNode } from 'react';

import { ReplayBar } from '../../components/replay-bar';
import type { ExplorerData } from '../../lib/explorer-data';
import { ExplorerPanel, NO_READINGS } from './explorer-panel';

/**
 * The public index explorer: the page of record for the Occupation
 * Displacement Index.
 *
 * It opens cold. No session, no purchase, no policy, nothing behind a wallet.
 * A visitor picks one of the fifteen occupations, drags through five years of
 * published months and watches the position and the price move with them.
 *
 * This file is the page: the replay bar, the navigation, the heading and the
 * attribution panel under it. The explorer itself is ExplorerPanel, which the
 * landing page renders too (T34), so the behaviour is written once and the two
 * pages cannot drift apart.
 *
 * It is the light ground with hairline depth of docs/DESIGN-TOKENS.md. The
 * marketing surface tokens belong to the landing page and are not used here.
 */

const PAGE = 'px-5 lg:px-16';
const CONTENT = 'mx-auto w-full max-w-[1180px]';

export function ExplorerScreen({
  data,
  attribution = null,
}: {
  data: ExplorerData;
  /**
   * The attribution panel, fetched on its own path. It arrives null when that
   * read failed, and the explorer is unaffected: the index is what this page is
   * for, and the caveats beside it are never the reason a reader cannot see it.
   */
  attribution?: ReactNode;
}) {
  const empty = data.occupations.length === 0;

  return (
    <div className="flex flex-col bg-canvas">
      {data.replayBadge === null ? null : <ReplayBar label={data.replayBadge} />}

      <header className={`border-b border-hairline py-4 ${PAGE}`}>
        <div className={`flex min-h-11 items-center justify-between gap-6 ${CONTENT}`}>
          <a
            className="inline-flex min-h-11 items-center text-body font-semibold text-ink no-underline"
            href="/"
          >
            Creance
          </a>
          <nav aria-label="Main">
            <a
              className="inline-flex min-h-11 items-center text-body text-ink-2 no-underline transition-opacity duration-200 ease-out hover:text-ink motion-reduce:transition-none"
              href="/"
            >
              Get cover
            </a>
          </nav>
        </div>
      </header>

      <main className={`flex flex-col gap-10 py-12 lg:py-16 ${PAGE}`}>
        <div className={`flex flex-col gap-10 ${CONTENT}`}>
          {/* A page with nothing to show says so in its own heading, rather
              than promising five years of history above an empty panel. */}
          <div className="flex flex-col gap-4">
            <h1 className="text-balance font-display text-title font-semibold tracking-title text-ink lg:text-landing-head lg:tracking-display">
              {empty ? NO_READINGS.title : 'Find your job. See where it stands.'}
            </h1>
            {empty ? (
              <p className="text-body text-ink-2">{NO_READINGS.line}</p>
            ) : (
              <p className="max-w-[720px] text-body-lg text-ink-2">
                One number decides whether claims open for an occupation. Pick yours, then drag
                through the last five years and watch it move. Every figure here is the real public
                number.
              </p>
            )}
          </div>

          {empty ? null : <ExplorerPanel data={data} />}
        </div>
      </main>

      {attribution === null ? null : (
        <section className={`pb-12 ${PAGE}`}>
          <div className={CONTENT}>{attribution}</div>
        </section>
      )}
    </div>
  );
}
