import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

// Resolved by next.config.ts to fonts.option-a, fonts.option-b or
// fonts.option-c. See src/lib/font-option.ts for what chooses which.
import { fontClassName, fontStylesheetHref } from 'creance-active-font';

import { SiteFooter } from '../components/site-chrome';
import './globals.css';
import { Providers } from './providers';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

/**
 * The one site description, on every page that does not write its own.
 *
 * The Open Graph and Twitter blocks below carry no title, description or
 * image of their own: the framework fills og:title and og:description from
 * whichever page is being rendered, and og:image comes from
 * ./opengraph-image.tsx, which is the metal card. So a page that exports a
 * title and a description has said everything a link preview needs, and
 * nothing here has to be repeated per route (T53).
 */
const SITE_DESCRIPTION =
  'Monthly cover against your occupation being displaced, with a public index that decides when claims open.';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'Creance',
    template: '%s | Creance',
  },
  description: SITE_DESCRIPTION,
  openGraph: {
    type: 'website',
    siteName: 'Creance',
    locale: 'en_GB',
  },
  twitter: {
    card: 'summary_large_image',
  },
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
 * The three typeface options of docs/DESIGN-TOKENS.md section 2 sit behind one
 * switch, NEXT_PUBLIC_FONT_OPTION, which defaults to A. The switch is applied
 * at module resolution in next.config.ts rather than as a branch here, because
 * any font module left in the bundle graph gets a preload link emitted whether
 * or not it is used, and the inactive family must not be fetched.
 *
 * Option A is the shipped choice. Its two families resolve in next/font/google
 * at every weight the scale uses, and so does option B's. Option C, General
 * Sans, cannot be self hosted here because its licence forbids redistributing
 * the files, so its module asks for a stylesheet link instead and only that
 * option emits one.
 *
 * `Providers` installs MiniKit, so the same pages are a Mini App inside World
 * App and a website everywhere else. It is a client component because MiniKit
 * only exists in a browser; this layout stays a server component.
 *
 * The footer is the product's one footer (T50), under every route: the mark,
 * the two links the header hides at 390, and DESIGN.md's closing line, which
 * was the only shared thing on every page before T50. The header is not here,
 * because the landing wears it in its night tone with "Get a quote" in it and
 * that button needs the quote's own provider; each frame renders the same
 * header component instead.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html className={fontClassName} lang="en-GB">
      <body className="flex min-h-dvh flex-col bg-canvas text-ink">
        {fontStylesheetHref === undefined ? null : (
          <link href={fontStylesheetHref} precedence="default" rel="stylesheet" />
        )}
        <Providers>
          <div className="flex flex-1 flex-col">{children}</div>
          <SiteFooter />
        </Providers>
      </body>
    </html>
  );
}
