import { Suspense, use, type ReactNode } from 'react';

import { AMOUNT_DEFAULT } from '../../lib/cover-amount';
import { COVERED_ANSWER } from '../../lib/landing-model';
import type {
  LandingData,
  LandingExplorerView,
  LandingIndexView,
  LandingPriceView,
  Streamed,
} from '../../lib/landing-data';
import { CoverCard } from '../cover-card';
import { PillLink } from '../pill-button';
import { ReplayBar } from '../replay-bar';
import { Skeleton } from '../skeleton';
import { HeroAmount } from './hero-amount';
import { IndexTicker } from './index-ticker';
import { LandingExplorer } from './landing-explorer';
import { QuoteButton } from './quote-button';
import { QuoteSlot } from './quote-panel';
import { QuoteProvider } from './quote-state';

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
 *
 * The whole purchase happens here. "Get a quote" opens it where the hero card
 * stands rather than leaving for a route (T35), the card turns over to carry
 * each step (T36), and since T37 the World check, the payment and the covered
 * card are steps of the same turn: there is no full page navigation between the
 * front door and cover being bought. The four routes are all still live and
 * still hold the same session. QuoteProvider is the one piece of state the page
 * holds, and the sections around it are still rendered on the server: they are
 * passed through it as children, so the marketing page is not a client bundle
 * because three buttons share a step.
 *
 * Since T40 the page is drawn before its figures arrive. Every section above is
 * structure, copy and the card, and none of it needs a paid call, so all of it
 * is on the first byte; the six figures are handed to it as promises and each
 * one is behind a Suspense boundary of its own, so a slow reading cannot hold
 * up a price and neither can hold up the page. Each boundary rests at the
 * height its figure will take, which is the sheet's own Skeleton at the line
 * heights of docs/DESIGN-TOKENS.md section 2, so a figure landing changes what
 * is in a space and never how much space there is.
 */

const PAGE = 'px-5 lg:px-16';
const CONTENT = 'mx-auto w-full max-w-[1080px]';

export function LandingScreen({
  data,
  interim = false,
}: {
  data: LandingData;
  /**
   * No World app id in this deployment, so the check step runs the interim
   * issuer and says so. False is the World check running, which is what a
   * configured deployment does and what a caller with nothing to say means.
   */
  interim?: boolean;
}) {
  // Both index links open the public explorer, which is the page of record for
  // the index (T32). They pointed at the worker's Index tab, which is one
  // occupation inside the app frame and behind a tab bar; a visitor who has
  // bought nothing is better served by the page that carries all fifteen.
  const indexHref = '/index';

  return (
    <QuoteProvider>
      <div className="flex flex-col bg-canvas">
        <Nav indexHref={indexHref} />
        <main>
          <section className="bg-night">
            <HeroBand index={data.index} interim={interim} occupation={data.occupation} price={data.price} />
            <Suspense fallback={<TickerResting />}>
              <Ticker explorer={data.explorer} />
            </Suspense>
          </section>
          <Questions index={data.index} price={data.price} />
          <IndexSection explorer={data.explorer} index={data.index} />
          <Closing investorLine={data.investorLine} />
        </main>
        <FooterBar indexHref={indexHref} />
      </div>
    </QuoteProvider>
  );
}

/**
 * The figure, or the figure once it arrives.
 *
 * The server hands this page promises so that none of them is awaited before
 * the first byte; a test hands it the values themselves and the same components
 * render them with no boundary in between. `use` on a promise is what suspends
 * the one section waiting for it, and it is called conditionally on purpose:
 * there is nothing to wait for when there is a value.
 */
function figureOf<T>(value: Streamed<T>): T {
  return isPromised(value) ? use(value) : value;
}

function isPromised<T>(value: Streamed<T>): value is Promise<T> {
  return value !== null && typeof (value as Promise<T>).then === 'function';
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
    <IndexLivePill dot={live ? 'bg-covered' : 'bg-watch'}>
      {live
        ? 'Index live, updated monthly from public data'
        : 'Showing the last reading we published'}
    </IndexLivePill>
  );
}

function IndexLiveFrom({ index }: { index: Streamed<LandingIndexView> }) {
  return <IndexLive live={figureOf(index).live} />;
}

/**
 * The badge before the reading behind it has been read.
 *
 * The pill is the same pill at the same height, because the bar inside it is
 * the line height of the type it stands for, and the dot is neither of the two
 * colours that mean something. It says nothing rather than saying "live", which
 * is the one thing this badge may never claim before it is known.
 */
function IndexLiveResting() {
  return (
    <IndexLivePill dot="bg-white/24">
      <RestingBar className="h-5 w-[15rem] max-w-full" />
    </IndexLivePill>
  );
}

/**
 * A resting state on the night ground.
 *
 * The sheet's own Skeleton is this idea on canvas: the surface colour at the
 * field radius, the exact final dimensions, and no animation, because the one
 * thing that moves on this page is the card. Two things make it a component of
 * its own here. The marketing band is dark, where a light grey slab would be
 * the brightest thing on the screen, and all three of the places it rests are
 * inside a paragraph or a pill, where a div is not allowed and the browser
 * would close the paragraph around it.
 */
function RestingBar({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={['inline-block rounded-field bg-white/12', className].filter(Boolean).join(' ')}
    />
  );
}

function IndexLivePill({ children, dot }: { children: ReactNode; dot: string }) {
  return (
    <p className="mb-7 inline-flex items-center gap-2 rounded-full border border-white/16 px-3 py-1.5 text-secondary font-medium text-white/66 lg:mb-8">
      <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${dot}`} />
      {children}
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
  index,
  interim,
  occupation,
  price,
}: {
  index: Streamed<LandingIndexView>;
  interim: boolean;
  occupation: string;
  price: Streamed<LandingPriceView>;
}) {
  return (
    <div className={`pb-24 pt-16 lg:pb-32 lg:pt-24 ${PAGE}`}>
      <div className="mx-auto grid w-full max-w-[1240px] items-center gap-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,620px)] lg:gap-20">
        <Hero index={index} price={price} />
        {/* The card's own column, with the soft ground behind whichever of the
            two is standing in it. */}
        <div className="relative flex justify-center">
          <div
            aria-hidden="true"
            className="landing-glow pointer-events-none absolute left-1/2 top-1/2 h-[620px] w-full max-w-[1100px] -translate-x-1/2 -translate-y-1/2 rounded-full"
          />
          <QuoteSlot card={<HeroCard occupation={occupation} />} interim={interim} />
        </div>
      </div>
    </div>
  );
}

function Hero({
  index,
  price,
}: {
  index: Streamed<LandingIndexView>;
  price: Streamed<LandingPriceView>;
}) {
  return (
    <div className="flex flex-col items-center text-center lg:items-start lg:text-left">
      <Suspense fallback={<IndexLiveResting />}>
        <IndexLiveFrom index={index} />
      </Suspense>
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
        <Suspense fallback={<PriceLineResting />}>
          <PriceLine price={price} />
        </Suspense>
      </div>
    </div>
  );
}

/**
 * "From 4.25 a month", beside the hero button.
 *
 * No price, no line. The one thing this page may never do is name an amount
 * nobody quoted, so a quote that could not be taken leaves the line out
 * altogether. The space it was resting in goes with it: a line that is never
 * coming is not a space this page keeps open.
 */
function PriceLine({ price }: { price: Streamed<LandingPriceView> }) {
  const { priceLine } = figureOf(price);
  return priceLine === null ? null : <p className="text-body text-white/66">{priceLine}</p>;
}

/** One line of body type, which is what the price will be. */
function PriceLineResting() {
  return <RestingBar className="h-6 w-40" />;
}

/**
 * The signature object, at landing size, over the soft ground behind it.
 *
 * The card goes through CoverCard rather than being drawn here, so that T30 can
 * switch its treatment behind one setting without touching this page. It keeps
 * the design's 720 by 432 ratio and is fluid inside its column.
 *
 * `depth` and `metal` are what make it an object rather than a picture of one,
 * and they are asked for here and in no other place in the product.
 *
 * The amount is the one figure on this page that moves. It arrives in the
 * server's HTML at its true value and counts up after hydration, so a browser
 * that never runs the animation shows 5,000 rather than nothing.
 *
 * This is the card at rest, and it is one face of it. QuoteSlot stands it in
 * the stack that carries the perspective, the drift and the turn, and puts the
 * quote on the face behind it, so pressing "Get a quote" turns this card over
 * rather than replacing it. It is still rendered on the server and handed to
 * that client component as a node. The glow belongs to the column rather than
 * to the card, so it is behind the card at whatever angle it is holding.
 */
function HeroCard({ occupation }: { occupation: string }) {
  return (
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
  );
}

/**
 * The three questions, as a definition list: each one is a term and the answer
 * beside it is its definition, which is what the design's two column ledger is.
 * At 390 the answer sits under its question instead of beside it.
 */
function Questions({
  index,
  price,
}: {
  index: Streamed<LandingIndexView>;
  price: Streamed<LandingPriceView>;
}) {
  return (
    <section className={`mx-5 border-t border-hairline py-16 lg:mx-16 lg:py-32`}>
      <dl className={`flex flex-col ${CONTENT}`}>
        <Question
          answer={
            <Suspense fallback={<AnswerResting />}>
              <CostAnswer price={price} />
            </Suspense>
          }
          question="What does it cost."
        />
        <Question
          answer={
            <Suspense fallback={<AnswerResting />}>
              <PayAnswer index={index} />
            </Suspense>
          }
          question="When does it pay."
        />
        <Question answer={COVERED_ANSWER} question="Am I covered." />
      </dl>
    </section>
  );
}

function Question({ question, answer }: { question: string; answer: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border-b border-hairline py-8 last:border-b-0 lg:flex-row lg:items-baseline lg:justify-between lg:gap-12 lg:py-11">
      <dt className="font-display text-title font-semibold tracking-title text-ink lg:whitespace-nowrap lg:text-landing-ledger lg:tracking-landing-ledger">
        {question}
      </dt>
      <dd className="m-0 w-full max-w-[400px] text-body-lg text-ink-2 lg:text-right">{answer}</dd>
    </div>
  );
}

function CostAnswer({ price }: { price: Streamed<LandingPriceView> }) {
  return <>{figureOf(price).costLine}</>;
}

function PayAnswer({ index }: { index: Streamed<LandingIndexView> }) {
  return <>{figureOf(index).payLine}</>;
}

/**
 * An answer before its figure has been read. Two lines of body-lg at every
 * width, which is what both of these answers take with their figure in them and
 * what they take without it.
 */
function AnswerResting() {
  return (
    <div className="flex flex-col gap-1.5">
      <Skeleton className="h-[21px] w-full" />
      <Skeleton className="h-[21px] w-2/3 lg:self-end" />
    </div>
  );
}

function Ticker({ explorer }: { explorer: Streamed<LandingExplorerView> }) {
  return <IndexTicker readings={figureOf(explorer).ticker} />;
}

/**
 * The band the ticker will run in, at the height it runs at: the strip's own
 * 12px of padding above and below one line of secondary type. It carries the
 * hairline and nothing else, so the hero above it does not move when fifteen
 * readings arrive. A round that cannot be read has no strip at all, and the
 * band goes with it, because an empty band under the hero would be a component
 * that failed rather than a page with nothing to say.
 */
function TickerResting() {
  return <div aria-hidden="true" className="h-11 border-t border-white/10" />;
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
 * It follows the quote above it: the occupation the visitor picks to be quoted
 * is the occupation this panel opens on, because those are one act and not two
 * (T35). "How the index works" in the amount step opens this section, which is
 * why it carries the id.
 *
 * The note under it is the honest one. The explorer says nothing about the
 * metered reading behind the hero's live badge, so a feed that stopped
 * answering is still said in words, and an occupation the index has not
 * published for yet is still told apart from an outage.
 */
function IndexSection({
  explorer,
  index,
}: {
  explorer: Streamed<LandingExplorerView>;
  index: Streamed<LandingIndexView>;
}) {
  return (
    <section className={`py-16 lg:py-28 ${PAGE}`} id="the-index">
      <div className={`flex flex-col gap-10 ${CONTENT}`}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between lg:gap-12">
          <h2 className="max-w-[520px] text-balance font-display text-title font-semibold tracking-title text-ink lg:text-landing-head lg:tracking-display">
            One number decides. You can watch it.
          </h2>
          <Suspense fallback={null}>
            <ReplayBadge explorer={explorer} />
          </Suspense>
        </div>

        <Suspense fallback={<ExplorerResting />}>
          <Explorer explorer={explorer} />
        </Suspense>

        {/* The note is the exception to the rule the resting states follow: it
            is the sentence a page prints when a read failed, so what it rests
            at is what it will be whenever the feed answers, which is no note
            and no space kept for one. */}
        <Suspense fallback={null}>
          <IndexNote index={index} />
        </Suspense>
      </div>
    </section>
  );
}

function ReplayBadge({ explorer }: { explorer: Streamed<LandingExplorerView> }) {
  const { replayBadge } = figureOf(explorer);
  return replayBadge === null ? null : <ReplayBar label={replayBadge} variant="compact" />;
}

function Explorer({ explorer }: { explorer: Streamed<LandingExplorerView> }) {
  const { round } = figureOf(explorer);
  return round === null ? null : <LandingExplorer data={round} />;
}

/**
 * The panel at the height it stands at once its round is in it, measured in a
 * browser at both widths against the same fifteen readings the page draws. A
 * round that cannot be read at all leaves the section with its heading and its
 * note, which is the one state where this space closes rather than fills.
 */
function ExplorerResting() {
  return <Skeleton className="h-[1148px] w-full lg:h-[788px]" />;
}

function IndexNote({ index }: { index: Streamed<LandingIndexView> }) {
  const { note } = figureOf(index);
  return note === null ? null : (
    <p className="max-w-[560px] text-body text-ink-2" data-testid="landing-index-note">
      {note}
    </p>
  );
}


/**
 * The closing line, on the same dark ground as the hero, which is the second
 * and last band of it on the page. The hairline that used to separate it from
 * the section above is gone: the ground changes, and a hairline over a change
 * of ground is a second separator doing the same job.
 */
function Closing({ investorLine }: { investorLine: Streamed<string> }) {
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
        <p className="mt-6 text-secondary text-white/66">
          <Suspense fallback={<InvestorLineResting />}>
            <InvestorLine line={investorLine} />
          </Suspense>
        </p>
      </div>
    </section>
  );
}

function InvestorLine({ line }: { line: Streamed<string> }) {
  return <>{figureOf(line)}</>;
}

/**
 * One line of secondary type, which is what the investor line is at both
 * widths. It sits inside the paragraph rather than replacing it, so the line
 * box it rests in is the line box it fills.
 */
function InvestorLineResting() {
  return <RestingBar className="h-5 w-[22rem] max-w-full align-middle" />;
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
