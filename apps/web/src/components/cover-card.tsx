import type { ReactNode } from 'react';

import { activeCardTreatment, type CardTreatment } from '../lib/font-option';
import { StatusPill, type StatusState } from './status-pill';

/**
 * docs/DESIGN-TOKENS.md section 4, the signature element, in the three
 * directions the design file draws. The gradients, the sheens and the brushing
 * are the `.cover-card` rules in the global stylesheet; this component is the
 * anatomy each direction asks for.
 *
 * - `wallet` (1a) is laid out like a payment card: occupation where the bank
 *   name sits, the amount where the number sits, silver on the diagonal.
 * - `certificate` (1b) is symmetrical inside a fine metallic edge, with the
 *   amount dead centre.
 * - `ingot` (1c) is the heaviest silver, with the amount seated on the bottom
 *   edge and the pill beside it.
 *
 * Which one is drawn follows NEXT_PUBLIC_FONT_OPTION through
 * `activeCardTreatment`, so the treatment and the typeface move together and
 * there is one setting rather than two. The prop is for the gallery, which
 * shows all three at once.
 *
 * Every label is ink, not ink-2. Each treatment's darkest gradient stop fails
 * the 4.5:1 floor for ink-2: #DFE2E7 is 3.89:1 on the wallet card, #EFF1F4 is
 * 4.46:1 on the certificate and #D9DCE2 is 3.67:1 on the ingot. Black is
 * 16.17:1, 18.56:1 and 15.29:1 on the same three. See docs/DECISIONS.md.
 *
 * Everything inside sits in `.cover-card__content`, which lifts it above the
 * overlays. Without that the sheen paints over the amount.
 *
 * `depth` turns the card into an object: the gradient keeps its own thickness
 * behind the face, a glare layer follows the pointer, and the contents move
 * onto separate planes so they travel against each other as the card turns.
 * Only the landing hero asks for it. Every other card in the product renders
 * exactly the markup it rendered before, which is what the component tests
 * hold. The glare goes under `.cover-card__content` and over the two light
 * overlays, so nothing on this card ever paints light across the occupation
 * or the amount, in any treatment.
 *
 * `metal` is T34's finish: a cooler edge and a rainbow shimmer travelling
 * across the metal, the way light moves on a brushed surface that is not quite
 * flat. It is a modifier over whichever treatment is drawn and it changes
 * neither the gradient nor the sheen nor the brushing under it. Like `depth`
 * it is opt in and the landing hero is the only caller. The shimmer is its own
 * layer at z-index 2, over the glare at 1 and under the content at 10, so it
 * is light on the card and never light over the numbers, and it stops dead
 * under prefers-reduced-motion. docs/DECISIONS.md carries the departure from
 * docs/DESIGN-TOKENS-ADDENDUM.md and the contrast argument for it.
 */

export interface CoverCardProps {
  occupation: string;
  amount: ReactNode;
  state: StatusState;
  statusLabel: string;
  /** The landing size: 32px radius and the brushing overlay on top of the sheen. */
  hero?: boolean;
  /** The landing hero only: thickness, depth planes and the pointer glare. */
  depth?: boolean;
  /** The landing hero only: the metal edge and the rainbow shimmer over it. */
  metal?: boolean;
  /** Defaults to the treatment the active font option selects. */
  treatment?: CardTreatment;
  className?: string;
}

/**
 * The card as a surface, with nothing said on it.
 *
 * The gradient, the sheen, the brushing, the thickness, the glare and the
 * shimmer are all here; what the card says is the caller's. `CoverCard` below
 * passes the treatment's own anatomy, and the landing quote passes the step it
 * is asking, so the quote is drawn on the card rather than beside it. Both get
 * the same light layers in the same order, which is the rule the addendum sets
 * and built-css.test.ts holds: nothing lights the numbers.
 *
 * Children are expected to sit in `.cover-card__content`, which is what lifts
 * them above the overlays.
 */
export function CoverCardShell({
  hero = false,
  depth = false,
  metal = false,
  padded = true,
  treatment = activeCardTreatment,
  className,
  children,
}: Pick<CoverCardProps, 'hero' | 'depth' | 'metal' | 'treatment' | 'className'> & {
  /** Off when the caller needs its own padding, which the landing quote does. */
  padded?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={[
        'cover-card',
        treatment === 'wallet' ? undefined : `cover-card--${treatment}`,
        hero ? 'cover-card--hero' : undefined,
        depth ? 'cover-card--depth' : undefined,
        metal ? 'cover-card--metal' : undefined,
        padded ? (hero ? 'p-8' : 'p-5') : undefined,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {depth ? (
        <>
          <span aria-hidden="true" className="cover-card__edge" />
          <span aria-hidden="true" className="cover-card__glare" />
        </>
      ) : null}
      {metal ? <span aria-hidden="true" className="cover-card__shimmer" /> : null}
      {children}
    </div>
  );
}

export function CoverCard({
  occupation,
  amount,
  state,
  statusLabel,
  hero = false,
  depth = false,
  metal = false,
  treatment = activeCardTreatment,
  className,
}: CoverCardProps) {
  return (
    <CoverCardShell
      className={className}
      depth={depth}
      hero={hero}
      metal={metal}
      treatment={treatment}
    >
      {treatment === 'certificate' ? (
        <Certificate
          amount={amount}
          depth={depth}
          hero={hero}
          occupation={occupation}
          state={state}
          statusLabel={statusLabel}
        />
      ) : treatment === 'ingot' ? (
        <Ingot
          amount={amount}
          depth={depth}
          hero={hero}
          occupation={occupation}
          state={state}
          statusLabel={statusLabel}
        />
      ) : (
        <Wallet
          amount={amount}
          depth={depth}
          hero={hero}
          occupation={occupation}
          state={state}
          statusLabel={statusLabel}
        />
      )}
    </CoverCardShell>
  );
}

type FaceProps = Required<
  Pick<CoverCardProps, 'occupation' | 'amount' | 'state' | 'statusLabel' | 'hero' | 'depth'>
>;

/**
 * The class list for one element, with the plane classes dropped when the card
 * is flat. A face without depth therefore renders the string it always
 * rendered, character for character.
 */
function cx(...parts: (string | undefined | false)[]): string {
  return parts.filter(Boolean).join(' ');
}

/** Marks a group whose children may sit on planes of their own. */
function planes(depth: boolean): string | undefined {
  return depth ? 'cover-card__planes' : undefined;
}

/** Lifts one element towards the viewer. Lifts inside a group compose. */
function lift(depth: boolean, z: 16 | 24 | 40): string | undefined {
  return depth ? `cover-card__lift-${z}` : undefined;
}

/**
 * The amount keeps docs/DESIGN-TOKENS.md section 2's scale in every treatment.
 * The design file draws 58px at -0.03em; the sheet's display-l is 56/60 at
 * -0.02em and the sheet wins, as it did on the landing. Weight is part of the
 * treatment: the certificate sets its amount at 500, the other two at 600.
 */
function amountClasses(hero: boolean, weight: 'font-medium' | 'font-semibold'): string {
  return [
    // The landing card is 720 wide and its amount is 108px there. Below the
    // landing breakpoint it steps back onto the sheet's own scale, which tops
    // out at display-xl.
    hero ? 'text-display-xl lg:text-landing-amount lg:tracking-landing-ledger' : 'text-display-l',
    'font-display',
    weight,
    'tracking-display tabular-nums text-ink',
  ].join(' ');
}

function Wallet({ occupation, amount, state, statusLabel, hero, depth }: FaceProps) {
  return (
    <div
      className={cx(
        'cover-card__content flex h-full flex-col justify-between gap-10',
        planes(depth),
      )}
    >
      <div className={cx('flex items-start justify-between gap-4', lift(depth, 24))}>
        <p className="max-w-[190px] text-secondary font-medium text-ink">{occupation}</p>
        <StatusPill state={state}>{statusLabel}</StatusPill>
      </div>
      <div className={cx('flex flex-col gap-1', planes(depth), lift(depth, 16))}>
        <p className="text-secondary text-ink">Cover</p>
        <p className={cx(amountClasses(hero, 'font-semibold'), lift(depth, 24))}>{amount}</p>
      </div>
    </div>
  );
}

/**
 * The design file gives the certificate no "Cover" label, because a centred
 * column of three things reads without one. The word stays in the markup for
 * a screen reader so that switching treatment changes no copy.
 */
function Certificate({ occupation, amount, state, statusLabel, hero, depth }: FaceProps) {
  return (
    <div
      className={cx(
        'cover-card__content flex h-full flex-col items-center justify-center gap-3 text-center',
        planes(depth),
      )}
    >
      <p className={cx('max-w-[250px] text-secondary text-ink', lift(depth, 16))}>{occupation}</p>
      <p className="sr-only">Cover</p>
      <p className={cx(amountClasses(hero, 'font-medium'), lift(depth, 40))}>{amount}</p>
      <StatusPill state={state}>{statusLabel}</StatusPill>
    </div>
  );
}

/**
 * `gap-10` and not `mt-auto` alone. Home lets the card size to its content, so
 * an auto margin there resolves to nothing and the occupation ends where the
 * "Cover" label begins. The gap is the separation the card carries itself, and
 * it is the same one the wallet card's `justify-between gap-10` already gives,
 * so the two are the same height on Home. `mt-auto` stays for the sizes that do
 * have a height, the landing hero and the gallery, where it seats the bottom
 * row on the bottom edge.
 */
function Ingot({ occupation, amount, state, statusLabel, hero, depth }: FaceProps) {
  return (
    <div className={cx('cover-card__content flex h-full flex-col gap-10', planes(depth))}>
      <p className={cx('max-w-[220px] text-secondary font-medium text-ink', lift(depth, 24))}>
        {occupation}
      </p>
      <div
        className={cx(
          'mt-auto flex items-end justify-between gap-4',
          planes(depth),
          lift(depth, 16),
        )}
      >
        <div className={cx('flex flex-col gap-1', planes(depth))}>
          <p className="text-secondary text-ink">Cover</p>
          <p className={cx(amountClasses(hero, 'font-semibold'), lift(depth, 24))}>{amount}</p>
        </div>
        <div className="mb-1 shrink-0">
          <StatusPill state={state}>{statusLabel}</StatusPill>
        </div>
      </div>
    </div>
  );
}
