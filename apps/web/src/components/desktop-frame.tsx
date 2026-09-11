import type { ReactNode } from 'react';

import { CHROME_PAGE, SiteHeader } from './site-chrome';

/**
 * The desktop frame: the product's header, then a 1280 sheet on the product's
 * ground. docs/DESIGN-TOKENS.md section 3 gives the investor screens 1280 wide
 * with 40px side margins, and those are the chrome's own margins, so the
 * wordmark above and the heading below it start on the same line. The public
 * explorer stands in it too, with "Get cover" as the header's action.
 *
 * It is the same construction as the worker frame at another width (T50): the
 * same header, the same `surface` ground, a canvas sheet on it with hairline
 * sides where the ground shows. Before T50 the investor screens had no header
 * and no ground, and the worker frame had neither either, so the two read as
 * two websites rather than as one product at two widths.
 *
 * Below 1280 the sheet is the viewport and the margins hold, so the screen is
 * still usable on a laptop without a second layout; at 390 they are the
 * sheet's 20px mobile margin, as they are everywhere else. There is no tab bar here:
 * the sheet's two tabs are a worker pattern and do not appear on an investor
 * screen.
 */

export function DesktopFrame({
  action = null,
  children,
  current = null,
}: {
  /** The header's one control, top right. Nothing on the investor screens. */
  action?: ReactNode;
  children: ReactNode;
  /** Which of the header's two places this screen is; the admin screens are neither. */
  current?: 'index' | 'invest' | null;
}) {
  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader action={action} current={current} />
      <div className="flex flex-1 justify-center bg-surface">
        <div className={`min-h-frame w-full max-w-[1280px] bg-canvas py-12 xl:border-x xl:border-hairline ${CHROME_PAGE}`}>
          {children}
        </div>
      </div>
    </div>
  );
}
