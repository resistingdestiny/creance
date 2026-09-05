import type { ReactNode } from 'react';

/**
 * The desktop surface. The worker flow is a 390 frame centred on canvas
 * (src/components/app-frame.tsx); the investor screens are the other half of
 * that decision, and docs/DESIGN-TOKENS.md section 3 gives them 1280 wide with
 * 40px side margins.
 *
 * Below 1280 the margins hold and the content narrows, so the screen is still
 * usable on a laptop without a second layout. There is no tab bar here: the
 * sheet's two tabs are a worker pattern and do not appear on an investor
 * screen.
 */

export function DesktopFrame({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[1280px] px-10 py-12">{children}</div>
  );
}
