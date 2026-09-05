import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Who is allowed to spend the server's admin token.
 *
 * The queue names claimants and its two buttons move settlement funds, so the
 * question these tests answer is not "does the server hold a token" but "does
 * this request carry the right to use it". The cookie store is the one thing
 * mocked: everything else, including the comparison, is the shipped code.
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

const TOKEN = 'a-reviewer-token-for-the-tests';

vi.mock('../src/lib/admin-api.js', () => ({ adminToken: () => TOKEN }));

const { clearAllReviewers, endReview, isReviewer, startReview, tokenAccepted } = await import(
  '../src/lib/reviewer-session.js'
);

beforeEach(() => {
  store.clear();
  clearAllReviewers();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the reviewer token', () => {
  it('accepts the token this deployment was configured with', () => {
    expect(tokenAccepted(TOKEN)).toBe(true);
  });

  it('refuses a wrong token, an empty one and a prefix of the right one', () => {
    expect(tokenAccepted('not-the-token')).toBe(false);
    expect(tokenAccepted('')).toBe(false);
    expect(tokenAccepted(TOKEN.slice(0, -1))).toBe(false);
  });

  it('refuses everything when the deployment holds no token at all', () => {
    expect(tokenAccepted(TOKEN, null)).toBe(false);
    expect(tokenAccepted('', null)).toBe(false);
  });
});

describe('the reviewer session', () => {
  it('is nobody until somebody signs in', async () => {
    expect(await isReviewer()).toBe(false);
  });

  it('signs in on the right token and holds an opaque id, never the token', async () => {
    expect(await startReview(TOKEN)).toBe(true);
    expect(await isReviewer()).toBe(true);
    const held = [...store.values()];
    expect(held).toHaveLength(1);
    expect(held[0]).not.toBe(TOKEN);
    expect(held[0]).not.toContain(TOKEN);
  });

  it('does not sign in on a wrong token, and sets no cookie', async () => {
    expect(await startReview('not-the-token')).toBe(false);
    expect(await isReviewer()).toBe(false);
    expect(store.size).toBe(0);
  });

  it('trims what was typed, because a pasted token carries a newline', async () => {
    expect(await startReview(` ${TOKEN}\n`)).toBe(true);
    expect(await isReviewer()).toBe(true);
  });

  it('signs out, and a cookie for a session the server forgot is nobody', async () => {
    await startReview(TOKEN);
    await endReview();
    expect(await isReviewer()).toBe(false);

    // A browser that kept the cookie past a restart, which is the same thing.
    store.set('creance_reviewer', 'an-id-this-process-never-minted');
    expect(await isReviewer()).toBe(false);
  });
});
