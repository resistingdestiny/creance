import type { ReactNode } from 'react';

import { SiteHeader } from './site-chrome';

/**
 * The worker frame: the product's header, then the app's one column on
 * continuous canvas.
 *
 * The worker flow is a single column design and the sheet's tab bar is a
 * mobile pattern: 80px high, at the foot of the column, two tabs. There is no
 * second desktop layout for it and there is not going to be one, so the column
 * stays a column (docs/DECISIONS.md, T50).
 *
 * What T57 changed is the two things that made the column read as a phone
 * screenshot pasted onto a desktop page rather than as an application.
 *
 * The first is the ground. T50 stood the column on `surface` with hairline
 * sides, and argued the grey was what made a narrow column read as deliberate.
 * At 1440 it does the opposite: a bordered white strip in the middle of a grey
 * field is the shape of a phone emulator, which is exactly the reading T52 took
 * the sheet off the desktop frame to avoid. So the worker frame gives its sheet
 * up too. Canvas runs from the header to the footer, the column is a measure
 * for the content the way the 1280 frame is a measure on every other route, and
 * the product no longer changes clothes between a cover and the index page.
 *
 * The second is the measure. 390 was the width the flow was drawn at, and it
 * was pinned there at every width, so a row's value wrapped in the middle of a
 * screen with a thousand spare pixels. 480 is wide enough that "0.69, falling"
 * and "View on HashScan" sit on one line and the card stops being a postage
 * stamp, and narrow enough that one column is still the right shape for a form
 * a person fills in on a phone.
 *
 * At 390 nothing changed at all: the column is the viewport, there is no ground
 * beside it and no box around the app, which is the view that matters most.
 *
 * Nothing here adds vertical inset. Every screen in this frame measures itself
 * with `min-h-frame`, which is the viewport less the header, so ground above
 * the column would push a bottom anchored primary below the fold by exactly
 * that much on every screen at once.
 */

export function AppFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader />
      <div className="flex flex-1 justify-center bg-canvas">
        <div className="w-full max-w-[480px]">{children}</div>
      </div>
    </div>
  );
}
