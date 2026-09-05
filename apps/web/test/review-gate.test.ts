import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The decide action refuses a request that carries no reviewer session, and it
 * refuses before it calls the API.
 *
 * A server action is its own endpoint, reachable without ever loading the page
 * that renders the button, so the page's own gate does not cover it. An
 * approval runs `payClaim` and moves settlement funds, which is why this is
 * asserted as "the API was never called" rather than as "the screen said no".
 */

let reviewer = false;

vi.mock('../src/lib/reviewer-session.js', () => ({
  isReviewer: async () => reviewer,
  startReview: async () => true,
  endReview: async () => undefined,
}));

vi.mock('../src/lib/admin-api.js', () => ({
  decideClaim: vi.fn(async () => ({
    claim_id: 'clm_01M1S819FWBCPFEQ6F1326KQDY',
    status: 'paid',
    decision: 'approve',
    decision_hash: 'sha256:1ee6e1c6',
    idempotent: false,
    payout: { paid: true, transactionHash: '0xfc1a2137' },
  })),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const { decide } = await import('../src/app/admin/claims/actions.js');
const { decideClaim } = await import('../src/lib/admin-api.js');

beforeEach(() => {
  reviewer = false;
  vi.mocked(decideClaim).mockClear();
});

describe('deciding without a reviewer session', () => {
  it('refuses an approval and never reaches the API', async () => {
    const result = await decide('clm_01M1S819FWBCPFEQ6F1326KQDY', 'approve', '');
    expect(result.ok).toBe(false);
    expect(result.message).toBe('Sign in as a reviewer first.');
    expect(decideClaim).not.toHaveBeenCalled();
  });

  it('refuses a decline the same way, whatever sentence it carries', async () => {
    const result = await decide('clm_01M1S819FWBCPFEQ6F1326KQDY', 'decline', 'Anything.');
    expect(result.ok).toBe(false);
    expect(decideClaim).not.toHaveBeenCalled();
  });

  it('says nothing about the claim it was asked about', async () => {
    const result = await decide('clm_someone_elses_claim', 'approve', '');
    expect(result.message).not.toContain('clm_');
  });
});

describe('deciding as a reviewer', () => {
  beforeEach(() => {
    reviewer = true;
  });

  it('approves through the decide endpoint and says the payout ran', async () => {
    const result = await decide('clm_01M1S819FWBCPFEQ6F1326KQDY', 'approve', '');
    expect(decideClaim).toHaveBeenCalledWith(
      'clm_01M1S819FWBCPFEQ6F1326KQDY',
      'approve',
      'Approved on review.',
    );
    expect(result.ok).toBe(true);
    expect(result.message).toContain('Approved and paid');
  });

  it('still refuses a decline with no sentence, and never reaches the API', async () => {
    const result = await decide('clm_01M1S819FWBCPFEQ6F1326KQDY', 'decline', '   ');
    expect(result.ok).toBe(false);
    expect(result.message).toBe('A decline needs one plain sentence to show the person.');
    expect(decideClaim).not.toHaveBeenCalled();
  });

  it('reports a payout that refused as what it was, not as a payment', async () => {
    vi.mocked(decideClaim).mockResolvedValueOnce({
      claim_id: 'clm_01M1S819FWBCPFEQ6F1326KQDY',
      status: 'approved',
      decision: 'approve',
      decision_hash: 'sha256:1ee6e1c6',
      idempotent: false,
      payout: { paid: false, reason: 'payout_failed' },
    });
    const result = await decide('clm_01M1S819FWBCPFEQ6F1326KQDY', 'approve', '');
    expect(result.ok).toBe(true);
    expect(result.message).toContain('The payout did not run');
    expect(result.message).toContain('Press Approve again');
  });
});
