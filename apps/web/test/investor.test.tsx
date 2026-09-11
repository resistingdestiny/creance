import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { InvestorOverview } from '../src/app/invest/investor-overview.js';
import { PrincipalBar } from '../src/components/principal-bar.js';
import type { CouponsView } from '../src/lib/investor-api.js';
import {
  capacityLine,
  couponHistory,
  couponLine,
  couponPeriod,
  earnedToDate,
  firstSettledCoupon,
  holderFor,
  nextPayment,
  principalAtRisk,
  principalCaption,
  principalSegments,
  recordDatesBroughtForward,
  seriesName,
  termLine,
} from '../src/lib/investor-model.js';
import { DEMO_ACCOUNTS, demoInvestorAccount, readDemoInvestor } from '../src/lib/wallet.js';
import { COUPONS, INVESTOR_1, SERIES, claimsOpenSeries } from './investor-fixtures.js';

/** Everything a person reads, with the markup taken out. */
function visibleText(markup: string): string {
  return markup
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

describe('the principal, in three parts', () => {
  it('splits funded into paid, reserved and what is left', () => {
    const segments = principalSegments(claimsOpenSeries());
    expect(segments.paid).toBe(5_000_000_000n);
    expect(segments.reserved).toBe(15_000_000_000n);
    expect(segments.intact).toBe(80_000_000_000n);
  });

  it('makes the three widths add up to a hundred', () => {
    const segments = principalSegments(claimsOpenSeries());
    expect(segments.paidPercent).toBe(5);
    expect(segments.reservedPercent).toBe(15);
    expect(segments.intactPercent).toBe(80);
  });

  it('reads a series with nothing paid and nothing reserved as wholly intact', () => {
    const segments = principalSegments(SERIES);
    expect(segments.intact).toBe(100_000_000_000n);
    expect(segments.intactPercent).toBe(100);
  });

  it('interpolates the addendum caption from the figures, never from constants', () => {
    expect(principalCaption(claimsOpenSeries())).toBe(
      '100,000 principal. 15,000 reserved while claims are open. 5,000 paid so far.',
    );
  });

  it('drops a clause whose figure is nought rather than writing a zero', () => {
    expect(principalCaption(SERIES)).toBe('100,000 principal. None reserved, none paid.');
  });
});

describe('the principal bar', () => {
  it('draws the segments in the addendum order: paid, reserved, intact', () => {
    const segments = principalSegments(claimsOpenSeries());
    const markup = renderToStaticMarkup(
      <PrincipalBar
        intactPercent={segments.intactPercent}
        label="bar"
        paidPercent={segments.paidPercent}
        reservedPercent={segments.reservedPercent}
      />,
    );
    const order = [...markup.matchAll(/data-segment="([a-z]+)"/g)].map((match) => match[1]);
    expect(order).toEqual(['paid', 'reserved', 'intact']);
  });

  it('hatches the reserved segment and fills the paid segment in ink', () => {
    const segments = principalSegments(claimsOpenSeries());
    const markup = renderToStaticMarkup(
      <PrincipalBar
        intactPercent={segments.intactPercent}
        label="bar"
        paidPercent={segments.paidPercent}
        reservedPercent={segments.reservedPercent}
      />,
    );
    expect(markup).toContain('principal-bar__reserved');
    expect(markup).toContain('border border-hairline bg-canvas');
    expect(markup).toMatch(/data-segment="paid"[^>]*style="width:5%"/);
  });

  it('renders no zero width segment, so nothing paints as a stray hairline', () => {
    const segments = principalSegments(SERIES);
    const markup = renderToStaticMarkup(
      <PrincipalBar
        intactPercent={segments.intactPercent}
        label="bar"
        paidPercent={segments.paidPercent}
        reservedPercent={segments.reservedPercent}
      />,
    );
    const order = [...markup.matchAll(/data-segment="([a-z]+)"/g)].map((match) => match[1]);
    expect(order).toEqual(['intact']);
  });

  it('is named for a screen reader, because colour is never the only signal', () => {
    const markup = renderToStaticMarkup(
      <PrincipalBar intactPercent={100} label="100,000 principal." paidPercent={0} reservedPercent={0} />,
    );
    expect(markup).toContain('role="img"');
    expect(markup).toContain('aria-label="100,000 principal."');
  });
});

describe('principal at risk', () => {
  it('says the current figure and the share still intact, with a comma and no dash', () => {
    expect(principalAtRisk(SERIES).current).toBe('Currently 100,000, 100 percent intact');
  });

  it('names the worst case only while a reserve is held', () => {
    expect(principalAtRisk(SERIES).ifTriggered).toBeNull();
    expect(principalAtRisk(claimsOpenSeries()).ifTriggered).toBe('80,000 if triggered');
  });

  // The live state since T07 began binding policies: capacity is taken but no
  // month is open, so the vault has earmarked nothing. Capacity used and
  // principal at risk are different questions and must not move together.
  it('keeps the worst case hidden when cover is bound but nothing is reserved', () => {
    const bound = {
      ...SERIES,
      cover_pool: {
        ...SERIES.cover_pool!,
        active_exposure: { ...SERIES.cover_pool!.active_exposure, amount: '2000000000' },
        capacity_used_percent: 2,
      },
    };
    expect(capacityLine(bound)).toBe('2 percent');
    expect(principalAtRisk(bound).ifTriggered).toBeNull();
    expect(principalAtRisk(bound).current).toBe('Currently 100,000, 100 percent intact');
  });
});

describe('the series rows', () => {
  it('says the coupon rate as a word, from the declared coupon', () => {
    expect(couponLine(SERIES)).toBe('8 percent a year, paid monthly');
  });

  it('says the term in months, from the CoverPool', () => {
    expect(termLine(SERIES)).toBe('12 months');
  });

  it('measures capacity used against the principal', () => {
    expect(capacityLine(SERIES)).toBe('0 percent');
    expect(
      capacityLine({
        ...SERIES,
        cover_pool: { ...SERIES.cover_pool!, capacity_used_percent: 45 },
      }),
    ).toBe('45 percent');
  });

  it('has nothing to say about a series the CoverPool never registered', () => {
    const unregistered = {
      ...SERIES,
      cover_pool: { ...SERIES.cover_pool!, registered: false, term_months: null },
    };
    expect(termLine(unregistered)).toBeNull();
    expect(capacityLine(unregistered)).toBeNull();
  });
});

describe('the coupon history', () => {
  it('is one row per coupon and holder, newest first', () => {
    const rows = couponHistory(COUPONS);
    // Three settled periods and two noteholders.
    expect(rows).toHaveLength(6);
    expect(rows[0]!.couponId).toBe('3');
    expect(rows.at(-1)!.couponId).toBe('1');
  });

  it('reads as an accruing series: three periods, month after month', () => {
    const periods = [...new Set(couponHistory(COUPONS).map((row) => row.period))];
    expect(periods).toEqual([
      '4 November to 4 December 2026',
      '4 October to 4 November 2026',
      '4 September to 4 October 2026',
    ]);
  });

  it('dates a row by when it settled and links the executed transaction', () => {
    const row = couponHistory(COUPONS).at(-1)!;
    expect(row.day).toBe('4 September 2026');
    expect(row.period).toBe('4 September to 4 October 2026');
    expect(row.amount).toBe('328.77');
    expect(row.settled).toBe(true);
    expect(row.transaction).toBe(
      'https://hashscan.io/testnet/transaction/0.0.10366450-1788556746-724064738',
    );
  });

  it('writes the year once where a period does not cross one', () => {
    expect(couponPeriod('2026-12-04T20:16:23Z', '2027-01-04T20:16:23Z')).toBe(
      '4 December 2026 to 4 January 2027',
    );
    expect(couponPeriod('2026-10-04T20:16:23Z', '2026-11-04T20:16:23Z')).toBe(
      '4 October to 4 November 2026',
    );
  });

  it('says the record dates were brought forward, because they were', () => {
    expect(recordDatesBroughtForward(COUPONS)).toBe(true);
    // A coupon snapshotted at the end of the month it paid for is the live
    // cadence and says nothing.
    const live: CouponsView = {
      ...COUPONS,
      coupons: [{ ...COUPONS.coupons[0]!, record_date: '2026-10-04T20:16:23Z' }],
    };
    expect(recordDatesBroughtForward(live)).toBe(false);
  });

  it('does not call an executed schedule a payment when the transfer did not settle', () => {
    const unsettled: CouponsView = {
      ...COUPONS,
      coupons: [
        {
          ...COUPONS.coupons[0]!,
          holders: [
            {
              ...COUPONS.coupons[0]!.holders[0]!,
              settlement: {
                ...COUPONS.coupons[0]!.holders[0]!.settlement,
                settled: false,
                result: 'CONTRACT_REVERT_EXECUTED',
              },
            },
          ],
        },
      ],
    };
    expect(couponHistory(unsettled)[0]!.settled).toBe(false);
  });

  it('finds the first coupon a holder was actually paid', () => {
    const first = firstSettledCoupon(COUPONS, INVESTOR_1);
    expect(first?.amount).toBe('328.77');
    expect(first?.couponId).toBe('1');
    expect(firstSettledCoupon(COUPONS, '0x0000000000000000000000000000000000000000')).toBeNull();
  });
});

describe('earned to date', () => {
  it('adds up what this noteholder was actually paid, and nobody else', () => {
    const earned = earnedToDate(COUPONS, INVESTOR_1);
    // 328.767123 plus 339.726027 plus 328.767123.
    expect(earned?.total).toBe(997_260_273n);
    expect(earned?.amount).toBe('997.26');
    expect(earned?.coupons).toBe(3);
  });

  it('counts only what settled, because an executed schedule is not a payment', () => {
    const halfPaid: CouponsView = {
      ...COUPONS,
      coupons: COUPONS.coupons.slice(0, 1).map((coupon) => ({
        ...coupon,
        holders: coupon.holders.map((holder) => ({
          ...holder,
          settlement: { ...holder.settlement, settled: false, result: 'CONTRACT_REVERT_EXECUTED' },
        })),
      })),
    };
    expect(earnedToDate(halfPaid, INVESTOR_1)).toBeNull();
  });

  it('is nothing rather than nought on a series with no noteholders', () => {
    // Fifteen of the sixteen series are like this. A row reading 0.00 would
    // suggest a position that does not exist.
    expect(earnedToDate({ ...COUPONS, coupons: [] }, INVESTOR_1)).toBeNull();
  });
});

describe('the next payment', () => {
  it('is the declared coupon on the note, by its execution date', () => {
    const next = nextPayment(SERIES);
    expect(next?.day).toBe('5 January 2027');
    expect(next?.period).toBe('4 December 2026 to 4 January 2027');
    expect(next?.couponId).toBe('4');
  });

  it('says nothing where the note has declared no further coupon', () => {
    expect(
      nextPayment({ ...SERIES, coupons: { ...SERIES.coupons, next: null } }),
    ).toBeNull();
  });
});

describe('what a series covers', () => {
  it('names the occupation from the group, through the one mapping', () => {
    expect(seriesName({ kind: 'occupation', group: 'computer_math' })).toBe(
      'Computer and mathematical',
    );
    expect(seriesName({ kind: 'occupation', group: 'office_admin_support' })).toBe(
      'Office and administrative support',
    );
  });

  it('names the maturity demonstration for what it is, not for an occupation', () => {
    expect(seriesName({ kind: 'maturity_demonstration', group: '' })).toBe(
      'Maturity demonstration',
    );
  });

  it('names nothing at all for a group this bundle does not know', () => {
    expect(seriesName({ kind: 'occupation', group: 'astronaut' })).toBeNull();
  });
});

describe('the demo investor wallet', () => {
  it('presents a noteholder, not the policyholder the worker flow uses', () => {
    expect(demoInvestorAccount().accountId).toBe('0.0.10366460');
    expect(demoInvestorAccount().accountId).not.toBe(DEMO_ACCOUNTS['policyholder-1'].accountId);
  });

  it('can be pointed at the second noteholder', () => {
    expect(readDemoInvestor('investor-2')).toBe('investor-2');
    expect(demoInvestorAccount('investor-2').accountId).toBe('0.0.10366462');
  });

  it('falls back to a noteholder for anything it does not recognise', () => {
    expect(readDemoInvestor('nonsense')).toBe('investor-1');
    expect(readDemoInvestor(undefined)).toBe('investor-1');
  });

  it('is the account the note granted KYC to', () => {
    expect(holderFor(SERIES, demoInvestorAccount().evmAddress)?.kyc.granted).toBe(true);
  });
});

const CHOICES = [
  {
    series_id: 'ODI-COMP-2026-01',
    series_key: '0x4f44492d434f4d502d323032362d303100000000000000000000000000000000',
    group: 'computer_math',
    kind: 'occupation',
    matures_at: '2027-09-04T00:00:00.000Z',
    has_note: true,
    links: { self: '/v1/series/ODI-COMP-2026-01', coupons: '/v1/series/ODI-COMP-2026-01/coupons' },
  },
  {
    series_id: 'ODI-OFFC-2026-01',
    series_key: '0x4f44492d4f4646432d323032362d303100000000000000000000000000000000',
    group: 'office_admin_support',
    kind: 'occupation',
    matures_at: '2027-09-10T00:00:00.000Z',
    has_note: true,
    links: { self: '/v1/series/ODI-OFFC-2026-01', coupons: '/v1/series/ODI-OFFC-2026-01/coupons' },
  },
] as const;

describe('the series a screen offers a choice from', () => {
  it('links every series the API listed, marking the one on screen', () => {
    const markup = renderToStaticMarkup(
      <InvestorOverview
        choices={CHOICES}
        coupons={COUPONS}
        investor={DEMO_ACCOUNTS['investor-1']}
        series={SERIES}
        seriesId={SERIES.series_id}
      />,
    );
    expect(markup).toContain('href="/invest?series=ODI-OFFC-2026-01"');
    expect(markup).toContain('aria-current="page"');
  });

  it('says what each series covers, not only its identifier', () => {
    const markup = renderToStaticMarkup(
      <InvestorOverview
        choices={CHOICES}
        coupons={COUPONS}
        investor={DEMO_ACCOUNTS['investor-1']}
        series={SERIES}
        seriesId={SERIES.series_id}
      />,
    );
    expect(visibleText(markup)).toContain('Office and administrative support');
    // The identifier is still reachable on the link itself.
    expect(markup).toContain('title="ODI-OFFC-2026-01"');
  });

  it('sends the head of the list to the route with no query string', () => {
    const markup = renderToStaticMarkup(
      <InvestorOverview
        choices={CHOICES}
        coupons={COUPONS}
        investor={DEMO_ACCOUNTS['investor-1']}
        series={SERIES}
        seriesId={SERIES.series_id}
      />,
    );
    expect(markup).toContain('href="/invest/subscribe"');
  });

  it('offers nothing to choose when the deployment serves one series', () => {
    const markup = renderToStaticMarkup(
      <InvestorOverview
        choices={[CHOICES[0]]}
        coupons={COUPONS}
        investor={DEMO_ACCOUNTS['investor-1']}
        series={SERIES}
        seriesId={SERIES.series_id}
      />,
    );
    expect(markup).not.toContain('aria-label="Series"');
  });
});

describe('the investor overview screen', () => {
  const markup = renderToStaticMarkup(
    <InvestorOverview coupons={COUPONS} investor={DEMO_ACCOUNTS['investor-1']} series={SERIES} seriesId={SERIES.series_id} />,
  );
  const text = visibleText(markup);

  it('carries the copy deck strings verbatim', () => {
    for (const string of [
      'ODI-COMP-2026-01',
      'KYC approved',
      'Principal',
      'Reserved for claims',
      'Paid to policyholders',
      'Coupon',
      '8 percent a year, paid monthly',
      'Term',
      '12 months',
      'Matures',
      '4 September 2027',
      'Capacity used',
      // The deck says "Subscribe", which stays on the screen this opens,
      // where an amount is being subscribed for. On the way in the page says
      // what it is offering in words a person who does not work in finance
      // reads without stopping.
      'Invest now',
      'Principal at risk',
      'Currently 100,000, 100 percent intact',
      'Coupon history',
      'You earn coupons from premiums. If the index for this occupation is triggered, part of your principal pays out to policyholders. Anything left is returned at maturity.',
    ]) {
      expect(text).toContain(string);
    }
  });

  it('opens with the call to action instead of burying it under the page', () => {
    // The only way to invest used to be a pill below the coupon table and the
    // principal bar, which put the reason the page exists below the fold on
    // every display. The primary is on the heading's line now, and it is
    // drawn before the first section heading in the markup.
    const first = markup.indexOf('Invest now');
    expect(first).toBeGreaterThan(-1);
    expect(first).toBeLessThan(markup.indexOf('Coupon history'));
    // And it needs no read to draw, so it is there whether or not the chain
    // answered: the series id came off the list.
    const cold = renderToStaticMarkup(
      <InvestorOverview
        coupons={null}
        investor={DEMO_ACCOUNTS['investor-1']}
        series={null}
        seriesId={SERIES.series_id}
      />,
    );
    expect(cold).toContain('href="/invest/subscribe?series=ODI-COMP-2026-01"');
  });

  it('repeats the same door at the end of the read, one rank down', () => {
    // Two calls to action, the same words, two levels: a screen has one
    // primary, and the second is a repeat for somebody who has just read what
    // their principal is exposed to and should not have to scroll back up.
    // The repeat is the secondary and not the tertiary: it stands on its own
    // line under a paragraph, and a control with no edge and no plate there
    // reads as a heading rather than as something to press.
    const actions = [...markup.matchAll(/<a class="([^"]*)"[^>]*>Invest now<\/a>/g)].map(
      (match) => match[1] ?? '',
    );
    expect(actions).toHaveLength(2);
    expect(actions[0]).toContain('bg-ink');
    expect(actions[1]).toContain('bg-canvas');
    expect(actions[1]).toContain('border-hairline');
    expect(actions[1]).not.toContain('bg-ink');
  });

  it('shows the reserved and paid figures the vault holds', () => {
    const open = visibleText(
      renderToStaticMarkup(
        <InvestorOverview
          coupons={COUPONS}
          investor={DEMO_ACCOUNTS['investor-1']}
          series={claimsOpenSeries()}
        seriesId={SERIES.series_id}
      />,
      ),
    );
    expect(open).toContain('Reserved for claims 15,000');
    expect(open).toContain('Paid to policyholders 5,000');
    expect(open).toContain('80,000 if triggered');
  });

  it('says verification is needed for an account the note has not granted', () => {
    const stranger = visibleText(
      renderToStaticMarkup(
        <InvestorOverview
          coupons={COUPONS}
          investor={DEMO_ACCOUNTS['policyholder-1']}
          series={SERIES}
        seriesId={SERIES.series_id}
      />,
      ),
    );
    expect(stranger).toContain('Verification needed');
    expect(stranger).not.toContain('KYC approved');
  });

  it('never hides that the wallet is a demo one', () => {
    expect(text).toContain('Demo wallet. Testnet only.');
    expect(text).toContain('0.0.10366460');
  });

  it('links the note as a contract, because the note is not a token', () => {
    expect(markup).toContain('https://hashscan.io/testnet/contract/0.0.10368240');
    expect(markup).not.toContain('/testnet/token/0.0.10368240');
  });

  it('never says associate, which is a word for an HTS token', () => {
    expect(text.toLowerCase()).not.toContain('associate');
  });

  it('carries no em dash, no en dash and no percent glyph', () => {
    expect(text).not.toMatch(/[–—%]/);
  });

  it('puts the coupon settlement in the table with a link to its transaction', () => {
    expect(text).toContain('328.77');
    expect(text).toContain('Settled');
    expect(markup).toContain(
      'https://hashscan.io/testnet/transaction/0.0.10366450-1788556746-724064738',
    );
  });

  it('answers what this account has earned, tabular, above the transactions', () => {
    expect(text).toContain('Earned to date 3 coupons paid to 0.0.10366460 997.26');
    // The heading comes before the total, and the total before the table.
    expect(text.indexOf('Coupon history')).toBeLessThan(text.indexOf('Earned to date'));
    expect(text.indexOf('Earned to date')).toBeLessThan(text.indexOf('Period'));
  });

  it('says when the next payment falls due, from the declared coupon', () => {
    expect(text).toContain(
      'Next payment Coupon 4, accruing 4 December 2026 to 4 January 2027 5 January 2027',
    );
  });

  it('shows every period that was paid, with a receipt on each row', () => {
    for (const period of [
      '4 September to 4 October 2026',
      '4 October to 4 November 2026',
      '4 November to 4 December 2026',
    ]) {
      expect(text).toContain(period);
    }
    // One receipt per settled row, and every one of them a transaction.
    expect(markup.match(/hashscan\.io\/testnet\/transaction/g)).toHaveLength(6);
    expect(markup).toContain(
      'https://hashscan.io/testnet/transaction/0.0.10366450-1789080523-877923930',
    );
  });

  it('says on screen that the record dates were brought forward', () => {
    expect(text).toContain('The record dates on these coupons were brought forward');
    expect(text).toContain('Every payment below settled on Hedera testnet.');
  });

  it('puts the history in a labelled region a keyboard can scroll at 390', () => {
    expect(markup).toContain('role="region"');
    expect(markup).toContain('aria-label="Coupon history"');
    expect(markup).toContain('tabindex="0"');
    expect(markup).toContain('overflow-x-auto');
  });

  it('names the occupation beside the series identifier', () => {
    // The name comes from the group the API lists the series under, which is
    // in hand before either chain read is, so the heading never waits on one.
    const named = visibleText(
      renderToStaticMarkup(
        <InvestorOverview
          choices={CHOICES}
          coupons={COUPONS}
          investor={DEMO_ACCOUNTS['investor-1']}
          series={SERIES}
          seriesId={SERIES.series_id}
        />,
      ),
    );
    expect(named).toContain('ODI-COMP-2026-01');
    expect(named).toContain('Computer and mathematical');
  });

  it('says so plainly when a series has no coupons yet', () => {
    const empty = visibleText(
      renderToStaticMarkup(
        <InvestorOverview
          coupons={{ ...COUPONS, coupons: [] }}
          investor={DEMO_ACCOUNTS['investor-1']}
          series={SERIES}
        seriesId={SERIES.series_id}
      />,
      ),
    );
    expect(empty).toContain('No coupons yet.');
    // Nothing earned is nothing, not 0.00.
    expect(empty).not.toContain('Earned to date');
  });

  it('is a 1280 frame with the sheet 40px side margins, not the 390 worker frame', () => {
    expect(markup).toContain('max-w-[1280px]');
    expect(markup).toContain('px-10');
    expect(markup).not.toContain('max-w-[390px]');
  });
});

describe('the note on the metal (T49)', () => {
  const markup = renderToStaticMarkup(
    <InvestorOverview coupons={COUPONS} investor={DEMO_ACCOUNTS['investor-1']} series={SERIES} seriesId={SERIES.series_id} />,
  );

  /** The one card on the page, from its opening tag to the end of its content. */
  function certificate(from: string): string {
    return /<div class="cover-card cover-card--certificate[^"]*"[\s\S]*?<\/div><\/div>/.exec(from)?.[0] ?? '';
  }

  it('draws the position as a certificate in the metal, with the shimmer', () => {
    const card = certificate(markup);
    expect(card).toContain('cover-card--metal');
    expect(card).toContain('cover-card__shimmer');
    expect(card).toContain('Earned to date');
    expect(card).toContain('Next payment');
  });

  it('spends this screen one shimmer and no more', () => {
    // docs/DESIGN-TOKENS-ADDENDUM.md, "The metal": at most one shimmering
    // element in view. The certificate is it, so nothing else on the page may
    // carry the class.
    expect(markup.match(/cover-card__shimmer/g)).toHaveLength(1);
    expect(markup.match(/cover-card--metal/g)).toHaveLength(1);
  });

  it('keeps the light under the words, like every other card', () => {
    const card = certificate(markup);
    expect(card.indexOf('cover-card__shimmer')).toBeLessThan(card.indexOf('cover-card__content'));
    expect(card.indexOf('cover-card__content')).toBeLessThan(card.indexOf('Earned to date'));
  });

  it('leaves the table and the terms on canvas and surface', () => {
    // The material carries identity and value, never ordinary content: the
    // coupon history is still a table and the series terms are still rows in
    // a surface group.
    const afterCard = markup.slice(markup.indexOf('<table'));
    expect(afterCard).toContain('Period');
    expect(afterCard).not.toContain('cover-card');
    expect(afterCard).toContain('bg-surface');
  });

  it('spends no shimmer on a series that has paid this account nothing', () => {
    // No headline figure, no certificate. The next payment stays a row in a
    // surface group, as it was, and the screen has no moving light at all.
    const empty = renderToStaticMarkup(
      <InvestorOverview
        coupons={{ ...COUPONS, coupons: [] }}
        investor={DEMO_ACCOUNTS['investor-1']}
        series={SERIES}
        seriesId={SERIES.series_id}
      />,
    );
    expect(empty).not.toContain('cover-card');
    expect(empty).not.toContain('cover-card__shimmer');
    expect(visibleText(empty)).toContain('Next payment Coupon 4, accruing');
  });
});
