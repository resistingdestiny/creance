import type { ReactNode } from 'react';

/**
 * The worker flow is a 390 wide mobile design and the sheet's tab bar is a
 * mobile pattern: 80px high, pinned to the bottom, two tabs. Nothing in the
 * sheet says what that looks like at 1280.
 *
 * The decision, recorded in docs/DECISIONS.md, is the cheap one: centre the 390
 * frame on canvas. The alternative, a separate desktop worker layout, is a day
 * of design that the event does not have and that the investor screens, which
 * are already desktop, do not need.
 *
 * At 390 the frame is the viewport and the hairline border is suppressed, so a
 * phone sees no box around the app.
 */

export function AppFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex w-full justify-center bg-canvas">
      <div className="w-full max-w-[390px] sm:border-x sm:border-hairline">{children}</div>
    </div>
  );
}
