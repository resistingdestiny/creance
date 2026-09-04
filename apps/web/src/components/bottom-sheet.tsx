'use client';

import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

/**
 * docs/DESIGN-TOKENS.md section 7: white, 20px top corners, a 36 by 4 grabber
 * in hairline, and a scrim at rgba(0,0,0,0.32). It opens and closes in 200ms
 * ease-out on user action, and instantly under reduced motion, which is done
 * with the `motion-reduce:` variant rather than in JavaScript.
 *
 * Escape closes it and the scrim closes it. Focus moves into the sheet on open
 * and back to whatever opened it on close.
 */

export interface BottomSheetProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Renders the sheet inside its parent instead of over the viewport. The gallery uses this. */
  inline?: boolean;
}

export function BottomSheet({ open, title, onClose, children, inline = false }: BottomSheetProps) {
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    panel.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (opener.current instanceof HTMLElement) opener.current.focus();
    };
  }, [open, onClose]);

  return (
    <div
      className={[
        inline ? 'absolute' : 'fixed',
        'inset-0 z-50 flex items-end justify-center',
        open ? '' : 'pointer-events-none',
      ].join(' ')}
      data-state={open ? 'open' : 'closed'}
    >
      <button
        aria-label="Close"
        className={[
          'absolute inset-0 bg-[rgba(0,0,0,0.32)] transition-opacity duration-200 ease-out motion-reduce:transition-none',
          open ? 'opacity-100' : 'opacity-0',
        ].join(' ')}
        onClick={onClose}
        tabIndex={open ? 0 : -1}
        type="button"
      />
      <div
        aria-hidden={open ? undefined : true}
        aria-label={title}
        className={[
          'relative w-full max-w-[390px] rounded-t-card bg-canvas px-5 pb-8 transition-transform duration-200 ease-out motion-reduce:transition-none',
          open ? 'translate-y-0' : 'translate-y-full',
        ].join(' ')}
        ref={panel}
        role="dialog"
        tabIndex={-1}
      >
        <div className="flex justify-center py-3">
          <span aria-hidden="true" className="h-1 w-9 rounded-full bg-hairline" />
        </div>
        <h2 className="text-body-lg font-medium text-ink">{title}</h2>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}
