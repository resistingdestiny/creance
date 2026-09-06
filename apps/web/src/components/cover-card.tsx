import type { ReactNode } from 'react';

import { StatusPill, type StatusState } from './status-pill';

/**
 * docs/DESIGN-TOKENS.md section 4, the signature element. The gradient, the
 * sheen and the hero brushing are the `.cover-card` rules in the global
 * stylesheet; this component is the anatomy the sheet describes: occupation
 * top left at 14/500 capped near 190px, status pill top right, the "Cover"
 * label and the amount bottom left.
 *
 * The occupation label is ink, not ink-2. The gradient's darkest stop is
 * #DFE2E7, where ink-2 is 3.89:1 and fails the floor. Black on the same stop is
 * 16.17:1. See docs/DECISIONS.md.
 *
 * Everything inside sits in `.cover-card__content`, which lifts it above the
 * two overlays. Without that the sheen paints over the amount.
 */

export interface CoverCardProps {
  occupation: string;
  amount: ReactNode;
  state: StatusState;
  statusLabel: string;
  /** The landing size: 32px radius and the brushing overlay on top of the sheen. */
  hero?: boolean;
  className?: string;
}

export function CoverCard({
  occupation,
  amount,
  state,
  statusLabel,
  hero = false,
  className,
}: CoverCardProps) {
  return (
    <div
      className={[
        'cover-card',
        hero ? 'cover-card--hero' : undefined,
        hero ? 'p-8' : 'p-5',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="cover-card__content flex h-full flex-col justify-between gap-10">
        <div className="flex items-start justify-between gap-4">
          <p className="max-w-[190px] text-secondary font-medium text-ink">{occupation}</p>
          <StatusPill state={state}>{statusLabel}</StatusPill>
        </div>
        <div className="flex flex-col gap-1">
          <p className="text-secondary text-ink">Cover</p>
          <p
            className={[
              // The landing card is 720 wide and its amount is 108px there.
              // Below the landing breakpoint it steps back onto the sheet's
              // own scale, which tops out at display-xl.
              hero ? 'text-display-xl lg:text-landing-amount lg:tracking-landing-ledger' : 'text-display-l',
              'font-display font-semibold tracking-display tabular-nums text-ink',
            ].join(' ')}
          >
            {amount}
          </p>
        </div>
      </div>
    </div>
  );
}
