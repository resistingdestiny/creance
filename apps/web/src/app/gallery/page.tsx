import type { Metadata } from 'next';

import { Gallery } from './gallery';
import { specimenFonts, specimenStylesheetHref } from './specimen-fonts';

/**
 * The T10 acceptance surface. Not linked from anywhere, no authentication, and
 * kept out of the index: it is a review surface, not a page of the product.
 *
 * The three typefaces are loaded here rather than in the root layout so that
 * only this route carries the two the build is not shipping.
 */
export const metadata: Metadata = {
  title: 'Component gallery',
  robots: { index: false, follow: false },
};

export default function GalleryPage() {
  return (
    <>
      <link href={specimenStylesheetHref} precedence="default" rel="stylesheet" />
      <Gallery specimenFonts={specimenFonts} />
    </>
  );
}
