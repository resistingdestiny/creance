import type { ClaimStatusView, ReplayView } from '../src/lib/claim-api.js';
import type { AdminClaimDetail, AdminClaimSummary } from '../src/lib/admin-api.js';
import type { PolicyView } from '../src/lib/worker-api.js';

/**
 * The claim endpoints' own answers, recorded from the local API and Hedera
 * testnet on 5 September 2026 during the T16 run.
 *
 * Both claims are real. `PAID_CLAIM` is packet A, submitted through the claim
 * screens, referred by the Adjuster, approved from the review queue and paid on
 * testnet; `DECLINED_CLAIM` is packet B, the resignation, declined by the
 * Adjuster in under a second with no document read. The covers behind them were
 * bound with `testnet:bind-backdated`, which is why they start in December
 * 2025.
 *
 * Testing against recorded reality rather than invented numbers is what makes
 * the assertions mean anything: every hash, sequence number and transaction
 * below can be looked up on HashScan.
 */

export const OPEN_POLICY: PolicyView = {
  policy_id: 'pol_01M1S77VCWJ7VMMFXANN0N7G19',
  series_id: 'ODI-COMP-2026-01',
  group: 'computer_math',
  status: 'active',
  limit: { amount: '1000000000', asset: '0.0.10366463', decimals: 6, display: '1000.00' },
  premium: { amount: '28000000', asset: '0.0.10366463', decimals: 6, display: '28.00' },
  cover_starts: '2025-12-01',
  cover_ends: '2026-12-01',
  claims_payable_from: '2026-01-30',
  next_payment_due: null,
  paid_through: '2025-12',
  holder_account: '0.0.10366453',
  nft: { token_id: '0.0.10366468', serial: 17 },
  hcs_receipt: { topic_id: '0.0.10366471', sequence_number: 90 },
  chain: {
    cover_pool: '0x6358ddd5AA2e1797ddA949D7d82eA86C9F89ff09',
    bind_transaction: '0x91fc76e2ae0e5f616eaa23f005366039643578d1e7f0048e5ed5ece57289f6ab',
    hashscan:
      'https://hashscan.io/testnet/transaction/0x91fc76e2ae0e5f616eaa23f005366039643578d1e7f0048e5ed5ece57289f6ab',
  },
  claims: {
    open: true,
    code: 'claims_open',
    title: 'Claims open',
    reason_lines: [],
    reading: {
      form: 'level',
      distance: '0.69',
      period: '2026-07',
      attachment_shock: '2.00',
      level_line: '-0.68',
      open: false,
    },
  },
};

/** The same cover after its claim was paid. */
export const PAID_POLICY: PolicyView = {
  ...OPEN_POLICY,
  status: 'paid',
  claims: {
    open: false,
    code: 'already_claimed',
    title: "You've already claimed on this cover.",
    reason_lines: ['One claim per person per series, and this cover has had its claim.'],
    reading: OPEN_POLICY.claims?.reading ?? null,
  },
};

/**
 * The refusal a cover under its line carries, composed by the API from the
 * published reading. The demo series has been open since April 2026, so this
 * one is written as `claimsOpenness` composes it for a closed series: the level
 * form said as a distance from average, never as a signed number.
 */
export const CLOSED_CLAIMS: NonNullable<PolicyView['claims']> = {
  open: false,
  code: 'claims_not_open',
  title: "Claims aren't open.",
  reason_lines: [
    'Your occupation is 1.20 better than average. Claims open within 0.68 of average.' +
      " We'll tell you here if that changes.",
  ],
  reading: {
    form: 'level',
    distance: '0.52',
    period: '2026-07',
    attachment_shock: '2.00',
    level_line: '-0.68',
    open: false,
  },
};

/** Packet A, approved from the review queue and paid on testnet. */
export const PAID_CLAIM: ClaimStatusView = {
  claim_id: 'clm_01M1S819FWBCPFEQ6F1326KQDY',
  policy_id: 'pol_01M1S77VCWJ7VMMFXANN0N7G19',
  series_id: 'ODI-COMP-2026-01',
  status: 'paid',
  decision: 'approve',
  reasons: ['reviewer_decision'],
  resubmit: null,
  amount: { amount: '1000000000', asset: '0.0.10366463', decimals: 6, display: '1000.00' },
  packet_hash: 'sha256:2b44c5f5789c59a4ff988d175c9018e325f5782c1b9a845c7675ba07188531c6',
  decision_hash: 'sha256:1ee6e1c67d634e657f485212a7be2ce1de66662c269e66ebf81161adf9d67c46',
  claim_deadline: '2026-10-05T09:04:51Z',
  submitted_at: '2026-09-05T16:57:08Z',
  decided_at: '2026-09-05T17:00:08Z',
  paid_at: '2026-09-05T17:02:49Z',
  hcs: { topic_id: '0.0.10366473', packet_sequence_number: 15, decision_sequence_number: 19 },
  payout: {
    transaction: '0xfc1a2137f7fe87d9a853347247a20ea5edccdf1d8c46176d25bed1b244480c8c',
    hashscan:
      'https://hashscan.io/testnet/transaction/0xfc1a2137f7fe87d9a853347247a20ea5edccdf1d8c46176d25bed1b244480c8c',
  },
};

/** The same claim while it was waiting for the Adjuster, and while a person had it. */
export const SUBMITTED_CLAIM: ClaimStatusView = {
  ...PAID_CLAIM,
  status: 'submitted',
  decision: null,
  reasons: [],
  amount: null,
  decision_hash: null,
  decided_at: null,
  paid_at: null,
  hcs: { ...PAID_CLAIM.hcs, decision_sequence_number: null },
  payout: null,
};

export const REFERRED_CLAIM: ClaimStatusView = {
  ...SUBMITTED_CLAIM,
  status: 'under_review',
  decision: 'refer',
  reasons: ['evidence_seen_before', 'adjuster_unavailable'],
  decided_at: '2026-09-05T16:57:43Z',
  hcs: { ...PAID_CLAIM.hcs, decision_sequence_number: 16 },
};

/** Packet B, the resignation, declined on the statement alone. */
export const DECLINED_CLAIM: ClaimStatusView = {
  claim_id: 'clm_01M1S85DH1930WXZ8J0KDS6710',
  policy_id: 'pol_01M1S78JTAHNT62MBK6Y74ZEMW',
  series_id: 'ODI-COMP-2026-01',
  status: 'declined',
  decision: 'decline',
  reasons: ['separation_type_not_covered', 'evidence_seen_before'],
  resubmit: { allowed: false },
  amount: { amount: '1000000000', asset: '0.0.10366463', decimals: 6, display: '1000.00' },
  packet_hash: 'sha256:acb4a38d857183758cc8f88838d929b46855fd1801ec2cffe1856ca769750e9f',
  decision_hash: 'sha256:0a147dc3c151a00f53132301f6ae1259f981246fe9f0e03dddbcb2eeea4bcb7a',
  claim_deadline: '2026-10-05T09:04:51Z',
  submitted_at: '2026-09-05T16:59:24Z',
  decided_at: '2026-09-05T16:59:42Z',
  paid_at: null,
  hcs: { topic_id: '0.0.10366473', packet_sequence_number: 17, decision_sequence_number: 18 },
  payout: null,
};

/** The sentences that decline carries, from the admin payload. */
export const DECLINE_LINES = [
  "Resigning isn't covered. This cover pays when your employer ends your job.",
  'Someone will look at your claim.',
];

export const QUEUE_ROW: AdminClaimSummary = {
  claim_id: 'clm_01M1S819FWBCPFEQ6F1326KQDY',
  policy_id: 'pol_01M1S77VCWJ7VMMFXANN0N7G19',
  series_id: 'ODI-COMP-2026-01',
  status: 'under_review',
  submitted_at: '2026-09-05T16:57:08Z',
  decision: 'refer',
  confidence: null,
  reasons: ['evidence_seen_before', 'adjuster_unavailable'],
  overdue: false,
};

export const QUEUE_DETAIL: AdminClaimDetail = {
  claim_id: 'clm_01M1S85DH1930WXZ8J0KDS6710',
  policy_id: 'pol_01M1S78JTAHNT62MBK6Y74ZEMW',
  series_id: 'ODI-COMP-2026-01',
  status: 'declined',
  submitted_at: '2026-09-05T16:59:24Z',
  packet_hash: 'sha256:acb4a38d857183758cc8f88838d929b46855fd1801ec2cffe1856ca769750e9f',
  attestation: {
    full_name: 'Robin Vale',
    employer_name: 'Calder & Finch LLP',
    job_title: 'Data Analyst',
    group: 'computer_math',
    last_day_of_work: '2026-03-06',
    separation_type: 'resignation',
    statement_accepted: true,
    method: 'eip191',
    signature_verified: true,
  },
  evidence: [
    {
      evidence_id: 'evd_01M1S85DH1J2VXNZF2E141RWBS',
      kind: 'other',
      filename: 'letter.pdf',
      content_type: 'application/pdf',
      size: 1247,
      sha256: 'sha256:ad1ef4663c8a1df95b6c230537b77ffb3c6d7534f4570731d76494961ff289fe',
      sha256_seen_in_other_claims: true,
    },
  ],
  policy: {},
  decision: 'decline',
  reasons: ['separation_type_not_covered', 'evidence_seen_before'],
  reason_lines: [
    {
      code: 'separation_type_not_covered',
      line: "Resigning isn't covered. This cover pays when your employer ends your job.",
    },
    { code: 'evidence_seen_before', line: 'Someone will look at your claim.' },
  ],
  resubmit: {
    allowed: false,
    why: "Resigning isn't covered. This cover pays when your employer ends your job.",
  },
  decision_record: null,
};

/** GET /v1/replay while the demo clock is standing on July 2026. */
export const REPLAY: ReplayView = {
  mode: 'replay',
  running: true,
  series: 'ODI-COMP-2026-01',
  from: '2025-01',
  to: '2026-07',
  current_period: '2026-07',
  latest_published: '2026-07',
  scenario_label: null,
  badge: { show: true, label: 'REPLAY' },
};

/** The same endpoint with no clock running, which is a screen with no badge. */
export const LIVE_REPLAY: ReplayView = {
  mode: 'live',
  running: false,
  series: null,
  from: null,
  to: null,
  current_period: null,
  latest_published: null,
  scenario_label: null,
  badge: null,
};
