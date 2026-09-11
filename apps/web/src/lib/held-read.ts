import { reportUnreachable } from './api';

/**
 * A read that is bought once and held, rather than bought again for every
 * visitor.
 *
 * src/lib/explorer-data.ts made this argument first, for the round of fifteen
 * metered readings behind the public explorer: without a hold every page view
 * would pay fifteen times and two viewers arriving together would pay thirty.
 * The landing page needs the same thing for the reading, the quote and the
 * coupon behind its front door, so the pattern lives here and both modules use
 * it rather than each keeping a cache of its own.
 *
 * Two windows, and they do different jobs.
 *
 * `ttlMs` is how long a value is simply served. It comes from what the figure
 * is: the index publishes once a month, so a reading a few minutes old is the
 * same reading, and a quote is a binding price with a life of its own, so its
 * hold must expire well inside that life.
 *
 * `staleMs` is how long past the TTL the last good value may still be served
 * while a new one is bought behind the visitor. It is what keeps the person who
 * arrives first after an expiry from being the one who waits: they get the
 * value the visitor before them got, and the refresh runs without them. Past
 * both windows the value is too old to stand behind, so the next read waits for
 * a real answer and a call that fails is the caller's failure to handle.
 *
 * A value is aged from the moment its call went out rather than from the moment
 * it came back. A quote's fifteen minutes start when the API prices it, so
 * counting from the return would give a hold a few seconds of life the price
 * does not have.
 *
 * One call is in flight at a time. A hundred visitors arriving together on a
 * cold hold wait on one promise and cause one settlement, which is the whole
 * point of the module.
 *
 * Server only, and module memory: a restart empties every hold, at which point
 * the next visitor buys again. Nothing here is a fixture and nothing survives
 * the process, so no figure the product prints can be older than the process
 * that printed it.
 */

interface Held<T> {
  readonly value: T;
  /** When the call that produced it went out. */
  readonly at: number;
}

export interface HeldRead<T> {
  /** The held value, or the call, depending on how old the hold is. */
  read(now?: number): Promise<T>;
  /** Tests only. A module level hold outlives a test file otherwise. */
  forget(): void;
}

export interface HeldReadOptions<T> {
  /** What is being read, for the log line when a refresh fails. */
  readonly what: string;
  /** How long the value is served without question. */
  readonly ttlMs: number;
  /** How long past that it is served while a new one is bought behind it. */
  readonly staleMs: number;
  readonly read: () => Promise<T>;
}

export function heldRead<T>({ what, ttlMs, staleMs, read }: HeldReadOptions<T>): HeldRead<T> {
  let held: Held<T> | null = null;
  let inFlight: Promise<T> | null = null;

  function buy(now: number): Promise<T> {
    inFlight ??= read()
      .then((value) => {
        held = { value, at: now };
        return value;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  }

  return {
    read(now: number = Date.now()): Promise<T> {
      if (held === null) return buy(now);
      const age = now - held.at;
      if (age < ttlMs) return Promise.resolve(held.value);
      if (age < ttlMs + staleMs) {
        const value = held.value;
        // Nobody waits on this one. A refresh that fails leaves the value that
        // is already held in place until the stale window runs out, and the
        // read after that waits for an answer rather than serving a figure
        // this app can no longer stand behind.
        void buy(now).catch((cause) => {
          reportUnreachable(`${what}, refreshed behind a visitor`, cause);
        });
        return Promise.resolve(value);
      }
      return buy(now);
    },

    forget(): void {
      held = null;
      inFlight = null;
    },
  };
}

export interface HeldReadPerKey<T> {
  read(key: string, now?: number): Promise<T>;
  /** How many keys are held. Tests only: what a run of reads left behind. */
  size(): number;
  /** Tests only, as above. Forgets every key. */
  forget(): void;
}

/**
 * One hold per key, made on first use.
 *
 * The landing page reads one occupation group, but the reading and the quote
 * are both per group and the module takes the group as an argument, so a hold
 * keyed on it is the only shape that cannot serve one occupation's price under
 * another occupation's name.
 *
 * A key whose read fails holds nothing, so it is dropped. `read` rejects only
 * when the hold has no value it can stand behind, cold or past both windows,
 * so nothing servable is lost by forgetting it, and what is gained is that the
 * map only ever grows by keys that were read successfully. The investor page
 * keys on a series id that arrives in a query string, and a map that kept an
 * entry per id a crawler ever sent would grow without bound on a public route
 * (T51). The next read of a dropped key makes a new hold and buys again,
 * exactly as a cold one does.
 */
export function heldReadPerKey<T>(make: (key: string) => HeldRead<T>): HeldReadPerKey<T> {
  const holds = new Map<string, HeldRead<T>>();

  return {
    read(key: string, now: number = Date.now()): Promise<T> {
      let hold = holds.get(key);
      if (hold === undefined) {
        hold = make(key);
        holds.set(key, hold);
      }
      const made = hold;
      return made.read(now).catch((cause: unknown) => {
        // Only the hold that failed. A key forgotten and remade while this
        // rejection was in flight has a newer hold in the map, which stays.
        if (holds.get(key) === made) holds.delete(key);
        throw cause;
      });
    },

    size(): number {
      return holds.size;
    },

    forget(): void {
      holds.clear();
    },
  };
}
