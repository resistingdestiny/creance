import { rateFigure } from '../lib/investor-model';

/**
 * Where a series' return comes from, drawn rather than narrated.
 *
 * This was six lines of prose on a phone carrying three numbers, and nobody
 * read it. The three parts of `returnSplit` are parts of one whole, they have a
 * natural order, and the losses come off the end, which is a bar. So it is a
 * bar, with the arithmetic set out under it as a ledger: the reader gets the
 * shape in one look and the figures without reading a sentence.
 *
 * The first part is not income. The collateral would make it in tokenised
 * treasuries; this deployment holds its collateral in a vault and deploys none
 * of it. That is why its segment is hatched rather than solid and why its row
 * is labelled "implied": the word is the claim, and it is the only claim made
 * about that part anywhere on the bar. Calling it earned would be false.
 * Leaving it out would be worse, because then the total would not reconcile.
 *
 * Nothing here works a figure out. Every number arrives already split by
 * `returnSplit` in packages/index-model/src/pricing.ts, the arithmetic behind
 * every yield figure in the product, and is printed through `rateFigure`, so
 * two surfaces showing the same series cannot round it differently.
 *
 * The bar is the gross, base plus premium, and the loss is taken off its right
 * end, so the boundary between the solid segment and the faint one is the
 * total. It is decorative: every figure it draws is in the ledger beside it as
 * text, so a screen reader gets the whole split and not a described picture.
 */

/** The three parts and their sum, as annual fractions of the principal. */
export interface ReturnSplitFigures {
  /** What the collateral would make waiting. Implied, not earned here. */
  readonly base: number;
  readonly premium: number;
  readonly loss: number;
  /** base + premium - loss, as `returnSplit` computed it. */
  readonly total: number;
}

export interface ReturnSplitBarProps {
  readonly split: ReturnSplitFigures;
  /** Which ground it stands on. The landing band is night, the board is light. */
  readonly tone?: 'light' | 'night';
  readonly className?: string;
}

/**
 * The two grounds this bar stands on, and nothing between them.
 *
 * Monochrome on purpose. The sheet's three colours are state indicators and a
 * return is not a state, so a green segment here would be the first time in the
 * product that green meant something other than money in. The segments are told
 * apart by treatment instead: hatched for implied, solid for earned, faint for
 * taken away.
 */
const TONES = {
  light: {
    figure: 'text-ink',
    label: 'text-ink-2',
    rule: 'border-hairline',
    base: 'border border-ink-3',
    stripe: '#6B6F76',
    premium: 'bg-ink',
    loss: 'bg-hairline',
  },
  night: {
    figure: 'text-white',
    label: 'text-white/66',
    rule: 'border-white/20',
    base: 'border border-white/40',
    stripe: 'rgba(255, 255, 255, 0.6)',
    premium: 'bg-white',
    loss: 'bg-white/16',
  },
} as const;

/**
 * The hatch, at the pitch and angle the principal bar's reserved segment uses,
 * so the one thing in this product that means "not what it looks like" looks
 * the same wherever it appears. Inline because a gradient at a fixed angle is
 * not a utility and the stylesheet is not this component's to extend.
 */
function hatch(colour: string) {
  return {
    backgroundImage: `repeating-linear-gradient(118deg, ${colour} 0 1px, transparent 1px 5px)`,
  };
}

/**
 * `rateFigure`'s own rounding, with its trailing zeros put back.
 *
 * The product prints 4 rather than 4.00 everywhere else, and everywhere else it
 * is one figure in a sentence. Here it is a column of four that add up, and a
 * column whose points do not line up is not a ledger a reader can add. So this
 * pads what `rateFigure` returned and never rounds it: the value is the one
 * every other surface prints, to the digit.
 */
function ledgerFigure(percent: number): string {
  const figure = rateFigure(percent);
  const point = figure.indexOf('.');
  if (point === -1) return `${figure}.00`;
  return figure.padEnd(point + 3, '0');
}

export function ReturnSplitBar({ split, tone = 'light', className }: ReturnSplitBarProps) {
  const skin = TONES[tone];
  const gross = split.base + split.premium;

  // The kept length is the total, held inside the bar it is drawn in. A split
  // whose losses swallow the whole gross has no shape worth drawing and the
  // ledger under it carries the figures on its own.
  const kept = Math.min(Math.max(split.total, 0), gross);
  const widths =
    gross > 0
      ? {
          base: Math.min(split.base, kept),
          premium: Math.max(0, kept - split.base),
          loss: gross - kept,
        }
      : null;

  const rows: {
    key: string;
    figure: string;
    label: string;
    swatch: string;
    style: { backgroundImage: string } | undefined;
  }[] = [
    {
      key: 'base',
      figure: ledgerFigure(split.base * 100),
      label: 'implied, from tokenised treasuries',
      swatch: skin.base,
      style: hatch(skin.stripe),
    },
    {
      key: 'premium',
      figure: ledgerFigure(split.premium * 100),
      // Nought from premiums is not a poor return, it is an unwritten pool, and
      // the label says which. The bar says it too: all hatch and no solid.
      label: split.premium === 0 ? 'from premiums, no cover bought yet' : 'from premiums',
      swatch: skin.premium,
      style: undefined,
    },
  ];
  if (split.loss > 0) {
    rows.push({
      key: 'loss',
      figure: `-${ledgerFigure(split.loss * 100)}`,
      label: 'expected losses',
      swatch: skin.loss,
      style: undefined,
    });
  }

  return (
    <div
      className={['flex flex-col gap-3', className].filter(Boolean).join(' ')}
      data-testid="return-split"
    >
      <p className={`text-secondary ${skin.label}`}>Where the return comes from</p>
      {widths === null ? null : (
        <span aria-hidden="true" className="flex h-3 w-full overflow-hidden rounded-full">
          <span
            className={`h-full rounded-l-full ${skin.base}`}
            style={{ ...hatch(skin.stripe), width: `${((widths.base / gross) * 100).toFixed(3)}%` }}
          />
          <span
            className={`h-full ${skin.premium}`}
            style={{ width: `${((widths.premium / gross) * 100).toFixed(3)}%` }}
          />
          <span
            className={`h-full rounded-r-full ${skin.loss}`}
            style={{ width: `${((widths.loss / gross) * 100).toFixed(3)}%` }}
          />
        </span>
      )}
      <div className="flex flex-col gap-1.5">
        {rows.map((row) => (
          <p className="m-0 flex items-center gap-3" key={row.key}>
            <span
              aria-hidden="true"
              className={`h-2.5 w-2.5 shrink-0 rounded-sm ${row.swatch}`}
              style={row.style}
            />
            <span className={`w-14 shrink-0 text-right text-body tabular-nums ${skin.figure}`}>
              {row.figure}
            </span>
            <span className={`text-secondary ${skin.label}`}>{row.label}</span>
          </p>
        ))}
        <p className={`m-0 mt-1 flex items-center gap-3 border-t pt-2.5 ${skin.rule}`}>
          <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0" />
          <span
            className={`w-14 shrink-0 text-right text-body font-medium tabular-nums ${skin.figure}`}
          >
            {ledgerFigure(split.total * 100)}
          </span>
          {/* "At today's capacity" is load bearing rather than a hedge: the
              premium share is premium income over principal, so a partly
              written pool shares less than its rate. On a pool nothing has been
              written against, the whole of the total is the implied part, and
              saying which is shorter than saying the capacity is nought. */}
          <span className={`text-secondary ${skin.label}`}>
            {split.premium === 0
              ? 'percent a year, all of it implied'
              : "percent a year, at today's capacity"}
          </span>
        </p>
      </div>
    </div>
  );
}
