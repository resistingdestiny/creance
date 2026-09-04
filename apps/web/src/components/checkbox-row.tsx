'use client';

import { useId } from 'react';
import type { ReactNode } from 'react';

import { Check } from './icons';

/**
 * The attestation row from the addendum's C5. A 28px square with a hairline
 * border and a black check, the label to its right, and the whole row as the
 * label so the tap target is the full width at the sheet's 52px minimum.
 *
 * The native checkbox is visually hidden behind the square, so the keyboard and
 * the screen reader get the control for free. The input itself is clipped, so
 * the focus outline is moved onto the square by a rule in the global
 * stylesheet, written out as the same two pixels of black as everywhere else.
 */

export function CheckboxRow({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange?: (checked: boolean) => void;
  children: ReactNode;
}) {
  const id = useId();

  return (
    <label
      className="checkbox-row flex min-h-[52px] w-full cursor-pointer items-center gap-3 py-3"
      htmlFor={id}
    >
      <input
        checked={checked}
        className="sr-only"
        id={id}
        onChange={onChange ? (event) => onChange(event.target.checked) : undefined}
        readOnly={onChange ? undefined : true}
        type="checkbox"
      />
      <span className="checkbox-row__box flex size-7 shrink-0 items-center justify-center rounded-[6px] border border-hairline bg-canvas text-ink">
        {checked ? <Check /> : null}
      </span>
      <span className="text-body text-ink">{children}</span>
    </label>
  );
}
