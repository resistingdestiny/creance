import type { Period } from '@creance/index-model';

import type { OracleMode } from './state.js';
import { recordKey } from './store.js';
import { decodeMirrorMessage, readTopicMessages } from './verify.js';

/**
 * What the index topic already carries.
 *
 * The observation store is the run's memory of what it published, and it is a
 * file under `var/` that no clone carries. The topic is what actually settled.
 * docs/INDEX-SPEC.md says the first value published for a period settles it
 * forever, so the guard against publishing a period twice cannot rest on a
 * local file alone: a judge cloning this repository and running the demo replay
 * against the shared testnet topic has an empty store and every month in the
 * window looks unpublished.
 *
 * Reading the topic back before publishing also closes the window the pipeline
 * could not close on its own: a run killed between the topic receipt and the
 * store write leaves a message with no row, and the next run would republish
 * the period.
 *
 * Public data, read through the mirror node, no key and no cost.
 */
export async function publishedOnTopic(options: {
  mirrorUrl: string;
  topicId: string;
  /** The mode the run publishes in, which picks the key namespace. */
  mode: OracleMode;
}): Promise<Set<string>> {
  const keys = new Set<string>();
  for (const message of await readTopicMessages(options.mirrorUrl, options.topicId)) {
    let parsed: { group?: unknown; period?: unknown };
    try {
      parsed = JSON.parse(decodeMirrorMessage(message)) as { group?: unknown; period?: unknown };
    } catch {
      // A message this oracle did not write, or one that will not parse. It is
      // not a claim that a period is settled, so it is not counted as one.
      continue;
    }
    if (typeof parsed.group !== 'string' || typeof parsed.period !== 'string') continue;
    keys.add(
      recordKey({ group_key: parsed.group, period: parsed.period as Period, mode: options.mode }),
    );
  }
  return keys;
}
