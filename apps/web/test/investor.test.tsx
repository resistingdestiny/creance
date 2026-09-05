import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { InvestorOverview } from '../src/app/invest/investor-overview.js';
import { PrincipalBar } from '../src/components/principal-bar.js';
import type { CouponsView, SeriesView } from '../src/lib/investor-api.js';
import {
  capacityLine,
  couponHistory,
  couponLine,
  firstSettledCoupon,
  holderFor,
  principalAtRisk,
  principalCaption,
  principalSegments,
  termLine,
} from '../src/lib/investor-model.js';
import { DEMO_ACCOUNTS, demoInvestorAccount, readDemoInvestor } from '../src/lib/wallet.js';

/**
 * The fixtures are the responses `GET /v1/series/ODI-COMP-2026-01` and its
 * coupons returned from Hedera testnet on 5 September 2026, trimmed to the
 * fields these screens read. Testing against recorded reality rather than
 * invented numbers is what makes the arithmetic assertions below mean
 * anything: 100,000 funded, nothing paid, nothing reserved, one coupon settled
 * at 328.767123 to each of two noteholders.
 */

function money(amount: string) {
  return { amount, asset: '0.0.10366463', decimals: 6, display: amount };
}

const INVESTOR_1 = '0xb6c2ff466e3c73f1a49a3f1b936f8e3837112931';
const INVESTOR_2 = '0xcaa1184cd59b9296f757efc7303a10ecec6ce51e';

const SERIES: SeriesView = {
  series_id: 'ODI-COMP-2026-01',
  series_key: '0x4f44492d434f4d502d323032362d303100000000000000000000000000000000',
  group: 'computer_math',
  network: 'testnet',
  settlement_asset: {
    token_id: '0.0.10366463',
    address: '0x00000000000000000000000000000000009e2dff',
    decimals: 6,
    symbol: 'TUSD',
  },
  vault: {
    address: '0xD0473d355ECB299F2ECc0d92124bc8CF63554e60',
    contract_id: '0.0.10367194',
    matures_at: '2027-09-04T18:22:42Z',
    principal_funded: money('100000000000'),
    principal_paid: money('0'),
    principal_reserved: money('0'),
    principal_redeemed: money('0'),
    principal_remaining: money('100000000000'),
    principal_free: money('100000000000'),
    premium_balance: money('0'),
    hashscan: 'https://hashscan.io/testnet/contract/0.0.10367194',
  },
  note: {
    contract_id: '0.0.10368240',
    address: '0xBB14C072d2861B944C18e5f873C5aEa71c2F1f36',
    name: 'Creance Displacement Bond Note ODI-COMP-2026-01',
    symbol: 'CDBN01',
    decimals: 6,
    total_supply: '100000000',
    units: '100',
    matures_at: '2027-09-04T18:22:42Z',
    paused: false,
    hashscan: 'https://hashscan.io/testnet/contract/0.0.10368240',
  },
  holders: [
    {
      role: 'investor-1',
      account_id: '0.0.10366460',
      address: INVESTOR_1,
      note_balance: '50000000',
      note_frozen: '0',
      note_position: '50000000',
      note_units: '50',
      subscription: money('50000000000'),
      kyc: { status: 1, granted: true },
      hashscan: 'https://hashscan.io/testnet/account/0.0.10366460',
    },
    {
      role: 'investor-2',
      account_id: '0.0.10366462',
      address: INVESTOR_2,
      note_balance: '50000000',
      note_frozen: '0',
      note_position: '50000000',
      note_units: '50',
      subscription: money('50000000000'),
      kyc: { status: 1, granted: true },
      hashscan: 'https://hashscan.io/testnet/account/0.0.10366462',
    },
  ],
  cover_pool: {
    address: '0x6358ddd5AA2e1797ddA949D7d82eA86C9F89ff09',
    contract_id: '0.0.10367199',
    registered: true,
    active_exposure: money('0'),
    exposure_covered: money('0'),
    capacity_used_percent: 0,
    term_seconds: 31_536_000,
    term_months: 12,
    hashscan: 'https://hashscan.io/testnet/contract/0.0.10367199',
  },
  coupons: { count: 1, settled: 1, latest_coupon_id: '1', rate_percent: '8' },
  links: {
    coupons: '/v1/series/ODI-COMP-2026-01/coupons',
    payments_topic: 'https://hashscan.io/testnet/topic/0.0.10366471',
  },
};

const COUPONS: CouponsView = {
  series_id: 'ODI-COMP-2026-01',
  series_key: SERIES.series_key,
  payments_topic: 'https://hashscan.io/testnet/topic/0.0.10366471',
  coupons: [
    {
      coupon_id: '1',
      coupon_ref: 'ODI-COMP-2026-01#1',
      rate_percent: '8',
      accrual_start: '2026-09-04T20:16:23Z',
      accrual_end: '2026-10-04T20:16:23Z',
      record_date: '2026-09-04T20:21:23Z',
      execution_date: '2026-09-04T20:26:23Z',
      total: money('657534246'),
      holders: [
        {
          role: 'investor-1',
          account_id: '0.0.10366460',
          address: INVESTOR_1,
          amount: money('328767123'),
          settlement: {
            schedule_id: '0.0.10368878',
            transaction_id: '0.0.10366450-1788556746-724064738',
            result: 'SUCCESS',
            settled: true,
            paid_at: '2026-09-04T21:21:11Z',
            topic_sequence_number: '1',
            hashscan: {
              schedule: 'https://hashscan.io/testnet/schedule/0.0.10368878',
              transaction:
                'https://hashscan.io/testnet/transaction/0.0.10366450-1788556746-724064738',
            },
          },
        },
        {
          role: 'investor-2',
          account_id: '0.0.10366462',
          address: INVESTOR_2,
          amount: money('328767123'),
          settlement: {
            schedule_id: '0.0.10368880',
            transaction_id: '0.0.10366450-1788556748-511830975',
            result: 'SUCCESS',
            settled: true,
            paid_at: '2026-09-04T21:21:11Z',
            topic_sequence_number: '2',
            hashscan: {
              schedule: 'https://hashscan.io/testnet/schedule/0.0.10368880',
              transaction:
                'https://hashscan.io/testnet/transaction/0.0.10366450-1788556748-511830975',
            },
          },
        },
      ],
    },
  ],
};

/** The same series part way through a claim window: 15,000 reserved, 5,000 paid. */
function claimsOpenSeries(): SeriesView {
  return {
    ...SERIES,
    vault: {
      ...SERIES.vault,
      principal_paid: money('5000000000'),
      principal_reserved: money('15000000000'),
      principal_remaining: money('95000000000'),
      principal_free: money('80000000000'),
    },
  };
}

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
    expect(rows).toHaveLength(2);
    expect(rows[0]!.accountId).toBe('0.0.10366462');
    expect(rows[1]!.accountId).toBe('0.0.10366460');
  });

  it('dates a row by when it settled and links the executed transaction', () => {
    const row = couponHistory(COUPONS)[1]!;
    expect(row.day).toBe('4 September 2026');
    expect(row.amount).toBe('328.77');
    expect(row.settled).toBe(true);
    expect(row.transaction).toBe(
      'https://hashscan.io/testnet/transaction/0.0.10366450-1788556746-724064738',
    );
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
    expect(firstSettledCoupon(COUPONS, INVESTOR_1)?.amount).toBe('328.77');
    expect(firstSettledCoupon(COUPONS, '0x0000000000000000000000000000000000000000')).toBeNull();
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

describe('the investor overview screen', () => {
  const markup = renderToStaticMarkup(
    <InvestorOverview coupons={COUPONS} investor={DEMO_ACCOUNTS['investor-1']} series={SERIES} />,
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
      'Subscribe',
      'Principal at risk',
      'Currently 100,000, 100 percent intact',
      'Coupon history',
      'You earn coupons from premiums. If the index for this occupation is triggered, part of your principal pays out to policyholders. Anything left is returned at maturity.',
    ]) {
      expect(text).toContain(string);
    }
  });

  it('shows the reserved and paid figures the vault holds', () => {
    const open = visibleText(
      renderToStaticMarkup(
        <InvestorOverview
          coupons={COUPONS}
          investor={DEMO_ACCOUNTS['investor-1']}
          series={claimsOpenSeries()}
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

  it('says so plainly when a series has no coupons yet', () => {
    const empty = visibleText(
      renderToStaticMarkup(
        <InvestorOverview
          coupons={{ ...COUPONS, coupons: [] }}
          investor={DEMO_ACCOUNTS['investor-1']}
          series={SERIES}
        />,
      ),
    );
    expect(empty).toContain('No coupons yet.');
  });

  it('is a 1280 frame with the sheet 40px side margins, not the 390 worker frame', () => {
    expect(markup).toContain('max-w-[1280px]');
    expect(markup).toContain('px-10');
    expect(markup).not.toContain('max-w-[390px]');
  });
});
