import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The cover session: the thing that makes coming back possible.
 *
 * The whole defect T41 fixes is that a cover lived in one process's memory, so
 * these tests are about what survives and what must not. The cookie store is the
 * one thing mocked; the signing, the expiry and the parsing are the shipped
 * code.
 */

const store = new Map<string, string>();

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = store.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string) => {
      store.set(name, value);
    },
    delete: (name: string) => {
      store.delete(name);
    },
  }),
}));

vi.mock('../src/lib/server-env.js', () => ({
  serverVar: (name: string) => (name === 'COVER_SESSION_SECRET' ? 'a-secret-for-the-tests' : null),
  serverFlag: () => false,
  loadRootEnv: () => undefined,
}));

const { clearAllClaims } = await import('../src/lib/claim-session.js');
const { clearAllPurchases } = await import('../src/lib/purchase-session.js');
const { closeCoverSession, currentPolicyId, openCoverSession, readCoverSession } = await import(
  '../src/lib/current-cover.js'
);

const POLICY = 'pol_01M1S3EBDQR3W79A9E8MR6MPYB';
const KEY = '00001111222233334444';

beforeEach(() => {
  store.clear();
  clearAllClaims();
  clearAllPurchases();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the cover session', () => {
  it('opens on one cover and reads back the same one', async () => {
    await openCoverSession(POLICY, KEY);
    const session = await readCoverSession();
    expect(session?.policyId).toBe(POLICY);
    expect(session?.coverKey).toBe(KEY);
  });

  it('holds no cover key when it was opened by a World ID check', async () => {
    await openCoverSession(POLICY);
    expect((await readCoverSession())?.coverKey).toBe('');
  });

  /**
   * The point of the ticket. Nothing about the session is in this process's
   * memory, so the cookie alone is enough to answer, which is what a restart
   * and a closed browser leave behind.
   */
  it('is the cookie and nothing else, so no process memory has to survive', async () => {
    await openCoverSession(POLICY, KEY);
    const cookie = store.get('creance_cover');
    store.clear();
    store.set('creance_cover', cookie ?? '');
    expect((await readCoverSession())?.policyId).toBe(POLICY);
  });

  it('refuses a cover somebody typed into their own cookie', async () => {
    await openCoverSession(POLICY, KEY);
    const cookie = store.get('creance_cover') ?? '';
    store.set('creance_cover', cookie.replace(POLICY, 'pol_01SOMEBODYELSESCOVER00000'));
    expect(await readCoverSession()).toBeNull();
  });

  it('refuses a cookie with no signature on it at all', async () => {
    store.set('creance_cover', `v1.${POLICY}.${KEY}.${String(Date.now() + 1000)}`);
    expect(await readCoverSession()).toBeNull();
    store.set('creance_cover', POLICY);
    expect(await readCoverSession()).toBeNull();
  });

  it('expires, and the expiry is inside the signature rather than the browser', async () => {
    await openCoverSession(POLICY, KEY);
    expect(await readCoverSession()).not.toBeNull();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() + 8 * 24 * 60 * 60 * 1000));
    expect(await readCoverSession()).toBeNull();
  });

  it('signs in again rather than extending, so a session cannot live for ever', async () => {
    await openCoverSession(POLICY, KEY);
    const first = (await readCoverSession())?.expiresAt ?? 0;
    // Reading it many times moves nothing.
    await readCoverSession();
    await readCoverSession();
    expect((await readCoverSession())?.expiresAt).toBe(first);
  });

  it('signs out', async () => {
    await openCoverSession(POLICY, KEY);
    await closeCoverSession();
    expect(await readCoverSession()).toBeNull();
  });
});

describe('which cover a screen is about', () => {
  it('is the cover session when there is one', async () => {
    await openCoverSession(POLICY, KEY);
    expect(await currentPolicyId()).toBe(POLICY);
  });

  it('is nothing at all when there is no session of any kind', async () => {
    expect(await currentPolicyId()).toBeNull();
  });
});
