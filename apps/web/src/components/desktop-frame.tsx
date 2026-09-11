import type { ReactNode } from 'react';

import { CHROME_FRAME, SiteHeader } from './site-chrome';

/**
 * The desktop frame: the product's header, then the page on one continuous
 * ground. docs/DESIGN-TOKENS.md section 3 gives the investor screens 1280 wide
 * with 40px side margins, and those are the chrome's own margins, so the
 * wordmark above and the heading below it start on the same line. The public
 * explorer stands in it too.
 *
 * T50 drew this as a canvas sheet on a `surface` ground with hairline sides
 * from 1280 up, the worker frame's construction at another width. At 1440 that
 * left 80px of grey either side of a bordered box under a header that spanned
 * the whole viewport, and Root read it as a card floating inside a browser
 * rather than as an application. So the sheet is gone (T52): the ground is
 * canvas from the header to the footer, edge to edge, and the 1280 frame is a
 * measure for the content, exactly as it is for the header above it. The
 * worker frame keeps its sheet, because beside a 390 column the ground is most
 * of the screen and is the thing that makes the column read as deliberate; on
 * a page that is the width of the viewport there is no ground to see, only a
 * seam. docs/DECISIONS.md under T52.
 *
 * Below 1280 the frame is the viewport and the margins hold, so the screen is
 * still usable on a laptop without a second layout; at 390 they are the
 * sheet's 20px mobile margin, as they are everywhere else. There is no tab bar
 * here: the sheet's two tabs are a worker pattern and do not appear on an
 * investor screen.
 */

export function DesktopFrame({
  action,
  children,
  current = null,
}: {
  /** The header's one control, top right. The chrome's own unless a screen says otherwise. */
  action?: ReactNode;
  children: ReactNode;
  /** Which of the header's two places this screen is; the admin screens are neither. */
  current?: 'index' | 'invest' | null;
}) {
  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader action={action} current={current} />
      <div className="flex flex-1 flex-col bg-canvas">
        <div className={`min-h-frame py-12 ${CHROME_FRAME}`}>{children}</div>
      </div>
    </div>
  );
}
