import type { ReactNode } from 'react';

import { DesktopFrame } from '../../components/desktop-frame';
import { PillLink } from '../../components/pill-button';
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
 * This file is the page: the replay bar, the header, the heading and the
 * attribution panel under it. The explorer itself is ExplorerPanel, which the
 * landing page renders too (T34), so the behaviour is written once and the two
 * pages cannot drift apart.
 *
 * It is the light ground with hairline depth of docs/DESIGN-TOKENS.md. The
 * marketing surface tokens belong to the landing page and are not used here.
 * Since T50 it stands in the same desktop frame as the investor screens, with
 * the product's header in its day tone and "Get cover" as the header's action,
 * so the two light desktop pages are one construction and the wordmark and the
 * heading start on the same line. This page had a header of its own before,
 * which was the seed of the shared one.
 */

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
    <div className="flex flex-1 flex-col">
      {data.replayBadge === null ? null : <ReplayBar label={data.replayBadge} />}

      <DesktopFrame action={<PillLink href="/">Get cover</PillLink>} current="index">
        <main className="flex flex-col gap-10">
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
        </main>

        {attribution === null ? null : <section className="pt-10">{attribution}</section>}
      </DesktopFrame>
    </div>
  );
}
