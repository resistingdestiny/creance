// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The demonstration: the one link a person with no World ID, no wallet and no
 * purchase follows to reach a real cover.
 *
 * What these tests are about is the ticket's own hard line. A published key is
 * still a whole cover key and is checked by the same server action a typed one
 * is, so nothing here may invent a shorter way in. A cover that is real is
 * offered as real, a state with a real cover behind it is never offered as a
 * fixture as well, and a browser that already holds a cover is never shown a
 * state that is not its own.
 *
 * The environment is the one thing mocked, because the setting is what a
 * deployment turns this on with, and the cookie store, because the page asks
 * whether this browser holds a cover.
 */

const env = { covers: null as string | null, states: false };
const session = { open: false };

vi.mock('../src/lib/server-env.js', () => ({
  serverVar: (name: string) => (name === 'WEB_DEMO_COVERS' ? env.covers : null),
  serverFlag: (name: string) => name === 'WEB_DEMO_STATES' && env.states,
  loadRootEnv: () => undefined,
}));

vi.mock('../src/lib/current-cover.js', () => ({
  readCoverSession: async () => (session.open ? { policyId: 'pol_X', coverKey: '', expiresAt: 0 } : null),
}));

const notFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});

vi.mock('next/navigation', () => ({ notFound, redirect: vi.fn() }));

vi.mock('../src/app/purchase-actions.js', () => ({ signOutOfCover: vi.fn() }));
vi.mock('../src/app/home/demo/actions.js', () => ({ openPublishedCover: vi.fn() }));

const { DEMO_COVER_SLOTS, DEMO_STATES, demoCovers, demonstrationOn, fixtureStates, parseDemoCovers } =
  await import('../src/lib/demo-states.js');
const { default: DemoPage } = await import('../src/app/home/demo/page.js');

/** Twenty characters of Crockford's base 32, as the API issues them. */
const COVERED = 'K7QPK7QPK7QPK7QPK7QP';
const OPEN = 'R2VBR2VBR2VBR2VBR2VB';
const PAID = 'M3WXM3WXM3WXM3WXM3WX';

async function renderPage(query: { refused?: string } = {}) {
  render(await DemoPage({ searchParams: Promise.resolve(query) }));
}

beforeEach(() => {
  env.covers = null;
  env.states = false;
  session.open = false;
  notFound.mockClear();
});

afterEach(cleanup);

describe('reading the published covers', () => {
  it('reads a slot and its key', () => {
    expect(parseDemoCovers(`covered:${COVERED}`)).toEqual([{ slot: 'covered', key: COVERED }]);
  });

  it('reads every slot and lists them in the order the screen shows them', () => {
    const line = `paid:${PAID},claims-open:${OPEN},covered:${COVERED}`;
    expect(parseDemoCovers(line).map((cover) => cover.slot)).toEqual([
      'covered',
      'claims-open',
      'paid',
    ]);
  });

  it('takes a key with the groups it was printed in', () => {
    const spaced = 'K7QP K7QP K7QP K7QP K7QP';
    expect(parseDemoCovers(`covered:${spaced}`)).toEqual([{ slot: 'covered', key: COVERED }]);
  });

  it('drops a slot it has no words for, rather than printing its name', () => {
    expect(parseDemoCovers(`lapsed:${COVERED}`)).toEqual([]);
    expect(parseDemoCovers(`claim-in-progress:${COVERED}`)).toEqual([]);
  });

  it('drops a key that is not the shape of a cover key', () => {
    expect(parseDemoCovers('covered:short')).toEqual([]);
    expect(parseDemoCovers(`covered:${COVERED}X`)).toEqual([]);
    // I, L, O and U are the four letters Crockford's base 32 never prints.
    expect(parseDemoCovers('covered:IIIIIIIIIIIIIIIIIIII')).toEqual([]);
  });

  it('keeps the first cover named for a slot, so a slot is one cover', () => {
    const two = parseDemoCovers(`covered:${COVERED},covered:${PAID}`);
    expect(two).toEqual([{ slot: 'covered', key: COVERED }]);
  });

  it('publishes nothing when the setting is unset', () => {
    expect(demoCovers()).toEqual([]);
    expect(demonstrationOn()).toBe(false);
  });

  it('is on when either half of the demonstration is', () => {
    env.states = true;
    expect(demonstrationOn()).toBe(true);
    env.states = false;
    env.covers = `covered:${COVERED}`;
    expect(demonstrationOn()).toBe(true);
  });

  it('offers the three states a cover can be put into and opened cold', () => {
    expect([...DEMO_COVER_SLOTS]).toEqual(['covered', 'claims-open', 'paid']);
  });

  it('names every slot after the state it is, so the two halves cannot drift', () => {
    for (const slot of DEMO_COVER_SLOTS) expect(DEMO_STATES).toContain(slot);
  });
});

describe('which states are left to a fixture', () => {
  it('leaves all six where a deployment has published no cover', () => {
    expect(fixtureStates([])).toEqual(DEMO_STATES);
  });

  it('drops a state once a real cover stands in it', () => {
    const left = fixtureStates([
      { slot: 'covered', key: COVERED },
      { slot: 'claims-open', key: OPEN },
      { slot: 'paid', key: PAID },
    ]);
    expect([...left]).toEqual(['claim-in-progress', 'lapsed', 'replay']);
  });
});

describe('the demonstration page', () => {
  it('does not exist on a deployment that publishes nothing', async () => {
    await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalled();
  });

  it('says the covers are real and prints the key that opens each', async () => {
    env.covers = `covered:${COVERED},claims-open:${OPEN},paid:${PAID}`;
    await renderPage();
    expect(screen.getByText(/These covers are real/)).toBeTruthy();
    expect(screen.getByText('A cover that is running')).toBeTruthy();
    expect(screen.getByText('A cover with claims open')).toBeTruthy();
    expect(screen.getByText('A cover that paid out')).toBeTruthy();
    expect(screen.getByText('K7QP K7QP K7QP K7QP K7QP')).toBeTruthy();
  });

  it('posts the whole key, so the way in is the one an ordinary person has', async () => {
    env.covers = `covered:${COVERED}`;
    await renderPage();
    const field = document.querySelector('input[name="cover_key"]');
    expect(field?.getAttribute('value')).toBe(COVERED);
    expect(field?.getAttribute('value')).toHaveLength(20);
  });

  it('keeps the key out of the address, so it cannot leak through a referrer', async () => {
    env.covers = `covered:${COVERED}`;
    await renderPage();
    for (const anchor of document.querySelectorAll('a')) {
      expect(anchor.getAttribute('href')).not.toContain(COVERED);
    }
  });

  it('offers no cover at all when only the fixture states are on', async () => {
    env.states = true;
    await renderPage();
    expect(screen.queryByTestId('demo-cover-covered')).toBeNull();
    expect(screen.getByTestId('demo-states')).toBeTruthy();
  });

  it('offers the rest as other examples, with nothing under the heading', async () => {
    env.states = true;
    await renderPage();
    expect(screen.getByText('See other examples')).toBeTruthy();
    expect(screen.queryByText(/drawn from fixtures/)).toBeNull();
  });

  it('does not offer a state as a fixture when a real cover stands in it', async () => {
    env.states = true;
    env.covers = `covered:${COVERED},claims-open:${OPEN},paid:${PAID}`;
    await renderPage();
    expect(screen.queryByText('Paid out')).toBeNull();
    expect(screen.queryByText('Claims open')).toBeNull();
    expect(screen.getByText('Claim in progress')).toBeTruthy();
    expect(screen.getByText('Payment due')).toBeTruthy();
  });

  it('does not offer the fixture states where they are turned off', async () => {
    env.covers = `covered:${COVERED}`;
    await renderPage();
    expect(screen.queryByTestId('demo-states')).toBeNull();
  });

  it('says why the states show nothing when this browser holds a cover', async () => {
    env.states = true;
    session.open = true;
    await renderPage();
    expect(screen.getByText(/You have a cover open/)).toBeTruthy();
  });

  it('says so when a published key did not open a cover', async () => {
    env.covers = `covered:${COVERED}`;
    await renderPage({ refused: '1' });
    expect(screen.getByTestId('demo-refused')).toBeTruthy();
  });

  it('stays out of the search indexes, because the keys are in its markup', async () => {
    const { metadata } = await import('../src/app/home/demo/page.js');
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});
