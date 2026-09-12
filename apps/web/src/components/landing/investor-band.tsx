import { Suspense, use, type ReactNode } from 'react';

import { formatPercent } from '../../lib/format';
import { rateFigure } from '../../lib/investor-model';
import type {
  BandSplit,
  InvestorBandView,
  PricedRange,
  Streamed,
} from '../../lib/investor-band';
import { PillLink } from '../pill-button';

/**
 * The investor side, on the front door.
 *
 * A visitor can read this whole page, buy cover and leave without ever learning
 * that somebody funds it. The two ways in are "Earn yield" in the header and
 * "I want to invest" in the closing band, and both are a control rather than a
 * proposition: they say where to go and nothing about why. This band is the
 * why, and it is three facts rather than an argument.
 *
 * What it does not say is as deliberate as what it does.
 *
 * It names no return. The eight percent is a coupon written into one series at
 * issuance, the closing band under this one already carries it in the page's
 * own words, and a rate in a large figure on a marketing band is a promise
 * whatever the caption says. What stands in its place is where the money comes
 * from, in three parts, unnetted.
 *
 * And it never calls the first of those three parts income. The collateral
 * would make it in tokenised treasuries; this deployment holds its collateral
 * in a vault on Hedera testnet and deploys none of it, so the sentence says
 * "implied" and "would" and the line under it says the rest. That is the same
 * wording every other surface in the product that shows the split uses, for the
 * same reason: netting the three into one figure would state as earned the one
 * part that has not been.
 *
 * Every figure arrives in `view`, already read in src/lib/investor-band.ts from
 * the records the investor screens read, so nothing here can print a number
 * nobody published. A figure that could not be read is absent and the band is
 * as wide as the truth; a page that was handed nothing at all renders no band.
 *
 * The band paints its own ground rather than inheriting one. It is the same
 * night panel the market board opens with (src/app/invest/board-hero.tsx), so
 * the front door and the page it points at look like one product, and it can
 * stand on either of the landing page's two grounds without being restyled. The
 * metal card is deliberately not used: the hero card above is this page's one
 * shimmering object and a second would spend a budget the addendum sets at one.
 *
 * It holds its own Suspense boundary so that mounting it is one line. The
 * heading, the lead and the way in are structure and cost no read, so they are
 * on the first byte; the figures land in a space that was already their size.
 */

/** The heading, the lead, and the one control. None of the three costs a read. */
const HEADING = 'See exactly what you are funding';
const LEAD =
  'Investors choose which occupation they stand behind. Every price, policy and coupon behind it is published on Hedera.';

export interface InvestorBandProps {
  /**
   * The band's figures, or the promise of them. Null and undefined both mean
   * the page has nothing to pass, and then there is no band: this is the
   * investor proposition, and a proposition with no evidence under it is an
   * advertisement.
   */
  view?: Streamed<InvestorBandView> | null;
  className?: string;
}

export function InvestorBand({ view = null, className }: InvestorBandProps) {
  if (view === null) return null;
  return (
    // `data-tone` is what the stylesheet's focus rule reads: the outline turns
    // white on this ground, where the sheet's black one would be invisible on
    // the pill and the link.
    <section
      className={[
        'overflow-hidden rounded-card bg-night px-6 py-8 lg:rounded-hero lg:px-12 lg:py-12',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      data-testid="investor-band"
      data-tone="night"
    >
      <h2 className="max-w-[720px] text-balance font-display text-title font-semibold tracking-title text-white lg:text-landing-head lg:tracking-display">
        {HEADING}
      </h2>
      <p className="mt-2 max-w-[620px] text-body text-white/66 lg:text-landing-lead">{LEAD}</p>

      <Suspense fallback={<BandResting />}>
        <BandBody view={view} />
      </Suspense>

      <div className="mt-8 flex flex-col items-start gap-4 lg:mt-10 lg:flex-row lg:items-center lg:gap-6">
        <PillLink className="w-full lg:w-auto" href="/invest" variant="night">
          Earn yield
        </PillLink>
        <Suspense fallback={null}>
          <NoteLink view={view} />
        </Suspense>
      </div>
    </section>
  );
}

/**
 * The figure, or the figure once it arrives. The page hands this band a promise
 * so the heading is on the first byte; a test hands it the value and the same
 * components render it with no boundary in between. It is the helper the
 * landing page and the market board both already use, for their reason.
 */
function figureOf<T>(value: Streamed<T>): T {
  return value !== null && typeof (value as Promise<T>).then === 'function'
    ? use(value as Promise<T>)
    : (value as T);
}

function BandBody({ view }: { view: Streamed<InvestorBandView> }) {
  const { priced, split, capacity, note } = figureOf(view);
  return (
    <>
      <Figures capacity={capacity} note={note?.label ?? null} priced={priced} />
      <SplitLine split={split} />
    </>
  );
}

/**
 * The three facts, as figures with their labels, in the shape the hero's own
 * band under the card uses.
 *
 * Each one is absent rather than nought when it could not be read, and the grid
 * closes up around it, because a figure standing at nought on a marketing band
 * reads as a product that has done nothing rather than as a read that failed.
 *
 * The values stay at the headline size on every width and do not step up to the
 * display scale the hero uses. The middle one is a range and carries two
 * figures and a word, and at 56px that line is wider than a 390 screen: a
 * figure that will not fit takes the page sideways rather than itself.
 */
function Figures({
  capacity,
  note,
  priced,
}: {
  capacity: number | null;
  note: string | null;
  priced: PricedRange | null;
}) {
  const figures: { value: string; label: string }[] = [];
  if (priced !== null) {
    // Compared as they are written rather than as they are held, which is the
    // rule the board's own ranges follow: two rates that round to the same two
    // decimals are one price on screen, and "6.26 to 6.26" is a rendering
    // fault rather than a range.
    const low = rateFigure(priced.low);
    const high = rateFigure(priced.high);
    figures.push(
      {
        value: String(priced.count),
        label: priced.count === 1 ? 'occupation to choose from' : 'occupations to choose between',
      },
      {
        value: low === high ? low : `${low} to ${high}`,
        label: 'percent a year, what cover on them is priced at',
      },
    );
  }
  if (capacity !== null) {
    figures.push({
      value: formatPercent(capacity),
      label:
        note === null
          ? 'of the capital behind the note is standing behind live cover'
          : `of the capital behind ${note} is standing behind live cover`,
    });
  }
  if (figures.length === 0) return null;

  return (
    <dl
      className="mt-8 grid grid-cols-1 gap-x-8 gap-y-7 sm:grid-cols-2 lg:mt-10 lg:grid-cols-3"
      data-testid="investor-band-figures"
    >
      {figures.map((figure) => (
        <div className="flex flex-col gap-1" key={figure.label}>
          <dt className="font-display text-headline font-semibold tracking-headline tabular-nums text-white">
            {figure.value}
          </dt>
          <dd className="m-0 text-secondary text-white/66">{figure.label}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Where the return comes from, in its three parts and never netted.
 *
 * "At today's capacity" is load bearing rather than a hedge: the premium share
 * is premium income over principal, so a partly written pool shares less than
 * its rate, and without the clause the figure reads as a ceiling.
 *
 * A series nobody has bought cover from yet has no premium to share, and saying
 * so is the honest form of the same sentence. Printing nought from premiums
 * beside four percent implied would read as what the occupation returns rather
 * than as what has been written against it, which is nothing.
 *
 * The second line is the one that has to survive every rewrite of the first.
 */
function SplitLine({ split }: { split: BandSplit | null }) {
  if (split === null) return null;
  const pct = (value: number) => formatPercent(value * 100);
  return (
    <div className="mt-8 flex max-w-[640px] flex-col gap-2 lg:mt-10">
      <p className="text-body text-white/66" data-testid="investor-band-split">
        {split.premium === 0
          ? `Where the return would come from: ${pct(split.base)} implied from tokenised treasuries while the capital waits. No cover has been bought on this occupation yet, so there is no premium to share.`
          : `Where the return comes from, at today's capacity: ${pct(split.base)} implied from tokenised treasuries while the capital waits, ${pct(split.premium)} from premiums, less expected losses of ${pct(split.loss)}.`}
      </p>
      <p className="text-caption text-white/66">
        The first figure is not earned here. This deployment holds the collateral in a vault on
        Hedera testnet and deploys none of it.
      </p>
    </div>
  );
}

/**
 * The note itself, on Hedera.
 *
 * The strongest thing this band has to offer, and the reason it is a link
 * rather than a sentence: an investor can open the contract that is this series
 * and read what it holds, which almost nothing that sells exposure to a risk
 * lets anybody do. The note and not the vault, for the reason the market board
 * gives: one vault holds the principal of every series, so a vault link is the
 * same page whichever series you came from.
 *
 * `TextLink` is the light ground's link, at the ink colour, which is invisible
 * here. This is that link's own geometry from docs/DESIGN-TOKENS.md section 7,
 * a 44px hit area and a 3px underline offset, in the colour this ground needs.
 */
function NoteLink({ view }: { view: Streamed<InvestorBandView> }): ReactNode {
  const { note } = figureOf(view);
  if (note === null || note.hashscan === null) return null;
  return (
    <a
      className="inline-flex min-h-11 items-center text-body text-white underline underline-offset-[3px] transition-opacity duration-200 ease-out hover:opacity-70 motion-reduce:transition-none"
      href={note.hashscan}
      rel="noreferrer"
      target="_blank"
    >
      Check the note on Hedera
    </a>
  );
}

/**
 * The figures and the split at the heights they will stand at, so nothing under
 * the band moves when they land.
 *
 * Bars rather than the sheet's Skeleton, for the reason the landing page's own
 * resting states give: the Skeleton is the surface colour on canvas, and on
 * this ground a light grey slab would be the brightest thing in the section.
 */
function BandResting() {
  return (
    <div data-testid="investor-band-resting">
      <div className="mt-8 grid grid-cols-1 gap-x-8 gap-y-7 sm:grid-cols-2 lg:mt-10 lg:grid-cols-3">
        {[0, 1, 2].map((index) => (
          <span className="flex flex-col gap-1" key={index}>
            <RestingBar className="h-10 w-40 max-w-full" />
            <RestingBar className="h-5 w-56 max-w-full" />
          </span>
        ))}
      </div>
      <div className="mt-8 flex max-w-[640px] flex-col gap-2 lg:mt-10">
        <RestingBar className="h-12 w-full lg:h-6" />
        <RestingBar className="h-9 w-full lg:h-[18px]" />
      </div>
    </div>
  );
}

function RestingBar({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={['inline-block rounded-field bg-white/12', className].filter(Boolean).join(' ')}
    />
  );
}
