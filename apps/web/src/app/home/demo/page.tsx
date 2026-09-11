import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { AppFrame } from '../../../components/app-frame';
import { ListRow } from '../../../components/list-row';
import { PillButton } from '../../../components/pill-button';
import { SurfaceGroup } from '../../../components/surface-group';
import { TextLink } from '../../../components/text-link';
import { readCoverSession } from '../../../lib/current-cover';
import {
  DEMO_STATES,
  demoCovers,
  demoStatesEnabled,
  type DemoCover,
} from '../../../lib/demo-states';
import { signOutOfCover } from '../../purchase-actions';
import { openPublishedCover } from './actions';
import {
  DEMO_COVER_COPY,
  DEMO_HEADING,
  DEMO_KEY_LABEL,
  DEMO_LINE,
  DEMO_OPEN,
  DEMO_REFUSED,
  DEMO_STATES_HEADING,
  DEMO_STATES_HELD,
  DEMO_STATES_LINE,
  DEMO_STATE_LABELS,
  SIGN_OUT,
} from '../home-copy';

/**
 * /home/demo, the way into a cover for somebody who has bought nothing.
 *
 * The problem it answers is the plain one. Everything this product does after
 * the purchase happens on a dashboard, and the dashboard is behind a World ID
 * check or a wallet, so a reader with neither reaches the front door and stops.
 * This page is the one link that gets past that, and it holds two different
 * kinds of thing which it keeps apart in words.
 *
 * The covers are real. Each one was bound on Hedera testnet by `pnpm
 * demo:seed`, and opening one opens the same dashboard a buyer reaches, with
 * the same figures read from the same API and every one of them resolving on
 * HashScan. Nothing about the way in is weakened to make that convenient: the
 * key is a full twenty character cover key, it is checked by the API exactly as
 * a typed one is, and it opens its own cover and nothing else. What is
 * different is only that it is published rather than kept, which is a decision
 * about these covers and not a change to the mechanism.
 *
 * The states are fixtures, and are on the page because three of them have no
 * server path to force: a cover lapses when a premium goes unpaid, and a cover
 * pays out when a claim is decided, and neither can be arranged for a visitor.
 * They say so here and say so again on the screen they open.
 *
 * The page renders on the server, holds no state and needs no script: opening a
 * cover is a form that posts to the same server action the cover key field on
 * the way back in posts to. That matters more than it sounds. It means the
 * published key is in the page the server rendered rather than in the address
 * bar, so it is not in the history, not in a screenshot of the address bar and
 * not in the referrer of the next request.
 *
 * A deployment that has published nothing has no page here at all.
 */

export const metadata: Metadata = {
  title: 'The demonstration',
  // Published keys sit in this page's markup, so it stays out of the indexes.
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function DemoPage({
  searchParams,
}: {
  searchParams: Promise<{ refused?: string }>;
}) {
  const { refused } = await searchParams;
  const covers = demoCovers();
  const states = demoStatesEnabled();
  if (covers.length === 0 && !states) notFound();

  const held = (await readCoverSession()) !== null;

  return (
    <AppFrame>
      <main className="flex min-h-frame flex-col gap-8 px-5 py-10">
        <header className="flex flex-col gap-2">
          <h1 className="text-title font-display font-semibold tracking-title text-ink">
            {DEMO_HEADING}
          </h1>
          {covers.length === 0 ? null : <p className="text-body-lg text-ink-2">{DEMO_LINE}</p>}
        </header>

        {refused === undefined ? null : (
          <p className="text-body text-triggered" data-testid="demo-refused" role="status">
            {DEMO_REFUSED}
          </p>
        )}

        {covers.map((cover) => (
          <PublishedCover cover={cover} key={cover.slot} />
        ))}

        {states ? (
          <section className="flex flex-col gap-3" data-testid="demo-states">
            <h2 className="text-body-lg text-ink">{DEMO_STATES_HEADING}</h2>
            <p className="text-body text-ink-2">{DEMO_STATES_LINE}</p>
            <ul className="flex flex-col">
              {DEMO_STATES.map((state) => (
                <li key={state}>
                  <TextLink href={`/home?demo=${state}`}>
                    {DEMO_STATE_LABELS[state] ?? state}
                  </TextLink>
                </li>
              ))}
            </ul>
            {held ? (
              <div className="flex flex-col items-start gap-2">
                <p className="text-body text-ink-2">{DEMO_STATES_HELD}</p>
                <form action={signOutOfCover}>
                  <button
                    className="min-h-11 text-secondary text-ink-2 underline underline-offset-[3px]"
                    type="submit"
                  >
                    {SIGN_OUT}
                  </button>
                </form>
              </div>
            ) : null}
          </section>
        ) : null}
      </main>
    </AppFrame>
  );
}

/**
 * One published cover: what it is, the key that opens it, and the button.
 *
 * The key is shown as well as posted, in the groups of four it was issued in,
 * so that the claim the page makes is checkable. A reader can type it into the
 * cover key field on /home and reach the same dashboard, which is the whole
 * point: there is no second way in here that an ordinary person does not have.
 */
function PublishedCover({ cover }: { cover: DemoCover }) {
  const copy = DEMO_COVER_COPY[cover.slot];
  return (
    <section className="flex flex-col gap-4" data-testid={`demo-cover-${cover.slot}`}>
      <div className="flex flex-col gap-2">
        <h2 className="text-body-lg text-ink">{copy.title}</h2>
        <p className="text-body text-ink-2">{copy.line}</p>
      </div>
      <SurfaceGroup>
        <ListRow
          label={DEMO_KEY_LABEL}
          value={<span className="tabular-nums">{grouped(cover.key)}</span>}
        />
      </SurfaceGroup>
      <form action={openPublishedCover}>
        <input name="cover_key" type="hidden" value={cover.key} />
        <PillButton className="w-full" type="submit">
          {DEMO_OPEN}
        </PillButton>
      </form>
    </section>
  );
}

/** The key in groups of four, which is how it was printed when it was issued. */
function grouped(key: string): string {
  return (key.match(/.{1,4}/g) ?? []).join(' ');
}
