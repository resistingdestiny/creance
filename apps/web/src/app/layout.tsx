import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

// Resolved by next.config.ts to fonts.option-a or fonts.option-b. See
// src/lib/font-option.ts for what chooses which.
import { fontClassName } from 'creance-active-font';

import './globals.css';
import { Providers } from './providers';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'Creance',
    template: '%s | Creance',
  },
  description:
    'Monthly cover against your occupation being displaced, with a public index that decides when claims open.',
  icons: {
    icon: [
      { url: '/icon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icon-16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon.ico' },
    ],
    apple: [{ url: '/icon-180.png', sizes: '180x180', type: 'image/png' }],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#FFFFFF',
};

/**
 * The root layout.
 *
 * The two typeface options of docs/DESIGN-TOKENS.md section 2 sit behind one
 * switch, NEXT_PUBLIC_FONT_OPTION, which defaults to A. The switch is applied
 * at module resolution in next.config.ts rather than as a branch here, because
 * any font module left in the bundle graph gets a preload link emitted whether
 * or not it is used, and the inactive family must not be fetched.
 *
 * Option A is the shipped choice. Both families resolve in next/font/google at
 * every weight the scale uses.
 *
 * `Providers` installs MiniKit, so the same pages are a Mini App inside World
 * App and a website everywhere else. It is a client component because MiniKit
 * only exists in a browser; this layout stays a server component.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html className={fontClassName} lang="en-GB">
      <body className="flex min-h-dvh flex-col bg-canvas text-ink">
        <Providers>
          <div className="flex-1">{children}</div>
          <Disclosure />
        </Providers>
      </body>
    </html>
  );
}

/**
 * DESIGN.md's closing line, in the footer of every public page. The canonical
 * index page and the investor screens read most like a real financial product,
 * so this is not optional decoration.
 */
function Disclosure() {
  return (
    <footer className="mx-auto w-full max-w-[1280px] px-5 py-8 sm:px-16">
      <p className="text-caption text-ink-2">
        This is a testnet prototype built for a hackathon. It is not an offer of insurance or
        securities in any jurisdiction and no real funds are involved.
      </p>
    </footer>
  );
}
