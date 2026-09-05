import type { Period } from '@creance/index-model';

import type { ObservationMessage } from './message.js';
import type { OracleMode } from './state.js';
import { recordKey } from './store.js';
import { decodeMirrorMessage, readTopicMessages } from './verify.js';

/** One observation the topic already carries, and where it sits on the topic. */
export interface TopicObservation {
  sequenceNumber: number;
  message: ObservationMessage;
}

/**
 * What the index topic already carries, keyed by `recordKey`.
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
 * The sequence number comes back with each message because the on chain call
 * carries it. A month that reached the topic and not the contract still needs
 * its contract call, and this is what lets a machine that did not publish it
 * make one.
 *
 * Public data, read through the mirror node, no key and no cost.
 */
export async function publishedOnTopic(options: {
  mirrorUrl: string;
  topicId: string;
  /** The mode the run publishes in, which picks the key namespace. */
  mode: OracleMode;
}): Promise<Map<string, TopicObservation>> {
  const found = new Map<string, TopicObservation>();
  for (const entry of await readTopicMessages(options.mirrorUrl, options.topicId)) {
    let message: ObservationMessage;
    try {
      message = JSON.parse(decodeMirrorMessage(entry)) as ObservationMessage;
    } catch {
      // A message this oracle did not write, or one that will not parse. It is
      // not a claim that a period is settled, so it is not counted as one.
      continue;
    }
    if (typeof message.group !== 'string' || typeof message.period !== 'string') continue;
    const key = recordKey({
      group_key: message.group,
      period: message.period as Period,
      mode: options.mode,
    });
    // First writer wins, which is the same rule the topic itself settles by.
    if (!found.has(key)) {
      found.set(key, { sequenceNumber: entry.sequence_number, message });
    }
  }
  return found;
}
