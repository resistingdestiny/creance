import type { ReactNode } from 'react';

import { PillButton } from './pill-button';

/**
 * docs/DESIGN-TOKENS.md section 7 lists a toast and a failure sheet and gives
 * their states as "screens 09", which do not exist. The sheet's section 8 does
 * carry the copy those states need, so the two failures in the copy deck,
 * Payment failed and Offline, are what these render.
 *
 * The toast is a surface bar with a hairline, no shadow, and an aria-live
 * region so a screen reader hears it without focus moving. The failure sheet
 * is the bottom sheet's content: a title, a sentence that says what happened
 * and what to do next, and one action. No apology.
 */

export const PAYMENT_FAILED = {
  title: "Your payment didn't go through.",
  body: 'Check that your wallet has at least 28.00, then try again. Your cover is unchanged until 19 October.',
  action: 'Pay 28.00',
} as const;

export const OFFLINE = {
  title: "You're offline.",
  body: "Your cover is unchanged. We'll update the index when you're back online.",
  action: 'Retry',
} as const;

export function Toast({ children }: { children: ReactNode }) {
  return (
    <div
      className="flex min-h-[52px] w-full items-center rounded-field border border-hairline bg-surface px-4 py-3 text-body text-ink"
      role="status"
    >
      {children}
    </div>
  );
}

export function FailureBody({
  title,
  body,
  action,
  onAction,
}: {
  /** Left out when the sheet's own title already carries it. */
  title?: string;
  body: string;
  action: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      {title ? <p className="text-body-lg font-medium text-ink">{title}</p> : null}
      <p className="text-secondary text-ink-2">{body}</p>
      <PillButton onClick={onAction}>{action}</PillButton>
    </div>
  );
}
