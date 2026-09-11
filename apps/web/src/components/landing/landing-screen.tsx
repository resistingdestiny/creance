import { Suspense, use, type ReactNode } from 'react';

import { AMOUNT_DEFAULT } from '../../lib/cover-amount';
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
import { CHROME_PAGE, SiteHeader } from '../site-chrome';
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
 * Order, which is the acceptance: the header, the hero with the cover card
 * and the from price, the ledger, the index section, the closing line, the
 * investor line. The sections are local to this file so that the order is one
 * list a reader can check rather than eight imports. The header is the
 * product's one header in its night tone (src/components/site-chrome.tsx) and
 * the footer under it is the root layout's, the same on every route (T50), so
 * neither is drawn here.
 *
 * The three steps went with T34 and two of the three ledger questions with T44,
 * both for the same reason: the page shows the thing, so it stops describing it
 * as well.
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
 * The dark ground is the header and the main, and the light sections between
 * the hero and the closing line are one canvas sheet laid on it with rounded
 * corners (T52), so the night shows at the sheet's corners and the boundary
 * between the two grounds is a drawn edge rather than a seam. The ground is
 * on this page's own elements and never on the body, so the marketing surface
 * can be dark (docs/DESIGN-TOKENS-ADDENDUM.md) without the document itself
 * changing colour under any other route.
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
 * is on the first byte; the figures are handed to it as promises and each one
 * is behind a Suspense boundary of its own, so a slow reading cannot hold up a
 * price and neither of them can hold up the page. Each boundary rests at the
 * height its figure will take, which is the sheet's own Skeleton at the line
 * heights of docs/DESIGN-TOKENS.md section 2, so a figure landing changes what
 * is in a space and never how much space there is.
 */

// The chrome's own margins (T50), so the hero text and the wordmark above it
// start on the same line at every width. The sheet's 64px web page margin was
// the margin of a standalone marketing page; this page is a page of the
// product now and stands in the product's frame. docs/DECISIONS.md.
const PAGE = CHROME_PAGE;
const CONTENT = 'mx-auto w-full max-w-[1080px]';

export function LandingScreen({
  data,
  interim = false,
  demo = false,
}: {
  data: LandingData;
  /**
   * No World app id in this deployment, so the check step runs the interim
   * issuer and says so. False is the World check running, which is what a
   * configured deployment does and what a caller with nothing to say means.
   */
  interim?: boolean;
  /**
   * This deployment publishes a demonstration, so the hero offers it.
   *
   * One control beside "Get a quote", in the secondary treatment, and nothing
   * else (T50). /home/demo opens a real cover on Hedera testnet with no World
   * ID and no wallet, which is the strongest thing the product can show in ten
   * seconds, and it was a link in the footer bar, which is the last place a
   * visitor looks. A deployment that has published nothing shows nothing.
   */
  demo?: boolean;
}) {
  return (
    <QuoteProvider>
      <div className="flex flex-col bg-canvas">
        <SiteHeader action={<QuoteButton variant="night" />} />
        <main className="bg-night">
          <section>
            <HeroBand
              demo={demo}
              index={data.index}
              interim={interim}
              occupation={data.occupation}
              price={data.price}
            />
            <Suspense fallback={<TickerResting />}>
              <Ticker explorer={data.explorer} />
            </Suspense>
          </section>
          {/* The light page is a sheet laid on the night ground (T52): the
              sheet's own radius at 390 and the hero card's at the landing
              breakpoint, so the night shows at its corners above and below
              and the change of ground is an edge that was drawn rather than
              a seam where one colour stopped. */}
          <div className="rounded-[20px] bg-canvas lg:rounded-hero">
            <Questions index={data.index} />
            <IndexSection explorer={data.explorer} index={data.index} />
          </div>
          <Closing investorLine={data.investorLine} />
        </main>
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
      <RestingBar className="h-5 w-[18.5rem] max-w-full" />
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
      data-testid="landing-resting"
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
  demo,
  index,
  interim,
  occupation,
  price,
}: {
  demo: boolean;
  index: Streamed<LandingIndexView>;
  interim: boolean;
  occupation: string;
  price: Streamed<LandingPriceView>;
}) {
  return (
    <div className={`pb-20 pt-14 lg:pb-24 lg:pt-20 ${PAGE}`}>
      <div className="mx-auto grid w-full max-w-[1200px] items-center gap-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,620px)] lg:gap-20">
        <Hero demo={demo} index={index} price={price} />
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
  demo,
  index,
  price,
}: {
  demo: boolean;
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
      {/* The price stands between the lead and the actions, as a figure (T52).
          It was a line of body type at the addendum's secondary opacity under
          the buttons, which is how a footnote is drawn, and it is the most
          persuasive fact on the page: a live binding quote, not a marketing
          number. So it is read before the action it argues for, at the
          headline scale, in white. */}
      <Suspense fallback={<PriceLineResting />}>
        <PriceLine price={price} />
      </Suspense>
      {/* The row wraps at the landing breakpoint rather than squeezing: two
          pills do not always fit the text column beside the card. Nothing in
          it may break inside itself, which is what the nowrap is for. */}
      <div className="mt-8 flex flex-col items-center gap-4 lg:mt-10 lg:flex-row lg:flex-wrap lg:gap-x-6 lg:gap-y-4">
        <QuoteButton className="whitespace-nowrap" variant="night" />
        {/* The way in to the example, secondary on this ground so that "Get a
            quote" stays the one primary action. Only where there is an example
            to show: demonstrationOn() decides that on the server. */}
        {demo ? (
          <PillLink className="whitespace-nowrap" href="/home/demo" variant="night-secondary">
            {DEMO_EXAMPLE}
          </PillLink>
        ) : null}
      </div>
    </div>
  );
}

/**
 * docs/DESIGN-TOKENS-ADDENDUM.md, "Copy deck additions, T50", verbatim. The
 * footer bar's link and the sign in screen's read "See a live cover"; this one
 * is the hero's and says what it opens is an example.
 */
const DEMO_EXAMPLE = 'See an example of cover';

/**
 * "From 4.25 a month" at the headline scale, with "for 1,000 of cover" under
 * it, between the lead and the hero actions.
 *
 * Two lines and one figure. The first is the deck's own string; the second
 * says what that price buys, because 1.51 with nothing beside it reads as too
 * small to be real. Both are built in src/lib/landing-model.ts from the quote
 * that was actually taken, so the page still composes no copy and names no
 * amount nobody quoted.
 *
 * No price, no line. The one thing this page may never do is name an amount
 * nobody quoted, so a quote that could not be taken leaves both lines out
 * altogether. The space it was resting in goes with it: a line that is never
 * coming is not a space this page keeps open.
 */
function PriceLine({ price }: { price: Streamed<LandingPriceView> }) {
  const { priceLine, buysLine } = figureOf(price);
  return priceLine === null ? null : (
    <p className="mt-8 flex flex-col gap-1 lg:mt-10">
      <span className="whitespace-nowrap font-display text-headline font-semibold tracking-headline text-white">
        {priceLine}
      </span>
      <span className="text-body-lg text-white/66">{buysLine}</span>
    </p>
  );
}

/**
 * The two lines at the heights they will take, one of headline type and one
 * of body-lg, at the widths the sentences take, so that the centred column at
 * 390 does not move when the figure lands. The margin above is the figure's
 * own, so the space is the same whether the figure is there or resting.
 */
function PriceLineResting() {
  return (
    <span className="mt-8 flex flex-col items-center gap-1 lg:mt-10 lg:items-start">
      <RestingBar className="h-10 w-[19rem] max-w-full" />
      <RestingBar className="h-6 w-40" />
    </span>
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
      metal="shimmer"
      occupation={occupation}
      state="covered"
      statusLabel="Covered"
    />
  );
}

/**
 * The one question left in the ledger, as a definition list: the question is a
 * term and the answer beside it is its definition, which is what the design's
 * two column ledger is. At 390 the answer sits under its question instead of
 * beside it.
 *
 * There were three (T44). "What does it cost." answered with the from price the
 * hero prints four inches above it, and "Am I covered." answered with the card
 * standing beside it wearing a green "Covered" pill, so both were the page
 * explaining what it was already showing. This one stays because its answer
 * carries the attachment and the full payout level, and the page prints neither
 * of them anywhere else until a quote is taken.
 *
 * The band came down from 128px of padding to 80px at the landing breakpoint
 * with them. It was the height three rows stood in; one row left in it read as
 * a section that had failed to load rather than as one statement. The hairline
 * above it went with T52: the section is the top of the sheet on the night
 * ground now, and a hairline over a change of ground is a second separator
 * doing the same job.
 */
function Questions({ index }: { index: Streamed<LandingIndexView> }) {
  return (
    <section className="mx-5 py-16 lg:mx-10 lg:py-20">
      <dl className={`flex flex-col ${CONTENT}`}>
        <Question
          answer={
            <Suspense fallback={<AnswerResting />}>
              <PayAnswer index={index} />
            </Suspense>
          }
          question="When does it pay."
        />
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

function PayAnswer({ index }: { index: Streamed<LandingIndexView> }) {
  return <>{figureOf(index).payLine}</>;
}

/**
 * The answer before its figure has been read.
 *
 * The space is kept by the answer's own empty lines rather than by a height
 * this file would have to keep in step with the type scale, and the bars are
 * laid over them. The ledger aligns its two columns on the baseline of the
 * answer, so a block of bars with no line in it would sit at a different height
 * from the sentence that replaces it, and the row would move by a few pixels as
 * the answer landed.
 *
 * The pay answer takes two lines at both widths. Measured in a browser with the
 * figures in it. It took a `lines` argument while the cost answer beside it
 * took three at 390; that answer is gone (T44) and so is the argument.
 */
function AnswerResting() {
  return (
    <div className="relative" data-testid="landing-resting">
      <span aria-hidden="true" className="invisible">
        {'\u00a0'}
        <br />
        {'\u00a0'}
      </span>
      <span className="absolute inset-0 flex flex-col gap-1.5">
        <Skeleton className="flex-1" />
        <Skeleton className="flex-1 lg:w-2/3 lg:self-end" />
      </span>
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
  return (
    <div
      aria-hidden="true"
      className="h-[45px] border-t border-white/10"
      data-testid="landing-resting"
    />
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
  return (
    <div data-testid="landing-resting">
      <Skeleton className="h-[2367px] w-full lg:h-[1307px]" />
    </div>
  );
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
 * The closing line, on the same dark ground as the hero: the main's own, seen
 * again below the sheet. The hairline that used to separate it from the
 * section above is gone: the ground changes, and a hairline over a change of
 * ground is a second separator doing the same job.
 */
function Closing({ investorLine }: { investorLine: Streamed<string> }) {
  return (
    <section className={`py-16 lg:py-28 ${PAGE}`}>
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
 * The investor line takes two lines of secondary type at 390 and one from the
 * landing breakpoint up. Both are measured, and both are the width the sentence
 * itself takes, because the band centres its contents and a bar of another
 * width would move the line sideways as it filled.
 */
function InvestorLineResting() {
  return (
    <span className="flex flex-col items-center gap-1 lg:gap-0">
      <RestingBar className="h-[18px] w-[21.5rem] max-w-full lg:h-5 lg:w-[27rem]" />
      <RestingBar className="h-[18px] w-[14rem] max-w-full lg:hidden" />
    </span>
  );
}
