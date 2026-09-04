'use client';

import { useId } from 'react';

import { formatAmount } from '../lib/format';

/**
 * docs/DESIGN-TOKENS.md section 7: track 3px, hairline behind and ink in front
 * of the thumb, thumb a 28px black circle, range 1,000 to 10,000 in steps of
 * 500.
 *
 * It is a native `<input type="range">`, so the keyboard, the screen reader and
 * the touch behaviour are the platform's. The track and thumb are painted by
 * the `.amount-slider` rules in the global stylesheet, which is the only way to
 * reach the vendor pseudo-elements.
 */

export const AMOUNT_MIN = 1000;
export const AMOUNT_MAX = 10_000;
export const AMOUNT_STEP = 500;

export interface AmountSliderProps {
  value: number;
  onChange?: (value: number) => void;
  label?: string;
  min?: number;
  max?: number;
  step?: number;
}

export function AmountSlider({
  value,
  onChange,
  label = 'Cover amount',
  min = AMOUNT_MIN,
  max = AMOUNT_MAX,
  step = AMOUNT_STEP,
}: AmountSliderProps) {
  const id = useId();
  const filled = ((value - min) / (max - min)) * 100;

  return (
    <div className="flex flex-col gap-4">
      <label className="text-secondary text-ink-2" htmlFor={id}>
        {label}
      </label>
      <input
        aria-valuetext={formatAmount(value)}
        className="amount-slider"
        id={id}
        max={max}
        min={min}
        onChange={onChange ? (event) => onChange(Number(event.target.value)) : undefined}
        step={step}
        style={{ ['--amount-slider-filled' as string]: `${filled}%` }}
        type="range"
        value={value}
      />
      <div className="flex justify-between text-secondary text-ink-2">
        <span>{formatAmount(min)}</span>
        <span>{formatAmount(max)}</span>
      </div>
    </div>
  );
}
