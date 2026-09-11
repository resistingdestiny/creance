import type { ReactNode } from 'react';

import { SiteHeader } from './site-chrome';

/**
 * The worker frame: the product's header, then the 390 column on the product's
 * ground.
 *
 * The worker flow is a 390 wide mobile design and the sheet's tab bar is a
 * mobile pattern: 80px high, pinned to the bottom, two tabs. Nothing in the
 * sheet says what that looks like at 1280, and a separate desktop worker
 * layout is a day of design the event does not have, so the column stays a
 * column (docs/DECISIONS.md, T50).
 *
 * What T50 changed is what stands around it. The column was centred on bare
 * canvas with a hairline either side and nothing else on the page: no mark, no
 * way back, no ground, so it read as an unfinished page rather than a focused
 * one. Now the header above it is the same header every other screen wears,
 * the ground beside it is `surface`, the same ground the investor frame stands
 * on, and the column is a canvas sheet on it with the hairline sides it had.
 * Depth is ground colour and hairline, as the sheet says, never a shadow.
 *
 * At 390 the column is the viewport, the ground is not visible and the
 * hairlines are suppressed, so a phone sees no box around the app. The stage
 * grows to fill the space above the footer on a short screen so the ground
 * never stops short of it.
 */

export function AppFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader />
      <div className="flex flex-1 justify-center bg-surface">
        <div className="w-full max-w-[390px] bg-canvas sm:border-x sm:border-hairline">
          {children}
        </div>
      </div>
    </div>
  );
}
