import type { Metadata } from 'next';

import { Gallery } from './gallery';

/**
 * The T10 acceptance surface. Not linked from anywhere, no authentication, and
 * kept out of the index: it is a review surface, not a page of the product.
 */
export const metadata: Metadata = {
  title: 'Component gallery',
  robots: { index: false, follow: false },
};

export default function GalleryPage() {
  return <Gallery />;
}
