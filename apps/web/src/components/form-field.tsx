'use client';

import { useId } from 'react';
import type { InputHTMLAttributes } from 'react';

/**
 * docs/DESIGN-TOKENS.md section 7: 52px high, 12px radius, hairline border,
 * value at 16 to 18px, and the same 2px black outline on focus as everything
 * else. The sheet describes that focus state as two black pixels around the
 * field; it is built with `outline`, because Tailwind v4's own focus rings are
 * 1px in currentColor.
 *
 * Every field has a visible label. The placeholder is decoration and never
 * carries information, which is why it is allowed to stay ink-3.
 *
 * The inline error sits outside the field's surface fill, on canvas, where
 * `triggered` is 4.77:1 and passes. Inside a surface group it would be 4.38:1
 * and fail. See docs/DECISIONS.md.
 */

export interface FormFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  error?: string;
}

export function FormField({ label, error, className, ...rest }: FormFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;

  return (
    <div className="flex flex-col gap-2">
      <label className="text-secondary text-ink-2" htmlFor={id}>
        {label}
      </label>
      <input
        aria-describedby={error ? errorId : undefined}
        aria-invalid={error ? true : undefined}
        className={[
          'min-h-[52px] rounded-field border bg-canvas px-4 text-body-lg text-ink placeholder:text-ink-3',
          error ? 'border-triggered' : 'border-hairline',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
        id={id}
        {...rest}
      />
      {error ? (
        <p className="text-secondary text-triggered" id={errorId}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
