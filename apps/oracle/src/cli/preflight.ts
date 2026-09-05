import { loadOracleConfig } from '../config.js';
import { oracleKeyHex } from '../keys.js';
import { addressOfKey } from '../message.js';
import { seriesStatusName } from '../abi.js';
import { CoverPoolSubmitter } from '../submitter.js';

/**
 * `pnpm oracle:preflight`. Read every precondition a real run depends on and
 * print it, without sending anything.
 *
 * Worth its own command because each of these turns a run into a revert or a
 * silent no-op, and all of them are cheap reads:
 *
 * - the oracle account's HBAR balance, which pays for the topic messages and
 *   the contract calls;
 * - the index topic, confirmed through `GET /topics/{id}` rather than through
 *   its message list, because docs/harness-notes.md records that the message
 *   list answers 200 with an empty array for a topic that does not exist;
 * - how many messages the topic already carries, which is what a first run
 *   expects to be zero;
 * - the series status, which must be Active, ClaimsOpen or Settling;
 * - `activeExposure`, which is what the vault reserves on an opening month. A
 *   run that opens a month against zero exposure emits ClaimsOpened with
 *   nothing reserved, which is correct and is not the demonstration;
 * - `lastObservedMonth`, because periods must be strictly increasing and a
 *   replay cannot walk back over one.
 */

interface TopicSummary {
  exists: boolean;
  messages: number | null;
  memo: string | null;
  submitKey: string | null;
}

async function readTopic(mirrorUrl: string, topicId: string): Promise<TopicSummary> {
  const base = mirrorUrl.replace(/\/$/, '');
  const response = await fetch(`${base}/topics/${topicId}`);
  if (!response.ok) return { exists: false, messages: null, memo: null, submitKey: null };
  const topic = (await response.json()) as { memo?: string; submit_key?: { key?: string } };

  // The newest message's sequence number is the count. Asking for one message
  // in descending order is one request rather than a walk.
  const list = await fetch(`${base}/topics/${topicId}/messages?limit=1&order=desc`);
  const body = (await list.json()) as { messages?: { sequence_number?: number }[] };
  const newest = body.messages?.[0]?.sequence_number ?? 0;
  return {
    exists: true,
    messages: Number(newest),
    memo: topic.memo ?? null,
    submitKey: topic.submit_key?.key ?? null,
  };
}

async function readBalance(mirrorUrl: string, accountId: string): Promise<number | null> {
  const response = await fetch(`${mirrorUrl.replace(/\/$/, '')}/accounts/${accountId}`);
  if (!response.ok) return null;
  const account = (await response.json()) as { balance?: { balance?: number } };
  const tinybars = account.balance?.balance;
  return tinybars === undefined ? null : tinybars / 100_000_000;
}

/** Below this the run is topped up from the operator before it starts. */
export const MINIMUM_HBAR = 5;

export async function main(): Promise<void> {
  const config = loadOracleConfig();
  const keyHex = oracleKeyHex();
  const log = (line: string): void => console.log(line);

  log(`network    ${config.network}`);
  log(`oracle     ${config.accountId}  ${addressOfKey(keyHex)}`);
  log(`mirror     ${config.mirrorUrl}`);
  log(`rpc        ${config.rpcUrl}`);
  log('');

  const balance = await readBalance(config.mirrorUrl, config.accountId);
  log(`balance    ${balance === null ? 'unreadable' : `${balance.toFixed(4)} HBAR`}`);
  if (balance !== null && balance < MINIMUM_HBAR) {
    log(`           low: top the oracle up from the operator before a full replay`);
  }

  const topic = await readTopic(config.mirrorUrl, config.topicId);
  log(`topic      ${config.topicId}  ${topic.exists ? 'exists' : 'DOES NOT EXIST'}`);
  if (topic.exists) {
    log(`           memo "${topic.memo ?? ''}"`);
    log(`           submit key ${topic.submitKey === null ? 'none, anyone can write' : 'set'}`);
    log(`           ${topic.messages} messages so far`);
  }
  log('');

  const submitter = new CoverPoolSubmitter(
    config.rpcUrl,
    keyHex,
    config.coverPoolAddress,
    config.vaultAddress,
    config.submitGasLimit,
  );
  log(`pool       ${config.coverPoolAddress}`);
  log(`vault      ${config.vaultAddress}`);
  for (const series of config.series) {
    const state = await submitter.seriesState(series.seriesId);
    const reserved = await submitter.reservedOf(series.seriesId);
    log('');
    log(`series     ${series.label}  ${series.groupKey}`);
    log(`  status            ${seriesStatusName(state.status)} (${state.status})`);
    log(`  accepts           ${state.acceptsObservations ? 'yes' : 'no'}`);
    log(`  attachment shock  ${state.attachmentShock}`);
    log(`  level line        ${state.levelLine}`);
    log(`  activeExposure    ${state.activeExposure}`);
    log(`  exposureCovered   ${state.exposureCovered}`);
    log(`  reserved          ${reserved}`);
    log(`  lastObservedMonth ${state.lastObservedMonth}`);
    log(`  windowEndsAt      ${state.windowEndsAt}`);
    if (state.activeExposure === 0n) {
      log(`  nothing is bound: an opening month would reserve zero`);
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
