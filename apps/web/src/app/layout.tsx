import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { activeFontOption } from '../lib/font-option';

import './globals.css';

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
 * switch. NEXT_PUBLIC_FONT_OPTION is inlined by the framework at build time, so
 * the branch below is resolved by the bundler and the family that is not active
 * is never fetched by a browser. Option A is the default and the shipped
 * choice; both families resolve in next/font/google at every weight the scale
 * uses.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const fonts =
    activeFontOption === 'B'
      ? await import('../lib/fonts.option-b')
      : await import('../lib/fonts.option-a');

  return (
    <html className={fonts.fontClassName} lang="en-GB">
      <body className="flex min-h-dvh flex-col bg-canvas text-ink">
        <div className="flex-1">{children}</div>
        <Disclosure />
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
