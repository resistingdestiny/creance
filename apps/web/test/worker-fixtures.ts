import type { IndexView, PolicyView, QuoteView } from '../src/lib/worker-api.js';

/**
 * The worker endpoints' own answers, recorded from Hedera testnet and the local
 * API on 5 September 2026, trimmed to the fields these screens read.
 *
 * Testing against recorded reality rather than invented numbers is what makes
 * the assertions mean anything. The quote is a 5,000 limit for computer and
 * mathematical priced at the archive's latest month, July 2026, which is 4.25 a
 * month; the policy is a real bind at the 1,000 limit, NFT serial 7 on
 * 0.0.10366468 with its receipt on the payments topic; the index reading is the
 * twenty-four months to July 2026, open on the level form in April and May 2026.
 */

export const INDEX: IndexView = {
  group: 'computer_math',
  group_label: 'Computer and mathematical',
  series_id: 'ODI-COMP-2026-01',
  as_of: '2026-07',
  reading: {
    period: '2026-07',
    u_g: '2.80',
    u_all: '4.40',
    e: '-1.60',
    ebar: '-1.37',
    odi: '-0.07'
  },
  trigger: {
    attachment_shock: '2.00',
    level_line: '-0.68',
    open: false,
    open_reason: null,
    shock_margin: '-2.07',
    level_margin: '-0.69'
  },
  headline: {
    form: 'level',
    distance: '0.69',
    on_the_line: false,
    open: false
  },
  history: [
    {
      period: '2024-05',
      u_g: '2.50',
      u_all: '3.70',
      e: '-1.20',
      ebar: '-0.93',
      odi: '0.27',
      open: false,
      open_reason: null
    },
    {
      period: '2024-06',
      u_g: '3.70',
      u_all: '4.30',
      e: '-0.60',
      ebar: '-0.83',
      odi: '0.40',
      open: false,
      open_reason: null
    },
    {
      period: '2024-07',
      u_g: '3.20',
      u_all: '4.50',
      e: '-1.30',
      ebar: '-1.03',
      odi: '0.60',
      open: false,
      open_reason: null
    },
    {
      period: '2024-08',
      u_g: '3.40',
      u_all: '4.40',
      e: '-1.00',
      ebar: '-0.97',
      odi: '0.80',
      open: false,
      open_reason: null
    },
    {
      period: '2024-09',
      u_g: '2.50',
      u_all: '3.90',
      e: '-1.40',
      ebar: '-1.23',
      odi: '0.50',
      open: false,
      open_reason: null
    },
    {
      period: '2024-10',
      u_g: '2.60',
      u_all: '3.90',
      e: '-1.30',
      ebar: '-1.23',
      odi: '0.34',
      open: false,
      open_reason: null
    },
    {
      period: '2024-11',
      u_g: '2.50',
      u_all: '4.00',
      e: '-1.50',
      ebar: '-1.40',
      odi: '0.17',
      open: false,
      open_reason: null
    },
    {
      period: '2024-12',
      u_g: '2.00',
      u_all: '3.80',
      e: '-1.80',
      ebar: '-1.53',
      odi: '-0.03',
      open: false,
      open_reason: null
    },
    {
      period: '2025-01',
      u_g: '2.90',
      u_all: '4.40',
      e: '-1.50',
      ebar: '-1.60',
      odi: '0.00',
      open: false,
      open_reason: null
    },
    {
      period: '2025-02',
      u_g: '3.30',
      u_all: '4.50',
      e: '-1.20',
      ebar: '-1.50',
      odi: '-0.27',
      open: false,
      open_reason: null
    },
    {
      period: '2025-03',
      u_g: '3.10',
      u_all: '4.20',
      e: '-1.10',
      ebar: '-1.27',
      odi: '-0.14',
      open: false,
      open_reason: null
    },
    {
      period: '2025-04',
      u_g: '3.50',
      u_all: '3.90',
      e: '-0.40',
      ebar: '-0.90',
      odi: '-0.13',
      open: false,
      open_reason: null
    },
    {
      period: '2025-05',
      u_g: '3.40',
      u_all: '4.00',
      e: '-0.60',
      ebar: '-0.70',
      odi: '0.23',
      open: false,
      open_reason: null
    },
    {
      period: '2025-06',
      u_g: '2.80',
      u_all: '4.40',
      e: '-1.60',
      ebar: '-0.87',
      odi: '-0.04',
      open: false,
      open_reason: null
    },
    {
      period: '2025-07',
      u_g: '2.90',
      u_all: '4.60',
      e: '-1.70',
      ebar: '-1.30',
      odi: '-0.27',
      open: false,
      open_reason: null
    },
    {
      period: '2025-08',
      u_g: '3.00',
      u_all: '4.50',
      e: '-1.50',
      ebar: '-1.60',
      odi: '-0.63',
      open: false,
      open_reason: null
    },
    {
      period: '2025-09',
      u_g: '3.90',
      u_all: '4.30',
      e: '-0.40',
      ebar: '-1.20',
      odi: '0.03',
      open: false,
      open_reason: null
    },
    {
      period: '2026-01',
      u_g: '3.60',
      u_all: '4.70',
      e: '-1.10',
      ebar: '-0.73',
      odi: '0.87',
      open: false,
      open_reason: null
    },
    {
      period: '2026-02',
      u_g: '3.80',
      u_all: '4.70',
      e: '-0.90',
      ebar: '-0.93',
      odi: '0.57',
      open: false,
      open_reason: null
    },
    {
      period: '2026-03',
      u_g: '3.90',
      u_all: '4.30',
      e: '-0.40',
      ebar: '-0.80',
      odi: '0.47',
      open: false,
      open_reason: null
    },
    {
      period: '2026-04',
      u_g: '3.50',
      u_all: '4.00',
      e: '-0.50',
      ebar: '-0.60',
      odi: '0.30',
      open: true,
      open_reason: 'level'
    },
    {
      period: '2026-05',
      u_g: '3.10',
      u_all: '4.10',
      e: '-1.00',
      ebar: '-0.63',
      odi: '0.07',
      open: true,
      open_reason: 'level'
    },
    {
      period: '2026-06',
      u_g: '2.90',
      u_all: '4.40',
      e: '-1.50',
      ebar: '-1.00',
      odi: '-0.13',
      open: false,
      open_reason: null
    },
    {
      period: '2026-07',
      u_g: '2.80',
      u_all: '4.40',
      e: '-1.60',
      ebar: '-1.37',
      odi: '-0.07',
      open: false,
      open_reason: null
    }
  ],
  source: {
    series: 'bls:LNU04034021',
    hash: 'sha256:78a58e0898fa1c607cf61125381e9c02c8890382fd0b1c0090e02a4fe4af1ce5',
    model_version: 'odi-1.0.0',
    replay: false
  },
  publication: {
    topic_id: null,
    sequence_number: null,
    submit_transaction: null
  }
};

export const QUOTE: QuoteView = {
  quote_id: 'qte_01M1RH76FCPJP35YDF3GPJFF4W',
  series_id: 'ODI-COMP-2026-01',
  group: 'computer_math',
  wallet: '0.0.10366453',
  limit: {
    amount: '5000000000',
    asset: '0.0.10366463',
    decimals: 6,
    display: '5000.00'
  },
  premium: {
    amount: '4250000',
    asset: '0.0.10366463',
    decimals: 6,
    display: '4.25'
  },
  annual_rate_bps: 102,
  term_months: 12,
  waiting_period_days: 60,
  cover_starts: '2026-09-05',
  cover_ends: '2027-09-05',
  claims_payable_from: '2026-11-04',
  first_payment_due: '2026-09-05',
  pays_from: '0.0.10366453',
  attachment_shock: '2.00',
  level_line: '-0.68',
  payout_mode: 'full',
  capacity: {
    free_before: '94000000000',
    free_after: '89000000000',
    used_pct: 6
  },
  expires_at: '2026-09-05T10:33:25Z'
};

export const POLICY: PolicyView = {
  policy_id: 'pol_01M1RH7F6FXF9G9YKQGG4F7BR2',
  series_id: 'ODI-COMP-2026-01',
  group: 'computer_math',
  status: 'bound',
  limit: {
    amount: '1000000000',
    asset: '0.0.10366463',
    decimals: 6,
    display: '1000.00'
  },
  premium: {
    amount: '850000',
    asset: '0.0.10366463',
    decimals: 6,
    display: '0.85'
  },
  cover_starts: '2026-09-05',
  cover_ends: '2027-09-05',
  claims_payable_from: '2026-11-04',
  next_payment_due: '2026-10-05',
  paid_through: '2026-09',
  holder_account: '0.0.10366453',
  nft: {
    token_id: '0.0.10366468',
    serial: 7
  },
  hcs_receipt: {
    topic_id: '0.0.10366471',
    sequence_number: 21
  },
  chain: {
    cover_pool: '0x6358ddd5AA2e1797ddA949D7d82eA86C9F89ff09',
    bind_transaction: '0xf30541616254d325cd084c1a2804d98fb97d39c7501b7c8709859425353256fa',
    hashscan: 'https://hashscan.io/testnet/transaction/0xf30541616254d325cd084c1a2804d98fb97d39c7501b7c8709859425353256fa'
  }
};

/** The same reading with the latest month past the level line, as April 2026 was. */
export function openIndex(): IndexView {
  const history = INDEX.history.map((point) =>
    point.period === '2026-07' ? { ...point, ebar: '-0.60', open: true, open_reason: 'level' } : point,
  );
  return {
    ...INDEX,
    reading: { ...INDEX.reading, ebar: '-0.60' },
    trigger: { ...INDEX.trigger, open: true, open_reason: 'level', level_margin: '0.08' },
    headline: { form: 'level', distance: '-0.08', on_the_line: false, open: true },
    history,
  };
}
