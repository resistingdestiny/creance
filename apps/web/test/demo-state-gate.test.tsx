// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Who the demonstration states are for, and who they are never for.
 *
 * The acceptance is one sentence: somebody who bought real cover never sees a
 * demonstration state. `?demo=` had been read before the cover was, so a link
 * or a bookmark carrying it replaced a real person's real answer with a fixture
 * on the one screen whose whole job is to say whether they are covered. The
 * cover is read first now, and these are the two halves of that.
 */

const cover = { policyId: null as string | null };

vi.mock('../src/lib/server-env.js', () => ({
  serverVar: () => null,
  serverFlag: (name: string) => name === 'WEB_DEMO_STATES',
  loadRootEnv: () => undefined,
}));

vi.mock('../src/lib/current-cover.js', () => ({
  currentPolicyId: async () => cover.policyId,
  readCoverSession: async () =>
    cover.policyId === null ? null : { policyId: cover.policyId, coverKey: '', expiresAt: 0 },
}));

// The cover behind a real session is fetched, and what it says is not what this
// is about: refusing it takes the page down the branch a real cover holder gets
// and proves the fixture was not rendered instead.
vi.mock('../src/lib/worker-api.js', () => ({
  fetchIndex: vi.fn(async () => {
    throw new Error('unreachable');
  }),
  fetchPolicy: vi.fn(async () => {
    throw new Error('unreachable');
  }),
}));

vi.mock('../src/lib/audit-api.js', () => ({ fetchHistory: vi.fn(), fetchPayout: vi.fn() }));
vi.mock('../src/lib/claim-api.js', () => ({ fetchReplay: vi.fn() }));
vi.mock('../src/app/claim-actions.js', () => ({ readClaimStatus: vi.fn(async () => null) }));
vi.mock('../src/lib/api.js', () => ({ reportUnreachable: vi.fn() }));
vi.mock('../src/app/purchase-actions.js', () => ({
  completeWorldCheck: vi.fn(),
  openWithCoverKey: vi.fn(),
  signInWithWorld: vi.fn(),
  signOutOfCover: vi.fn(),
  startSignInCheck: vi.fn(),
  startWorldCheck: vi.fn(),
  verifyPerson: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

const { default: HomePage } = await import('../src/app/home/page.js');

/** The label every fixture screen carries, and the only thing worth asserting. */
const LABEL = /Demo state\. Nothing on this screen came from the API\./;

async function renderHome(demo?: string) {
  render(await HomePage({ searchParams: Promise.resolve(demo === undefined ? {} : { demo }) }));
}

beforeEach(() => {
  cover.policyId = null;
});

afterEach(cleanup);

describe('the demonstration states', () => {
  it('renders for a browser that holds no cover, and says where it came from', async () => {
    await renderHome('paid');
    expect(screen.getByText(LABEL)).toBeTruthy();
  });

  it('is refused to a browser that holds a cover of its own', async () => {
    cover.policyId = 'pol_01M1S3EBDQR3W79A9E8MR6MPYB';
    await renderHome('paid');
    expect(screen.queryByText(LABEL)).toBeNull();
  });

  it('leaves the way back in alone when no state was asked for', async () => {
    await renderHome();
    expect(screen.queryByText(LABEL)).toBeNull();
    expect(screen.getByText('Get back into your cover')).toBeTruthy();
  });

  it('offers the demonstration from the way back in where there is one', async () => {
    await renderHome();
    expect(screen.getByText('See a live cover').getAttribute('href')).toBe('/home/demo');
  });
});
