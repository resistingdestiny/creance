
import { DesktopFrame } from '../../components/desktop-frame';
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
 * This file is the page: the replay bar, the header and the heading. The
 * explorer itself is ExplorerPanel, which the landing page renders too (T34),
 * so the behaviour is written once and the two pages cannot drift apart.
 *
 * It is the light ground with hairline depth of docs/DESIGN-TOKENS.md. The
 * marketing surface tokens belong to the landing page and are not used here.
 * Since T50 it stands in the same desktop frame as the investor screens, under
 * the product's header, so the two desktop pages are one construction and the
 * wordmark and the heading start on the same line. This page had a header of
 * its own before, which was the seed of the shared one; its "Get cover" went
 * with T52, when the header's action became "Get a quote" on every route.
 */

export function ExplorerScreen({ data }: { data: ExplorerData }) {
  const empty = data.occupations.length === 0;

  return (
    <div className="flex flex-1 flex-col">
      {data.replayBadge === null ? null : <ReplayBar label={data.replayBadge} />}

      <DesktopFrame current="index">
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
                Pick your occupation and drag through the last five years to see how close it has
                come to paying out.
              </p>
            )}
          </div>

          {/* Straight under the h1, so the method steps are this page's h2s. */}
          {empty ? null : <ExplorerPanel data={data} stepHeading="h2" />}
        </main>
      </DesktopFrame>
    </div>
  );
}
