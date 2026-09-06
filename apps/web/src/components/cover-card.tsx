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
 */

export interface CoverCardProps {
  occupation: string;
  amount: ReactNode;
  state: StatusState;
  statusLabel: string;
  /** The landing size: 32px radius and the brushing overlay on top of the sheen. */
  hero?: boolean;
  /** Defaults to the treatment the active font option selects. */
  treatment?: CardTreatment;
  className?: string;
}

export function CoverCard({
  occupation,
  amount,
  state,
  statusLabel,
  hero = false,
  treatment = activeCardTreatment,
  className,
}: CoverCardProps) {
  return (
    <div
      className={[
        'cover-card',
        treatment === 'wallet' ? undefined : `cover-card--${treatment}`,
        hero ? 'cover-card--hero' : undefined,
        hero ? 'p-8' : 'p-5',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {treatment === 'certificate' ? (
        <Certificate
          amount={amount}
          hero={hero}
          occupation={occupation}
          state={state}
          statusLabel={statusLabel}
        />
      ) : treatment === 'ingot' ? (
        <Ingot
          amount={amount}
          hero={hero}
          occupation={occupation}
          state={state}
          statusLabel={statusLabel}
        />
      ) : (
        <Wallet
          amount={amount}
          hero={hero}
          occupation={occupation}
          state={state}
          statusLabel={statusLabel}
        />
      )}
    </div>
  );
}

type FaceProps = Required<Pick<CoverCardProps, 'occupation' | 'amount' | 'state' | 'statusLabel' | 'hero'>>;

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

function Wallet({ occupation, amount, state, statusLabel, hero }: FaceProps) {
  return (
    <div className="cover-card__content flex h-full flex-col justify-between gap-10">
      <div className="flex items-start justify-between gap-4">
        <p className="max-w-[190px] text-secondary font-medium text-ink">{occupation}</p>
        <StatusPill state={state}>{statusLabel}</StatusPill>
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-secondary text-ink">Cover</p>
        <p className={amountClasses(hero, 'font-semibold')}>{amount}</p>
      </div>
    </div>
  );
}

/**
 * The design file gives the certificate no "Cover" label, because a centred
 * column of three things reads without one. The word stays in the markup for
 * a screen reader so that switching treatment changes no copy.
 */
function Certificate({ occupation, amount, state, statusLabel, hero }: FaceProps) {
  return (
    <div className="cover-card__content flex h-full flex-col items-center justify-center gap-3 text-center">
      <p className="max-w-[250px] text-secondary text-ink">{occupation}</p>
      <p className="sr-only">Cover</p>
      <p className={amountClasses(hero, 'font-medium')}>{amount}</p>
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
function Ingot({ occupation, amount, state, statusLabel, hero }: FaceProps) {
  return (
    <div className="cover-card__content flex h-full flex-col gap-10">
      <p className="max-w-[220px] text-secondary font-medium text-ink">{occupation}</p>
      <div className="mt-auto flex items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <p className="text-secondary text-ink">Cover</p>
          <p className={amountClasses(hero, 'font-semibold')}>{amount}</p>
        </div>
        <div className="mb-1 shrink-0">
          <StatusPill state={state}>{statusLabel}</StatusPill>
        </div>
      </div>
    </div>
  );
}
