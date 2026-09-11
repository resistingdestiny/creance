import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

/**
 * The one shimmer budget, docs/DESIGN-TOKENS-ADDENDUM.md, "The metal".
 *
 * The shimmer is the accent and the accent is singular: at most one element
 * on any screen carries the moving band. The mechanism is that exactly one
 * component per screen passes `metal="shimmer"`, and this file is what holds
 * it, by rendering each screen that carries the material and counting. The
 * landing's own test counts its hero the same way, and the investor test
 * counts the note certificate.
 *
 * The screens are rendered to static markup with no DOM, which is enough:
 * the budget is a question about what the server sends, not about what runs
 * afterwards.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  redirect: vi.fn(),
}));

vi.mock('../src/app/claim-actions.js', () => ({
  beginClaim: vi.fn(),
  readClaimStatus: vi.fn(async () => null),
  submitAgain: vi.fn(),
}));

vi.mock('../src/app/purchase-actions.js', () => ({
  signOutOfCover: vi.fn(),
}));

const { ClaimStatusScreen } = await import('../src/app/claim/status/status-screen.js');
const { HomeScreen } = await import('../src/app/home/home-screen.js');
const { homeStatus, lapsedCopy } = await import('../src/lib/claim-model.js');
const fixtures = await import('./claim-fixtures.js');

const HOME_STATES = ['covered', 'claims_open', 'claim_in_progress', 'paid', 'lapsed'] as const;

function homeMarkup(state: (typeof HOME_STATES)[number]): string {
  return renderToStaticMarkup(
    <HomeScreen
      bound={false}
      view={{
        policyId: fixtures.OPEN_POLICY.policy_id,
        occupation: 'Computer and mathematical',
        cover: 1000,
        status: homeStatus(state),
        nextPayment: '28.00 on 4 October',
        index: { value: '0.69, falling', caption: 'Points from opening claims.' },
        claimsOpen: state === 'claims_open' ? 'Claims are open.' : null,
        paid: state === 'paid' ? { amount: '1,000', day: '10 September 2026' } : null,
        lapsed: state === 'lapsed' ? lapsedCopy(fixtures.OPEN_POLICY) : null,
        replayBadge: null,
      }}
    />,
  );
}

function shimmers(markup: string): number {
  return markup.match(/cover-card__shimmer/g)?.length ?? 0;
}

describe('Home', () => {
  it.each(HOME_STATES)('spends one shimmer on the card and no more, in the %s state', (state) => {
    const markup = homeMarkup(state);
    expect(shimmers(markup)).toBe(1);
    expect(markup.match(/cover-card--metal/g)).toHaveLength(1);
  });

  it('keeps the light under the occupation and the amount', () => {
    const markup = homeMarkup('covered');
    expect(markup.indexOf('cover-card__shimmer')).toBeLessThan(
      markup.indexOf('cover-card__content'),
    );
  });

  it('puts nothing on the metal but the card', () => {
    // The next payment row, the index row and the history are ordinary
    // content and stay on surface. The frame's own ground is surface too
    // since T50 and stands before the card, so the slice starts at the first
    // surface after the card's content.
    const markup = homeMarkup('covered');
    const afterCard = markup.slice(
      markup.indexOf('bg-surface', markup.indexOf('cover-card__content')),
    );
    expect(afterCard).toContain('Next payment');
    expect(afterCard).not.toContain('cover-card');
  });
});

describe('the claim after it is decided', () => {
  it('draws the approved payout on a certificate, once', () => {
    const markup = renderToStaticMarkup(
      <ClaimStatusScreen claim={fixtures.PAID_CLAIM} reasonLines={[]} why={null} />,
    );
    expect(shimmers(markup)).toBe(1);
    expect(markup).toContain('cover-card--certificate');
    expect(markup.indexOf('cover-card__shimmer')).toBeLessThan(
      markup.indexOf('data-testid="display-number"'),
    );
  });

  it('leaves the waiting, under review and declined states on canvas', () => {
    // A failure state is not the place for a moving light, and neither is a
    // screen that is still waiting for an answer.
    for (const claim of [fixtures.SUBMITTED_CLAIM, fixtures.REFERRED_CLAIM, fixtures.DECLINED_CLAIM]) {
      const markup = renderToStaticMarkup(
        <ClaimStatusScreen claim={claim} reasonLines={fixtures.DECLINE_LINES} why={null} />,
      );
      expect(markup, claim.status).not.toContain('cover-card');
    }
  });
});
