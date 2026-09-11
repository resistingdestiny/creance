import type { ReactNode } from 'react';

import { SiteHeader } from './site-chrome';

/**
 * The desktop frame: the product's header, then a 1280 sheet on the product's
 * ground. docs/DESIGN-TOKENS.md section 3 gives the investor screens 1280 wide
 * with 40px side margins, and those are the chrome's own margins, so the
 * wordmark above and the heading below it start on the same line.
 *
 * It is the same construction as the worker frame at another width (T50): the
 * same header, the same `surface` ground, a canvas sheet on it with hairline
 * sides where the ground shows. Before T50 the investor screens had no header
 * and no ground, and the worker frame had neither either, so the two read as
 * two websites rather than as one product at two widths.
 *
 * Below 1280 the sheet is the viewport and the margins hold, so the screen is
 * still usable on a laptop without a second layout. There is no tab bar here:
 * the sheet's two tabs are a worker pattern and do not appear on an investor
 * screen.
 */

export function DesktopFrame({
  children,
  current = null,
}: {
  children: ReactNode;
  /** The investor screens say so in the header; the admin screens are neither place. */
  current?: 'invest' | null;
}) {
  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader current={current} />
      <div className="flex flex-1 justify-center bg-surface">
        <div className="min-h-frame w-full max-w-[1280px] bg-canvas px-10 py-12 xl:border-x xl:border-hairline">
          {children}
        </div>
      </div>
    </div>
  );
}
