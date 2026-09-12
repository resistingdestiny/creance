// @vitest-environment node

import { renderToStaticMarkup } from 'react-dom/server';
import { renderToReadableStream } from 'react-dom/server.edge';
import { describe, expect, it } from 'vitest';

import { InvestorOverview } from '../src/app/invest/investor-overview.js';
import type { CouponsView, SeriesView } from '../src/lib/investor-api.js';
import { DEMO_ACCOUNTS } from '../src/lib/wallet.js';

import { COUPONS, SERIES } from './investor-fixtures.js';

/**
 * The investor page arrives before its figures do.
 *
 * The two reads behind it go through the relay to the mirror node and take
 * up to two seconds each, and the fix is not to make a person wait for them:
 * the heading, the chooser and the copy are flushed with nothing read, and
 * each figure is written into the place kept for it as it arrives. What is
 * asserted here is exactly that order, against a page whose two reads are
 * both still out, and then what the page says when one of them never answers.
 */

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

const CHOICES = [
  {
    series_id: SERIES.series_id,
    series_key: SERIES.series_key,
    group: SERIES.group,
    kind: SERIES.kind,
    matures_at: SERIES.vault.matures_at,
    has_note: true,
    links: {
      self: `/v1/series/${SERIES.series_id}`,
      coupons: `/v1/series/${SERIES.series_id}/coupons`,
    },
  },
  {
    series_id: 'ODI-OFFC-2026-01',
    series_key: '0x4f44492d4f4646432d323032362d303100000000000000000000000000000000',
    group: 'office_admin_support',
    kind: 'occupation' as const,
    matures_at: '2027-09-10T00:00:00.000Z',
    has_note: true,
    links: {
      self: '/v1/series/ODI-OFFC-2026-01',
      coupons: '/v1/series/ODI-OFFC-2026-01/coupons',
    },
  },
];

/**
 * The markup up to and including a marker, which is how much of the page has
 * been flushed by the time that marker is on the wire.
 */
async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  marker: string,
): Promise<string> {
  const decoder = new TextDecoder();
  let markup = '';
  while (!markup.includes(marker)) {
    const chunk = await reader.read();
    if (chunk.done) break;
    markup += decoder.decode(chunk.value, { stream: true });
  }
  return markup;
}

/** Whatever the stream has flushed so far, as markup. */
async function drain(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let markup = '';
  let chunk = await reader.read();
  while (!chunk.done) {
    markup += decoder.decode(chunk.value, { stream: true });
    chunk = await reader.read();
  }
  return markup;
}

function restingStates(markup: string): number {
  return markup.match(/data-testid="investor-resting"/g)?.length ?? 0;
}

/** Everything a person reads, with the markup taken out. */
function visibleText(markup: string): string {
  return markup
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function screen(series: Promise<SeriesView | null>, coupons: Promise<CouponsView | null>) {
  return (
    <InvestorOverview
      choices={CHOICES}
      coupons={coupons}
      investor={DEMO_ACCOUNTS['investor-1']}
      series={series}
      seriesId={SERIES.series_id}
    />
  );
}

describe('the shell', () => {
  it('is flushed with both figures still out', async () => {
    const series = deferred<SeriesView | null>();
    const coupons = deferred<CouponsView | null>();

    const stream = await renderToReadableStream(screen(series.promise, coupons.promise));

    // renderToReadableStream resolves when the shell is ready, which is before
    // either read has answered. The shell is read out to its last heading with
    // both still out.
    const reader = stream.getReader();
    const shell = await readUntil(reader, 'On HashScan');

    // The heading, the name, the chooser, the section headings, the copy and
    // the action, all of them.
    expect(shell).toContain('ODI-COMP-2026-01');
    expect(shell).toContain('Computer and mathematical');
    expect(shell).toContain('aria-label="Series"');
    expect(shell).toContain('href="/invest?series=ODI-OFFC-2026-01"');
    expect(shell).toContain('Coupon history');
    expect(shell).toContain('Principal at risk');
    expect(shell).toContain('You earn coupons from premiums.');
    expect(shell).toContain('href="/invest/subscribe?series=ODI-COMP-2026-01"');
    expect(shell).toContain('Demo wallet. Testnet only.');

    // And not one figure, because not one of them has been read.
    expect(shell).not.toContain('Approved to hold');
    expect(shell).not.toContain('Verification needed');
    expect(shell).not.toContain('Earned to date');
    expect(shell).not.toContain('997.26');
    expect(shell).not.toContain('100,000');
    expect(shell).not.toContain('hashscan.io');
    expect(restingStates(shell)).toBe(6);

    series.resolve(SERIES);
    coupons.resolve(COUPONS);

    const rest = await drain(reader);
    const whole = shell + rest;
    const text = visibleText(whole);

    expect(text).toContain('Approved to hold');
    expect(text).toContain('Earned to date 3 coupons paid to 0.0.10366460 997.26');
    expect(text).toContain('Next payment Coupon 4, accruing 4 December 2026 to 4 January 2027');
    expect(text).toContain('Principal 100,000');
    expect(text).toContain('Currently 100,000, 100 percent intact');
    expect(whole).toContain('https://hashscan.io/testnet/contract/0.0.10368240');
    expect(whole.match(/cover-card__shimmer/g)).toHaveLength(1);
  });

  it('lands the coupon history without waiting for the series', async () => {
    const series = deferred<SeriesView | null>();
    const coupons = deferred<CouponsView | null>();

    const stream = await renderToReadableStream(screen(series.promise, coupons.promise));
    const reader = stream.getReader();
    await readUntil(reader, 'On HashScan');

    coupons.resolve(COUPONS);
    const table = await readUntil(reader, '4 September to 4 October 2026');

    expect(table).toContain('The record dates on these coupons were brought forward');
    expect(table).not.toContain('Principal 100,000');
    expect(table).not.toContain('hashscan.io/testnet/contract');

    series.resolve(SERIES);
    await drain(reader);
  });

  it('rests nowhere at all when the figures are already in hand', () => {
    // Which is how every other test in the suite renders this screen, and why
    // they assert what it prints rather than what it is waiting for.
    const markup = renderToStaticMarkup(
      <InvestorOverview
        choices={CHOICES}
        coupons={COUPONS}
        investor={DEMO_ACCOUNTS['investor-1']}
        series={SERIES}
        seriesId={SERIES.series_id}
      />,
    );

    expect(markup).toContain('997.26');
    expect(restingStates(markup)).toBe(0);
  });
});

describe('a read that fails costs the page its figure and never the page', () => {
  it('says the series could not be loaded and keeps the coupon history', async () => {
    const stream = await renderToReadableStream(
      screen(Promise.resolve(null), Promise.resolve(COUPONS)),
    );
    const whole = await drain(stream.getReader());
    const text = visibleText(whole);

    expect(text).toContain("We can't load the series right now.");
    expect(whole).toContain('href="/invest"');
    // Earned to date is the coupon history's and is still there; the next
    // payment is the series' and an unknown one renders as no row.
    expect(text).toContain('Earned to date 3 coupons paid to 0.0.10366460 997.26');
    expect(text).not.toContain('Next payment');
    expect(text).toContain('4 September to 4 October 2026');
    // No figure stands in for the ones that could not be read.
    expect(text).not.toContain('Principal 100,000');
    expect(text).not.toContain('percent intact');
    expect(text).not.toContain('Approved to hold');
    expect(text).not.toContain('Verification needed');
    // The resting state's heading is still in the stream, hidden, which is
    // how a boundary is replaced; what matters is that no link was written.
    // The receipts in the table are the coupon history's and stay.
    expect(whole).not.toContain('hashscan.io/testnet/contract');
    expect(whole).not.toContain('hashscan.io/testnet/topic');
    expect(whole).not.toContain('data-testid="principal-bar"');
    // The page is still the page.
    expect(text).toContain('Principal at risk');
    expect(text).toContain('You earn coupons from premiums.');
    expect(whole).toContain('href="/invest/subscribe?series=ODI-COMP-2026-01"');
  });

  it('says the coupon history could not be loaded and keeps the series', async () => {
    const stream = await renderToReadableStream(
      screen(Promise.resolve(SERIES), Promise.resolve(null)),
    );
    const whole = await drain(stream.getReader());
    const text = visibleText(whole);

    expect(text).toContain("We can't load the coupon history right now.");
    expect(text).not.toContain('No coupons yet.');
    expect(text).not.toContain('Earned to date');
    // The next payment is the series' own and stays, as a row and not a card.
    expect(text).toContain('Next payment Coupon 4, accruing');
    expect(whole).not.toContain('cover-card');
    expect(text).toContain('Principal 100,000');
    expect(text).toContain('Approved to hold');
    expect(whole).toContain('https://hashscan.io/testnet/contract/0.0.10368240');
  });

  it('still renders with neither read answering', async () => {
    const stream = await renderToReadableStream(
      screen(Promise.resolve(null), Promise.resolve(null)),
    );
    const whole = await drain(stream.getReader());
    const text = visibleText(whole);

    expect(text).toContain('ODI-COMP-2026-01');
    expect(text).toContain('Computer and mathematical');
    expect(text).toContain("We can't load the series right now.");
    expect(text).toContain("We can't load the coupon history right now.");
    expect(text).not.toContain('Next payment');
    expect(text).not.toContain('Earned to date');
    expect(whole).toContain('href="/invest/subscribe?series=ODI-COMP-2026-01"');
    expect(text).not.toMatch(/[\u2013\u2014]/);
  });
});
