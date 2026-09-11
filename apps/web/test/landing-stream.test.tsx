// @vitest-environment node

import { renderToStaticMarkup } from 'react-dom/server';
import { renderToReadableStream } from 'react-dom/server.edge';
import { describe, expect, it } from 'vitest';

import { LandingScreen } from '../src/components/landing/landing-screen.js';
import type {
  LandingExplorerView,
  LandingIndexView,
  LandingNoteView,
  LandingPriceView,
} from '../src/lib/landing-data.js';

import { LIVE } from './landing-fixtures.js';

/**
 * The page arrives before its figures do.
 *
 * This is the half of T40 a visitor feels. The reading and the quote settle on
 * Hedera, so they take seconds whatever else is done to them, and the fix is
 * not to make a person wait for them: the shell is rendered and flushed with
 * nothing paid for, and each figure is written into the place kept for it as it
 * arrives. What is asserted here is exactly that order, against a page whose
 * four figures are all still out.
 */

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

/**
 * The markup up to and including a marker, which is how much of the page has
 * been flushed by the time that marker is on the wire.
 */
async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  marker: string,
): Promise<string> {
  const decoder = new TextDecoder();
  let markup = '';
  while (!markup.includes(marker)) {
    const chunk = await reader.read();
    if (chunk.done) break;
    markup += decoder.decode(chunk.value, { stream: true });
  }
  return markup;
}

/** Whatever the stream has flushed so far, as markup. */
async function drain(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let markup = '';
  let chunk = await reader.read();
  while (!chunk.done) {
    markup += decoder.decode(chunk.value, { stream: true });
    chunk = await reader.read();
  }
  return markup;
}

function restingStates(markup: string): number {
  return markup.match(/data-testid="landing-resting"/g)?.length ?? 0;
}

describe('the shell', () => {
  it('is flushed with every figure still out', async () => {
    const index = deferred<LandingIndexView>();
    const price = deferred<LandingPriceView>();
    const explorer = deferred<LandingExplorerView>();
    const note = deferred<LandingNoteView>();

    const stream = await renderToReadableStream(
      <LandingScreen
        data={{
          group: LIVE.group,
          occupation: LIVE.occupation,
          index: index.promise,
          price: price.promise,
          explorer: explorer.promise,
          note: note.promise,
        }}
      />,
    );

    // renderToReadableStream resolves when the shell is ready, which is before
    // any of the four has answered. Nothing below is awaited to get here: the
    // shell is read out to its last line, the closing band's "I want to
    // invest", with all four still out. The footer bar that used to end the
    // page is the root layout's since T50 and is not this component's.
    const reader = stream.getReader();
    const shell = await readUntil(reader, 'I want to invest');

    // The hero, the card, the question and the closing band, all of them.
    expect(shell).toContain('Cover for the day your job is automated.');
    expect(shell).toContain('A monthly payment now. A payout if your occupation is displaced.');
    expect(shell).toContain('Get a quote');
    expect(shell).toContain('When does it pay.');
    expect(shell).toContain('The quiet kind of ready.');
    expect(shell).toContain('One number decides. You can watch it.');

    // And not one figure, because not one of them has been read: no price,
    // no badge, no ticker, and (T54) no chip around the card and no figure in
    // the band under it.
    expect(shell).not.toContain('From 4.25 a month');
    expect(shell).not.toContain(LIVE.index.badge);
    expect(shell).not.toContain('landing-ticker__item');
    expect(shell).not.toContain('data-testid="landing-event"');
    expect(shell).not.toContain('years of index history');
    expect(shell).not.toContain('Coupon 3 paid');
    expect(restingStates(shell)).toBeGreaterThan(0);
    // The two near chips and the four figures rest at their size, in place.
    expect(shell).toContain('data-testid="landing-events"');
    expect(shell).toContain('data-testid="landing-figures"');

    index.resolve(LIVE.index);
    price.resolve(LIVE.price);
    explorer.resolve(LIVE.explorer);
    note.resolve(LIVE.note);

    const rest = await drain(reader);
    const whole = shell + rest;

    expect(whole).toContain('From 4.25 a month');
    expect(whole).toContain(LIVE.index.badge);
    expect(whole).toContain('landing-ticker__item');
    expect(whole).toContain(LIVE.index.payLine);
    expect(whole).toContain(LIVE.note.investorLine);
    expect(whole).toContain('Coupon 3 paid');
    expect(whole).toContain('years of index history');
    expect(whole.match(/data-testid="landing-event"/g)).toHaveLength(4);
  });

  it('rests nowhere at all when the figures are already in hand', async () => {
    // Which is how every other test in the suite renders this page, and why
    // they assert what it prints rather than what it is waiting for.
    const markup = renderToStaticMarkup(<LandingScreen data={LIVE} />);

    expect(markup).toContain('From 4.25 a month');
    expect(markup).toContain('landing-ticker__item');
    expect(restingStates(markup)).toBe(0);
  });
});
