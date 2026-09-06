import type { IndexView } from './worker-api';

/**
 * The last index reading this server process published, per group.
 *
 * The landing page has to keep showing a number when the feed stops answering,
 * and it must be a number that was really published rather than a zero or a
 * guess. Nothing in this app stored one before: every screen reads the feed
 * live and renders its unavailable state when the read fails, which is right
 * for a screen behind a purchase and wrong for the front door, where the
 * alternative to a stale figure is an empty page.
 *
 * It is module memory and not a cache. Nothing is served from here while the
 * feed answers, there is no expiry to tune, and a restart empties it, at which
 * point the page says it has no reading rather than inventing one. A shared
 * store would survive the restart and is a database row this event does not
 * need; the honest note the page prints is the same either way.
 *
 * Server only. Nothing in the browser bundle reaches this module, because the
 * only caller is a server component.
 */

const published = new Map<string, IndexView>();

/** Called after every successful read, so the newest reading is the one kept. */
export function rememberReading(index: IndexView): void {
  published.set(index.group, index);
}

/** The last reading for a group, or null when this process has never had one. */
export function recallReading(group: string): IndexView | null {
  return published.get(group) ?? null;
}

/** Tests only. A module-level map outlives a test file otherwise. */
export function forgetReadings(): void {
  published.clear();
}
