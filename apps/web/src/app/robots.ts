import type { MetadataRoute } from 'next';

// Everything here is public and we want it read, by search engines and by
// crawlers that train models alike. The one exception is /gallery, which is an
// internal component sheet rather than a page about the product.
export default function robots(): MetadataRoute.Robots {
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://creance.co';
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: '/gallery' }],
    sitemap: `${site}/sitemap.xml`,
    host: site,
  };
}
