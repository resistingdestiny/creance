'use client';

import { useEffect, useRef, useState } from 'react';

import { Check, CopyGlyph } from './icons';

/**
 * A small icon button beside a hash or an address. On press it copies the full
 * value and swaps the glyph for a black check for 1200ms. No toast: a toast for
 * a copy is noise and the check says the same thing in the same language.
 *
 * The glyph is 16px inside a 44px box pulled back with a negative margin, so the
 * button reads as an icon and still clears the sheet's tap floor. Pad the hit
 * area, not the glyph.
 *
 * The button's accessible name never changes, because a name that changes under
 * a screen reader mid-action moves the focus context. The success goes to a
 * polite live region instead.
 */

export function CopyButton({ value, what = 'value' }: { value: string; what?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return (
    <>
      <button
        aria-label={`Copy the full ${what}`}
        className="-m-2.5 inline-flex size-11 items-center justify-center text-ink"
        onClick={() => {
          void navigator.clipboard?.writeText(value);
          setCopied(true);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => setCopied(false), 1200);
        }}
        type="button"
      >
        {copied ? <Check /> : <CopyGlyph />}
      </button>
      <span aria-live="polite" className="sr-only">
        {copied ? 'Copied' : ''}
      </span>
    </>
  );
}
