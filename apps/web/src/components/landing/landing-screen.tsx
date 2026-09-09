import type { ReactNode } from 'react';

import { ExplorerPanel } from '../../app/index/explorer-panel';
import { beginPurchase } from '../../app/purchase-actions';
import { AMOUNT_DEFAULT } from '../../lib/cover-amount';
import type { ExplorerData } from '../../lib/explorer-data';
import { COVERED_ANSWER } from '../../lib/landing-model';
import type { LandingData } from '../../lib/landing-data';
import { CoverCard } from '../cover-card';
import { PillButton, PillLink, type PillButtonVariant } from '../pill-button';
import { ReplayBar } from '../replay-bar';
import { HeroAmount } from './hero-amount';
import { HeroCardStack } from './hero-card-stack';
import { IndexTicker } from './index-ticker';

/**
 * The landing page, section for section from the design of record.
 *
 * Order, which is the acceptance: the navigation, the hero with the cover card
 * and the from price, the three questions, the three steps, the index section,
 * the closing line, the investor line, the footer bar. The sections are local
 * to this file so that the order is one list a reader can check rather than
 * eight imports.
 *
 * Two things this page does not do. It runs no scroll triggered reveal: there
 * is no observer and no scroll listener anywhere in it, because on a data dense
 * page they read as flicker and in a screen recording as a rendering glitch.
 * And it holds no figure of its own: the price, the trigger level, the reading
 * and the coupon all arrive in `data`, already read from the API, so nothing
 * here can print a number nobody published.
 *
 * The one orchestrated moment on load is the hero card sliding into place,
 * which is the sheet's own `.cover-card-enter` with `motion-reduce:animate-none`
 * beside it, and the cover amount counting up beside it. Under reduced motion
 * the card is simply in place on the first paint with the amount at its true
 * value, and the page is otherwise identical. The two continuous motions on the
 * page, the ticker's travel and the card's drift, are the surface being alive
 * rather than a reveal, and both stop dead under the same preference.
 *
 * The dark ground is two bands, the navigation with the hero and the ticker,
 * and the closing line. It is on those sections and never on the body, so the
 * marketing surface can be dark (docs/DESIGN-TOKENS-ADDENDUM.md) without the
 * document itself changing colour under any other route.
 *
 * Every interactive element is a button or an anchor, so the base layer's
 * outline is the focus state on all of them. The design draws them as divs and
 * spans, which would have neither focus nor keyboard.
 */

const PAGE = 'px-5 lg:px-16';
const CONTENT = 'mx-auto w-full max-w-[1080px]';

export function LandingScreen({ data }: { data: LandingData }) {
  // Both index links open the public explorer, which is the page of record for
  // the index (T32). They pointed at the worker's Index tab, which is one
  // occupation inside the app frame and behind a tab bar; a visitor who has
  // bought nothing is better served by the page that carries all fifteen.
  const indexHref = '/index';

  return (
    <div className="flex flex-col bg-canvas">
      <Nav indexHref={indexHref} />
      <main>
        <section className="bg-night">
          <HeroBand
            live={data.index.live}
            occupation={data.occupation}
            priceLine={data.priceLine}
          />
          <IndexTicker readings={data.ticker} />
        </section>
        <Questions costLine={data.costLine} payLine={data.payLine} />
        <IndexSection
          explorer={data.explorer}
          note={data.index.note}
          replayBadge={data.replayBadge}
        />
        <Closing investorLine={data.investorLine} />
      </main>
      <FooterBar indexHref={indexHref} />
    </div>
  );
}

/**
 * A navigation link. The design draws these without an underline, which is why
 * they are not the sheet's TextLink: that component is the underlined 16px link
 * inside the app. The 44px minimum tap target is the sheet's rule and applies
 * to both.
 */
function NavLink({
  children,
  className,
  href,
  tone = 'day',
}: {
  children: ReactNode;
  className?: string;
  href: string;
  tone?: 'day' | 'night';
}) {
  return (
    <a
      className={[
        'min-h-11 items-center text-body no-underline transition-opacity duration-200 ease-out motion-reduce:transition-none',
        tone === 'night' ? 'text-white/66 hover:text-white' : 'text-ink-2 hover:text-ink',
        className ?? 'inline-flex',
      ].join(' ')}
      href={href}
    >
      {children}
    </a>
  );
}

/** "Get a quote", which is the same server action the old start screen submitted. */
function QuoteButton({
  className,
  variant,
}: {
  className?: string;
  variant?: PillButtonVariant;
}) {
  return (
    <form action={beginPurchase} className={className}>
      <PillButton className={className} type="submit" variant={variant}>
        Get a quote
      </PillButton>
    </form>
  );
}

/**
 * The wordmark is Creance, where the design file reads Displacement Bond.
 * Displacement Bond Note is the instrument and Creance is the product, which is
 * Root's decision and predates the design file. docs/DECISIONS.md.
 */
function Nav({ indexHref }: { indexHref: string }) {
  return (
    <header
      className={`flex min-h-18 items-center justify-between gap-4 border-b border-white/10 bg-night py-3 ${PAGE}`}
    >
      <span className="whitespace-nowrap text-body font-semibold text-white">Creance</span>
      {/* One line at every width. The two secondary links are hidden below the
          medium breakpoint rather than wrapped, because a navigation that grows
          a second row pushes the hero down the screen at 390 and the wordmark
          and the one action are what has to survive. Both are still in the
          markup and both are reachable from the footer and the hero. */}
      <nav aria-label="Main" className="flex items-center gap-x-6 lg:gap-x-8">
        <NavLink className="hidden md:inline-flex" href={indexHref} tone="night">
          The index
        </NavLink>
        <NavLink className="hidden md:inline-flex" href="/invest" tone="night">
          Investors
        </NavLink>
        <QuoteButton variant="night" />
      </nav>
    </header>
  );
}

/**
 * The state of the index, from the reading the page was actually served.
 *
 * It says "live" when the feed answered on this request and says what it is
 * showing instead when it did not, so the badge is a fact about this render and
 * never a decoration that is always green. The dot is aria-hidden: the sentence
 * beside it carries the state, which is the same rule the status pill follows,
 * and it has to be, because the covered green is 2.9:1 on the night ground.
 */
function IndexLive({ live }: { live: boolean }) {
  return (
    <p className="mb-7 inline-flex items-center gap-2 rounded-full border border-white/16 px-3 py-1.5 text-secondary font-medium text-white/66 lg:mb-8">
      <span
        aria-hidden="true"
        className={`size-1.5 shrink-0 rounded-full ${live ? 'bg-covered' : 'bg-watch'}`}
      />
      {live
        ? 'Index live, updated monthly from public data'
        : 'Showing the last reading we published'}
    </p>
  );
}

/**
 * The hero band: the text on the left and the card on the right at 1440, one
 * column at 390 with the card under the text.
 *
 * The design of record centres the hero and stands the card under it. Benedict
 * asked for the card to the right, and the two cannot both have the full width,
 * so the headline steps from the landing scale's 104px to the sheet's own
 * display-xl at 1440 and the band is a two column grid. Recorded in
 * docs/DECISIONS.md. Below the landing breakpoint nothing about the order
 * changes: the text, then the card, in one readable column.
 */
function HeroBand({
  live,
  occupation,
  priceLine,
}: {
  live: boolean;
  occupation: string;
  priceLine: string | null;
}) {
  return (
    <div className={`pb-24 pt-16 lg:pb-32 lg:pt-24 ${PAGE}`}>
      <div className="mx-auto grid w-full max-w-[1240px] items-center gap-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,620px)] lg:gap-20">
        <Hero live={live} priceLine={priceLine} />
        <HeroCard occupation={occupation} />
      </div>
    </div>
  );
}

function Hero({ live, priceLine }: { live: boolean; priceLine: string | null }) {
  return (
    <div className="flex flex-col items-center text-center lg:items-start lg:text-left">
      <IndexLive live={live} />
      {/* White for headings and rgba(255,255,255,.66) for everything else, which
          is the addendum's whole rule for text on this ground. */}
      <h1 className="text-balance font-display text-headline font-semibold tracking-headline text-white sm:text-display-l lg:text-display-xl lg:tracking-landing-tight">
        Cover for the day your job is automated.
      </h1>
      <p className="mt-6 max-w-[500px] text-balance text-body-lg text-white/66 lg:mt-8 lg:text-landing-lead">
        A monthly payment now. A payout if your occupation is displaced.
      </p>
      <div className="mt-8 flex flex-col items-center gap-4 lg:mt-11 lg:flex-row lg:gap-6">
        <QuoteButton variant="night" />
        {/* No price, no line. The one thing this page may never do is name an
            amount nobody quoted. */}
        {priceLine === null ? null : <p className="text-body text-white/66">{priceLine}</p>}
      </div>
    </div>
  );
}

/**
 * The signature object, at landing size, over the soft ground behind it.
 *
 * The card goes through CoverCard rather than being drawn here, so that T30 can
 * switch its treatment behind one setting without touching this page. It keeps
 * the design's 720 by 432 ratio and is fluid inside its column.
 *
 * `depth` and `metal` are what make it an object rather than a picture of one,
 * and they are asked for here and in no other place in the product. The stack
 * around it carries the perspective and the angle; the enter animation stays on
 * the stack so that it and the tilt are never the same element's transform.
 *
 * The amount is the one figure on this page that moves. It arrives in the
 * server's HTML at its true value and counts up after hydration, so a browser
 * that never runs the animation shows 5,000 rather than nothing.
 */
function HeroCard({ occupation }: { occupation: string }) {
  return (
    <div className="relative flex justify-center">
      <div
        aria-hidden="true"
        className="landing-glow pointer-events-none absolute left-1/2 top-1/2 h-[620px] w-[140%] max-w-[1100px] -translate-x-1/2 -translate-y-1/2 rounded-full"
      />
      <HeroCardStack className="cover-card-enter relative w-full max-w-[620px] motion-reduce:animate-none">
        <CoverCard
          amount={<HeroAmount value={AMOUNT_DEFAULT} />}
          className="aspect-[720/432] w-full"
          depth
          hero
          metal
          occupation={occupation}
          state="covered"
          statusLabel="Covered"
        />
      </HeroCardStack>
    </div>
  );
}

/**
 * The three questions, as a definition list: each one is a term and the answer
 * beside it is its definition, which is what the design's two column ledger is.
 * At 390 the answer sits under its question instead of beside it.
 */
function Questions({ costLine, payLine }: { costLine: string; payLine: string }) {
  return (
    <section className={`mx-5 border-t border-hairline py-16 lg:mx-16 lg:py-32`}>
      <dl className={`flex flex-col ${CONTENT}`}>
        <Question answer={costLine} question="What does it cost." />
        <Question answer={payLine} question="When does it pay." />
        <Question answer={COVERED_ANSWER} question="Am I covered." />
      </dl>
    </section>
  );
}

function Question({ question, answer }: { question: string; answer: string }) {
  return (
    <div className="flex flex-col gap-3 border-b border-hairline py-8 last:border-b-0 lg:flex-row lg:items-baseline lg:justify-between lg:gap-12 lg:py-11">
      <dt className="font-display text-title font-semibold tracking-title text-ink lg:whitespace-nowrap lg:text-landing-ledger lg:tracking-landing-ledger">
        {question}
      </dt>
      <dd className="m-0 max-w-[400px] text-body-lg text-ink-2 lg:text-right">{answer}</dd>
    </div>
  );
}

/**
 * The index section: the public explorer, on the front door.
 *
 * It is the same ExplorerPanel `/index` renders, not a second drawing of it, so
 * the readings, the trigger band, the four steps behind the number and the
 * guide price where an occupation has no capacity all behave here exactly as
 * they do there, and the round of fifteen behind them is bought once every ten
 * minutes for both pages (T34). The landing's own chart and its headline
 * reading are gone with it: two pictures of one index on one page is the thing
 * this ticket removes.
 *
 * The note under it is the honest one. The explorer says nothing about the
 * metered reading behind the hero's live badge, so a feed that stopped
 * answering is still said in words, and an occupation the index has not
 * published for yet is still told apart from an outage.
 */
function IndexSection({
  explorer,
  note,
  replayBadge,
}: {
  explorer: ExplorerData | null;
  note: string | null;
  replayBadge: string | null;
}) {
  return (
    <section className={`py-16 lg:py-28 ${PAGE}`}>
      <div className={`flex flex-col gap-10 ${CONTENT}`}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between lg:gap-12">
          <h2 className="max-w-[520px] text-balance font-display text-title font-semibold tracking-title text-ink lg:text-landing-head lg:tracking-display">
            One number decides. You can watch it.
          </h2>
          {replayBadge === null ? null : <ReplayBar label={replayBadge} variant="compact" />}
        </div>

        {explorer === null ? null : <ExplorerPanel data={explorer} />}

        {note === null ? null : (
          <p className="max-w-[560px] text-body text-ink-2" data-testid="landing-index-note">
            {note}
          </p>
        )}
      </div>
    </section>
  );
}

/**
 * The closing line, on the same dark ground as the hero, which is the second
 * and last band of it on the page. The hairline that used to separate it from
 * the section above is gone: the ground changes, and a hairline over a change
 * of ground is a second separator doing the same job.
 */
function Closing({ investorLine }: { investorLine: string }) {
  return (
    <section className={`bg-night py-16 lg:py-28 ${PAGE}`}>
      <div className="mx-auto flex max-w-[800px] flex-col items-center text-center">
        <h2 className="text-balance font-display text-headline font-semibold tracking-headline text-white lg:text-display-xl lg:tracking-landing-tight">
          The quiet kind of ready.
        </h2>
        <div className="mt-8 flex w-full flex-col items-center gap-4 lg:mt-10 lg:w-auto lg:flex-row lg:gap-6">
          <QuoteButton className="w-full lg:w-auto" variant="night" />
          <PillLink className="w-full lg:w-auto" href="/invest" variant="night-secondary">
            I want to invest
          </PillLink>
        </div>
        <p className="mt-6 text-secondary text-white/66">{investorLine}</p>
      </div>
    </section>
  );
}

/**
 * The footer bar. The design carries "Terms" and "Contact" beside "How the
 * index works"; neither page exists and this ticket does not write them, so
 * they are left out rather than pointed at something that is not them.
 * docs/DECISIONS.md.
 */
function FooterBar({ indexHref }: { indexHref: string }) {
  return (
    <div
      className={`flex min-h-22 flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-hairline py-3 ${PAGE}`}
    >
      <span className="text-secondary text-ink-2">Creance</span>
      <nav aria-label="Footer">
        <NavLink href={indexHref}>How the index works</NavLink>
      </nav>
    </div>
  );
}
