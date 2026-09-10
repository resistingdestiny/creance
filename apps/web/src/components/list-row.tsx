import type { ReactNode } from 'react';

import { Check, ChevronRight } from './icons';

/**
 * docs/DESIGN-TOKENS.md section 7: label 14 in ink-2 on the left, value 16 in
 * ink on the right, an optional chevron or check, and a 52px minimum height.
 * With a second line the row grows to 72px, which is the occupation picker's
 * never-opened case.
 */

export interface ListRowProps {
  label: ReactNode;
  value?: ReactNode;
  /** A second line under the label, at the caption scale in ink-2. */
  caption?: ReactNode;
  trailing?: 'chevron' | 'check' | 'none';
  /** Renders the row as a button when it does something. */
  onSelect?: () => void;
  className?: string;
}

export function ListRow({
  label,
  value,
  caption,
  trailing = 'none',
  onSelect,
  className,
}: ListRowProps) {
  const body = (
    <>
      <span className="flex min-w-0 flex-col gap-0.5 text-left">
        <span className="text-secondary text-ink-2">{label}</span>
        {caption ? <span className="text-caption text-ink-2">{caption}</span> : null}
      </span>
      {/* Both sides may shrink and wrap. The value used to hold its
          max-content width, so a long value in a narrow row printed straight
          through the label: "8 percent a year, paid monthly" over "Coupon" at
          390. Nothing moves in a row that has the room. */}
      <span className="flex min-w-0 items-center justify-end gap-2 text-right text-body text-ink">
        {value}
        {trailing === 'chevron' ? <ChevronRight className="text-ink" /> : null}
        {trailing === 'check' ? <Check className="text-ink" /> : null}
      </span>
    </>
  );

  const shape = [
    'flex w-full items-center justify-between gap-4 py-3',
    caption ? 'min-h-[72px]' : 'min-h-[52px]',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  if (onSelect) {
    return (
      <button className={shape} onClick={onSelect} type="button">
        {body}
      </button>
    );
  }

  return <div className={shape}>{body}</div>;
}
