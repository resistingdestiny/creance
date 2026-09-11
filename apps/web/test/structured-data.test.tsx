import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { DISCLAIMER, SiteFooter } from '../src/components/site-chrome.js';
import { STRUCTURED_DATA_TYPES, StructuredData, structuredData } from '../src/components/structured-data.js';

/**
 * The structured data says what the footer says and nothing more (T53).
 *
 * The site is a testnet prototype and the footer says it is not an offer of
 * insurance or securities. A schema type that describes a financial product,
 * an insurer or an offer would tell a crawler otherwise, so every block the
 * layout emits is parsed here and its types are held to an allow list of
 * plain ones, no price or offer key is allowed anywhere in the graph, and the
 * disclaimer in it is the footer's text, character for character.
 */

const SITE = 'https://example.test';

/** Every JSON-LD block in a document, parsed. */
function blocks(markup: string): unknown[] {
  const found: unknown[] = [];
  for (const match of markup.matchAll(
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
  )) {
    found.push(JSON.parse(match[1] as string));
  }
  return found;
}

/** Every `@type` value anywhere in a parsed graph, nested ones included. */
function types(node: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(node)) {
    for (const entry of node) types(entry, into);
  } else if (node !== null && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (key === '@type') {
        for (const type of Array.isArray(value) ? value : [value]) into.add(String(type));
      } else {
        types(value, into);
      }
    }
  }
  return into;
}

/** Every key anywhere in a parsed graph. */
function keys(node: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(node)) {
    for (const entry of node) keys(entry, into);
  } else if (node !== null && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      into.add(key);
      keys(value, into);
    }
  }
  return into;
}

const FORBIDDEN_TYPES = [
  'FinancialProduct',
  'InsuranceAgency',
  'FinancialService',
  'BankOrCreditUnion',
  'InvestmentOrDeposit',
  'InvestmentFund',
  'Offer',
  'AggregateOffer',
  'Product',
  'Service',
];

const FORBIDDEN_KEYS = ['offers', 'price', 'priceCurrency', 'priceSpecification', 'lowPrice', 'highPrice'];

const markup = renderToStaticMarkup(<StructuredData site={SITE} />);
const parsed = blocks(markup);

describe('the structured data', () => {
  it('is one JSON-LD block that parses', () => {
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ '@context': 'https://schema.org' });
  });

  it('uses only the allowed types', () => {
    const found = [...types(parsed)].sort();
    expect(found.length).toBeGreaterThan(0);
    for (const type of found) {
      expect(STRUCTURED_DATA_TYPES, type).toContain(type);
    }
    expect(found).toEqual([...STRUCTURED_DATA_TYPES].sort());
  });

  it('claims no financial product, no insurer and no offer', () => {
    const found = types(parsed);
    for (const type of FORBIDDEN_TYPES) expect(found.has(type), type).toBe(false);
    const foundKeys = keys(parsed);
    for (const key of FORBIDDEN_KEYS) expect(foundKeys.has(key), key).toBe(false);
    // Nothing in the text says it is one either.
    expect(markup).not.toMatch(/premium of|per month|a month|TUSD|USD/);
  });

  it('carries the footer disclaimer word for word', () => {
    const footer = renderToStaticMarkup(<SiteFooter />)
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ');
    expect(footer).toContain(DISCLAIMER);
    expect(JSON.stringify(parsed)).toContain(DISCLAIMER);
    expect(DISCLAIMER).toContain('not an offer of insurance or securities');
  });

  it('names the organisation, the site, the application and the index', () => {
    const graph = structuredData(SITE)['@graph'] as Record<string, unknown>[];
    const byType = Object.fromEntries(graph.map((node) => [node['@type'], node]));
    expect(byType.Organization).toMatchObject({
      name: 'Creance',
      url: `${SITE}/`,
      sameAs: ['https://github.com/resistingdestiny/creance'],
    });
    expect(byType.WebSite).toMatchObject({ url: `${SITE}/`, publisher: { '@id': `${SITE}/#organization` } });
    expect(byType.WebApplication).toMatchObject({ url: `${SITE}/` });
    expect(byType.Dataset).toMatchObject({
      name: 'Occupation Displacement Index',
      url: `${SITE}/index`,
      isBasedOn: 'https://www.bls.gov/cps/',
      distribution: [{ '@type': 'DataDownload', contentUrl: `${SITE}/v1/index` }],
    });
  });

  it('says the quotable things about the index in plain words', () => {
    const dataset = (structuredData(SITE)['@graph'] as Record<string, unknown>[]).find(
      (node) => node['@type'] === 'Dataset',
    ) as { description: string };
    expect(dataset.description).toContain('fifteen occupation groups');
    expect(dataset.description).toContain('smoothed over three months');
    expect(dataset.description).toContain('twelve months earlier');
    expect(dataset.description).toContain('Current Population Survey');
    expect(dataset.description).toContain('Testnet only');
  });

  it('cannot be closed early by its own text', () => {
    // A literal "</script>" in a description would end the block in the
    // browser; the component escapes every "<", so none survives.
    const inner = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(markup)?.[1];
    expect(inner).toBeDefined();
    expect(inner).not.toContain('<');
  });

  it('has no dashes of the kind the prose rules forbid', () => {
    expect(markup).not.toMatch(/[\u2013\u2014]/);
  });
});
