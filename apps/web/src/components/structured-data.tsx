import { DISCLAIMER } from './site-chrome';

/**
 * What the site says it is, to a machine (T53).
 *
 * One JSON-LD graph, in the HTML of every page from the root layout, so a
 * crawler or a model that reads the document is told what this is without
 * running anything. Four things are described, and each is a plain type:
 *
 * - The Organization that publishes it and the WebSite, which are safe.
 * - The product as a WebApplication, with a description that ends in the
 *   footer's own disclaimer. Not FinancialProduct, InsuranceAgency or Offer,
 *   and no price: the footer says this is not an offer of insurance or
 *   securities, and the structured data may not contradict the page.
 * - The Occupation Displacement Index as a Dataset, because it is one: a
 *   monthly series for fifteen occupation groups from BLS CPS data, with the
 *   definition spelt out where a model quoting it would look. Its free
 *   catalogue endpoint is the distribution.
 *
 * test/structured-data.test.tsx parses every block this emits and holds the
 * set of types to an allow list, and the disclaimer to the footer's text.
 */

export const STRUCTURED_DATA_TYPES = [
  'Organization',
  'WebSite',
  'WebApplication',
  'Dataset',
  'DataDownload',
] as const;

const SOURCE = 'https://github.com/resistingdestiny/creance';

export function structuredData(site: string): Record<string, unknown> {
  const organization = `${site}/#organization`;
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': organization,
        name: 'Creance',
        url: `${site}/`,
        logo: `${site}/icon-180.png`,
        sameAs: [SOURCE],
      },
      {
        '@type': 'WebSite',
        '@id': `${site}/#website`,
        url: `${site}/`,
        name: 'Creance',
        description:
          'Monthly cover against your occupation being displaced, with a public index that decides when claims open.',
        inLanguage: 'en-GB',
        publisher: { '@id': organization },
      },
      {
        '@type': 'WebApplication',
        '@id': `${site}/#application`,
        name: 'Creance',
        url: `${site}/`,
        browserRequirements: 'Requires JavaScript',
        description: `Workers buy monthly cover against their occupation being displaced. A claim pays when two keys hold: a public occupation index is above its attachment, and the person proves they lost their job. Investors fund the payouts by holding Displacement Bond Notes and earn the premiums as coupons. Everything settles on Hedera testnet. ${DISCLAIMER}`,
        publisher: { '@id': organization },
        inLanguage: 'en-GB',
      },
      {
        '@type': 'Dataset',
        '@id': `${site}/index#dataset`,
        name: 'Occupation Displacement Index',
        alternateName: 'ODI',
        url: `${site}/index`,
        description:
          'A monthly index of how far a United States occupation is losing ground against the labour market as a whole, for fifteen occupation groups. For each group: the unemployment rate less the all-occupation rate, smoothed over three months, less its own value twelve months earlier, in percentage points. Claims open for a group when the index crosses a frozen attachment or its smoothed excess crosses a frozen level line. Computed from BLS Current Population Survey unemployment rates by occupation and published to a Hedera Consensus Service topic. Testnet only; not a forecast and not an unemployment rate.',
        creator: { '@id': organization },
        publisher: { '@id': organization },
        isBasedOn: 'https://www.bls.gov/cps/',
        spatialCoverage: 'United States',
        temporalCoverage: '2010-01/..',
        inLanguage: 'en-GB',
        keywords: ['unemployment', 'occupation', 'labour statistics', 'Hedera', 'index'],
        variableMeasured: [
          'Unemployment rate for the occupation group, not seasonally adjusted',
          'Excess over the all-occupation unemployment rate',
          'Three month smoothed excess',
          'Occupation Displacement Index: the smoothed excess less its value twelve months earlier',
        ],
        distribution: [
          {
            '@type': 'DataDownload',
            encodingFormat: 'application/json',
            contentUrl: `${site}/v1/index`,
          },
        ],
      },
    ],
  };
}

/**
 * The graph as a script element. `<` is escaped so that no string in the
 * graph can close the element early, whatever it comes to say.
 */
export function StructuredData({ site }: { site: string }) {
  const json = JSON.stringify(structuredData(site)).replace(/</g, '\\u003c');
  return <script dangerouslySetInnerHTML={{ __html: json }} type="application/ld+json" />;
}
