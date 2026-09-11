import { afterEach, describe, expect, it, vi } from 'vitest';

import { heldRead, heldReadPerKey } from '../src/lib/held-read.js';

/**
 * The hold behind every paid read on a public page.
 *
 * The clock is passed in rather than mocked, because the module takes `now` for
 * exactly this reason and a test that moves a fake clock would be testing the
 * fake.
 */

const TTL = 10_000;
const STALE = 5_000;

/** A read that counts its calls and answers whatever it is told to. */
function counted(answers: () => Promise<string>) {
  let calls = 0;
  return {
    calls: () => calls,
    read: () => {
      calls += 1;
      return answers();
    },
  };
}

/** Lets a refresh nobody is waiting on finish before the next assertion. */
function settled(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function hold(source: { read: () => Promise<string> }) {
  return heldRead({ what: 'the test figure', ttlMs: TTL, staleMs: STALE, read: source.read });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a cold hold', () => {
  it('buys once however many readers arrive together', async () => {
    let release: (value: string) => void = () => {};
    const source = counted(
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    );
    const held = hold(source);

    const readers = Array.from({ length: 100 }, () => held.read(0));
    release('4.25');

    expect(await Promise.all(readers)).toEqual(Array.from({ length: 100 }, () => '4.25'));
    expect(source.calls()).toBe(1);
  });

  it('hands the failure to the caller rather than holding it', async () => {
    const source = counted(() => Promise.reject(new Error('no answer')));
    const held = hold(source);

    await expect(held.read(0)).rejects.toThrow('no answer');
    await expect(held.read(1)).rejects.toThrow('no answer');
    expect(source.calls()).toBe(2);
  });
});

describe('inside the TTL', () => {
  it('serves the held value and buys nothing', async () => {
    const source = counted(() => Promise.resolve('4.25'));
    const held = hold(source);

    await held.read(0);
    for (let at = 0; at < TTL; at += 1_000) await held.read(at);

    expect(source.calls()).toBe(1);
  });

  it('ages the value from the moment the call went out', async () => {
    // The call is made at 0 and answers at 3,000. A value aged from its return
    // would still be fresh at 12,000, which is 2,000 past the life the figure
    // was bought with.
    let release: (value: string) => void = () => {};
    const source = counted(
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    );
    const held = hold(source);

    const first = held.read(0);
    release('4.25');
    await first;

    await held.read(TTL + 2_000);
    expect(source.calls()).toBe(2);
  });
});

describe('inside the stale window', () => {
  it('serves the last good value and buys the next one behind the reader', async () => {
    let answer = 'first';
    const source = counted(() => Promise.resolve(answer));
    const held = hold(source);

    await held.read(0);
    answer = 'second';

    // The reader who arrives first after the expiry does not wait for the buy.
    expect(await held.read(TTL)).toBe('first');
    expect(source.calls()).toBe(2);

    // The one behind them has the new value, and nothing else was bought.
    expect(await held.read(TTL + 1)).toBe('second');
    expect(source.calls()).toBe(2);
  });

  it('keeps the held value when the refresh fails', async () => {
    const failures = vi.spyOn(console, 'error').mockImplementation(() => {});
    let answers = () => Promise.resolve('first');
    const source = counted(() => answers());
    const held = hold(source);

    await held.read(0);
    answers = () => Promise.reject(new Error('no answer'));

    expect(await held.read(TTL)).toBe('first');
    await settled();
    expect(await held.read(TTL + 1_000)).toBe('first');
    expect(failures).toHaveBeenCalled();
  });
});

describe('past both windows', () => {
  it('waits for a real answer rather than serving a figure it cannot stand behind', async () => {
    let answer = 'first';
    const source = counted(() => Promise.resolve(answer));
    const held = hold(source);

    await held.read(0);
    answer = 'second';

    expect(await held.read(TTL + STALE)).toBe('second');
    expect(source.calls()).toBe(2);
  });

  it('hands a failed read to the caller once the held value is too old', async () => {
    let answers = () => Promise.resolve('first');
    const source = counted(() => answers());
    const held = hold(source);

    await held.read(0);
    answers = () => Promise.reject(new Error('no answer'));

    await expect(held.read(TTL + STALE)).rejects.toThrow('no answer');
  });
});

describe('forget', () => {
  it('empties the hold, as a restart does', async () => {
    const source = counted(() => Promise.resolve('4.25'));
    const held = hold(source);

    await held.read(0);
    held.forget();
    await held.read(1);

    expect(source.calls()).toBe(2);
  });
});

describe('one hold per key', () => {
  it('never serves one key from another key value', async () => {
    const calls: string[] = [];
    const holds = heldReadPerKey((key) =>
      heldRead({
        what: `the test figure for ${key}`,
        ttlMs: TTL,
        staleMs: STALE,
        read: () => {
          calls.push(key);
          return Promise.resolve(`${key} figure`);
        },
      }),
    );

    expect(await holds.read('computer_math', 0)).toBe('computer_math figure');
    expect(await holds.read('legal', 0)).toBe('legal figure');
    expect(await holds.read('computer_math', 1)).toBe('computer_math figure');

    expect(calls).toEqual(['computer_math', 'legal']);
  });
});

describe('a key whose read failed', () => {
  function failingUntilServed() {
    const served = new Set<string>();
    const calls: string[] = [];
    const holds = heldReadPerKey((key) =>
      heldRead({
        what: `the test figure for ${key}`,
        ttlMs: TTL,
        staleMs: STALE,
        read: () => {
          calls.push(key);
          return served.has(key)
            ? Promise.resolve(`${key} figure`)
            : Promise.reject(new Error(`${key} is not served`));
        },
      }),
    );
    return { holds, calls, serve: (key: string) => served.add(key) };
  }

  it('is dropped, so a hundred unknown keys leave nothing behind', async () => {
    const { holds } = failingUntilServed();

    for (let n = 0; n < 100; n += 1) {
      await expect(holds.read(`unknown-${n}`, 0)).rejects.toThrow('is not served');
    }

    expect(holds.size()).toBe(0);
  });

  it('is bought once more when it is read again, exactly as a cold key is', async () => {
    const { holds, calls, serve } = failingUntilServed();

    await expect(holds.read('legal', 0)).rejects.toThrow();
    serve('legal');
    expect(await holds.read('legal', 1)).toBe('legal figure');
    expect(await holds.read('legal', 2)).toBe('legal figure');

    expect(calls).toEqual(['legal', 'legal']);
    expect(holds.size()).toBe(1);
  });

  it('is dropped by every reader that shared the failure, and only once', async () => {
    const { holds, calls } = failingUntilServed();

    const readers = Array.from({ length: 10 }, () => holds.read('legal', 0));
    await Promise.all(readers.map((reader) => expect(reader).rejects.toThrow()));

    expect(calls).toEqual(['legal']);
    expect(holds.size()).toBe(0);
  });

  it('keeps a key that was forgotten and remade while its failure was in flight', async () => {
    let fail: (cause: Error) => void = () => {};
    const holds = heldReadPerKey((key) =>
      heldRead({
        what: `the test figure for ${key}`,
        ttlMs: TTL,
        staleMs: STALE,
        read: () =>
          new Promise<string>((_resolve, reject) => {
            fail = reject;
          }),
      }),
    );

    const first = holds.read('legal', 0);
    const firstFail = fail;
    holds.forget();
    void holds.read('legal', 1);
    firstFail(new Error('no answer'));
    await expect(first).rejects.toThrow('no answer');

    expect(holds.size()).toBe(1);
  });
});
