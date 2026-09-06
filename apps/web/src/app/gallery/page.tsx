import type { Metadata } from 'next';

import { fontStylesheetHref } from '../../lib/fonts.option-c';

import { Gallery } from './gallery';

/**
 * The T10 acceptance surface. Not linked from anywhere, no authentication, and
 * kept out of the index: it is a review surface, not a page of the product.
 *
 * The three home directions can only be compared if all three typefaces are on
 * this page at once, which is the opposite of what the root layout does. They
 * are linked here as stylesheets rather than imported through next/font,
 * because a next/font module anywhere in the graph puts its @font-face into a
 * stylesheet chunk every route loads, and the browser then fetches the inactive
 * families on Home and the landing too. Measured both ways in
 * docs/harness-notes.md. A link on this page is loaded by this page and by no
 * other, which is the property the switch exists to keep.
 *
 * The families are named literally by the .type-specimen classes in the global
 * stylesheet. Nothing in the product reads them.
 */
export const metadata: Metadata = {
  title: 'Component gallery',
  robots: { index: false, follow: false },
};

const GOOGLE_FONTS_HREF =
  'https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Inter:wght@400;500;600&family=Inter+Tight:wght@500;600&display=swap';

export default function GalleryPage() {
  return (
    <>
      <link href={GOOGLE_FONTS_HREF} precedence="default" rel="stylesheet" />
      <link href={fontStylesheetHref} precedence="default" rel="stylesheet" />
      <Gallery />
    </>
  );
}
