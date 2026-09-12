import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { AppFrame } from '../../../components/app-frame';
import { CopyButton } from '../../../components/copy-button';
import { ChevronRight } from '../../../components/icons';
import { PillButton } from '../../../components/pill-button';
import { readCoverSession } from '../../../lib/current-cover';
import {
  demoCovers,
  demoStatesEnabled,
  fixtureStates,
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
 * The states under them are fixtures, and only the ones that have to be. A
 * state a cover can really be put into is published as that cover instead and
 * drops off the list: Covered is a cover on a series whose claims are shut,
 * Claims open is one on a series whose claims are open, and Paid out is a cover
 * whose claim was approved and paid, with the transaction that paid it on the
 * dashboard behind it. Three states are left, and each is left for a reason.
 * Claim in progress is read from the browser's own claim session, so a stranger
 * opening a cover with its key would see no claim on it. Nothing in this build
 * lapses a cover, so Payment due cannot be arranged. The replay badge is the
 * oracle's mode and belongs to the whole deployment rather than to one cover.
 * Each of those three says on the screen it opens that nothing on it came from
 * the API, which is where a reader is standing when it matters.
 *
 * The page renders on the server, holds no state and needs no script: opening a
 * cover is a form that posts to the same server action the cover key field on
 * the way back in posts to. That matters more than it sounds. It means the
 * published key is in the page the server rendered rather than in the address
 * bar, so it is not in the history, not in a screenshot of the address bar and
 * not in the referrer of the next request.
 *
 * T57 redrew it. It was a heading, three paragraphs and six underlined links
 * in a vertical stack, which is a directory listing and not a way into a
 * product, and it is the first screen of this thing most readers will ever
 * open. The states left over are peers, so they are a grid of equal tiles; the
 * prose under every heading is gone; and the key is a row with a copy control
 * beside it rather than a figure to be transcribed by eye.
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
  const fixtures = demoStatesEnabled() ? fixtureStates(covers) : [];
  if (covers.length === 0 && fixtures.length === 0) notFound();

  const held = (await readCoverSession()) !== null;

  return (
    <AppFrame>
      <main className="flex min-h-frame flex-col gap-10 px-5 py-10">
        <header className="flex flex-col gap-2">
          <h1 className="text-title font-display font-semibold tracking-title text-ink">
            {DEMO_HEADING}
          </h1>
          {covers.length === 0 ? null : <p className="text-body text-ink-2">{DEMO_LINE}</p>}
        </header>

        {refused === undefined ? null : (
          <p className="text-body text-triggered" data-testid="demo-refused" role="status">
            {DEMO_REFUSED}
          </p>
        )}

        {covers.map((cover) => (
          <PublishedCover cover={cover} key={cover.slot} />
        ))}

        {fixtures.length > 0 ? (
          <section className="flex flex-col gap-4" data-testid="demo-states">
            <h2 className="text-body-lg font-medium text-ink">{DEMO_STATES_HEADING}</h2>
            <ul className="grid grid-cols-2 gap-3">
              {fixtures.map((state) => (
                <li className="flex" key={state}>
                  <a
                    className="flex min-h-[64px] w-full items-center justify-between gap-2 rounded-field border border-hairline px-4 text-body text-ink no-underline"
                    href={`/home?demo=${state}`}
                  >
                    {DEMO_STATE_LABELS[state] ?? state}
                    <ChevronRight className="shrink-0 text-ink-2" />
                  </a>
                </li>
              ))}
            </ul>
            {held ? (
              <div className="flex flex-col items-start gap-1">
                <p className="text-secondary text-ink-2">{DEMO_STATES_HELD}</p>
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
 * The copy control beside it is there because that is what a reader who wants
 * to check the claim actually does with it.
 */
function PublishedCover({ cover }: { cover: DemoCover }) {
  const copy = DEMO_COVER_COPY[cover.slot];
  return (
    <section className="flex flex-col gap-3" data-testid={`demo-cover-${cover.slot}`}>
      <h2 className="text-body-lg font-medium text-ink">{copy.title}</h2>
      {/* The key on its own line under its label rather than in a list row.
          Twenty characters in groups of four and a label beside them both wrap
          at the narrowest width, and a key that wraps is a key nobody can
          read back. */}
      <div className="flex flex-col gap-1 rounded-group bg-surface px-4 py-3">
        <span className="text-secondary text-ink-2">{DEMO_KEY_LABEL}</span>
        <span className="flex items-center gap-4">
          <span className="text-body-lg tabular-nums text-ink">{grouped(cover.key)}</span>
          <CopyButton value={cover.key} what="cover key" />
        </span>
      </div>
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
