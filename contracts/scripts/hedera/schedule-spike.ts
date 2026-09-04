import {
  AccountId,
  Client,
  Hbar,
  PrivateKey,
  ScheduleCreateTransaction,
  ScheduleDeleteTransaction,
  Timestamp,
  TransactionId,
  TransferTransaction,
} from '@hiero-ledger/sdk';

import {
  hashscanUrl,
  mirrorScheduleUrl,
  premiumSlot,
  readSchedule,
  scheduleNext,
  scheduleTransfer,
  signSchedule,
  toMirrorTransactionId,
  waitForExecution,
} from '@creance/client';

import { MIRROR_URL, readResources } from '../deploy/config.js';
import { normaliseRawKeyHex, roleKey } from './derive.js';

/// The T05 spike. Everything the design brief left open about long-term
/// Scheduled Transactions is measured here against Hedera testnet, because the
/// answer decides whether the premium chain is one schedule per month or a
/// compressed demo-clock cadence.
///
/// Stages, each runnable on its own: `pnpm hedera:schedule bisect past
/// immediate future chain sign`. With no argument every stage runs in that
/// order.
///
/// Nothing here is a test. It writes to testnet, it costs fees, and its output
/// is transcribed into docs/HEDERA.md, docs/harness-notes.md and
/// docs/DECISIONS.md by hand.

const STAGES = ['bisect', 'past', 'immediate', 'future', 'chain', 'sign'] as const;
type Stage = (typeof STAGES)[number];

const DAY = 24 * 60 * 60;
const UNIT = 1_000_000n; // TUSD has six decimals.
/** One minor unit, the smallest transfer an expiry probe can carry. */
const DUST = 1n;

/** A probe that is known to be inside the window, used as the low bound. */
const LOW_BOUND_SECONDS = 3600;
/** A probe well past any plausible cap, used as the high bound. */
const HIGH_BOUND_SECONDS = 200 * DAY;

interface Probe {
  offsetSeconds: number;
  accepted: boolean;
  status: string;
  scheduleId: string | null;
  /** Expiry minus the consensus timestamp the network actually stamped. */
  consensusDeltaSeconds: number | null;
}

function statusOf(error: unknown): string {
  const status = (error as { status?: { toString(): string } }).status;
  if (status) {
    return status.toString();
  }
  return error instanceof Error ? error.message : String(error);
}

function periodOfDate(date: Date): number {
  return date.getUTCFullYear() * 100 + date.getUTCMonth() + 1;
}

function operatorKeyHex(): string {
  return normaliseRawKeyHex(process.env.HEDERA_OPERATOR_KEY ?? '');
}

interface Context {
  client: Client;
  tokenId: string;
  payerId: string;
  payerKey: PrivateKey;
  operatorId: AccountId;
  operatorKey: PrivateKey;
  destination: string;
}

/**
 * One expiry probe. The inner transfer is deliberately left unsigned, so the
 * schedule can never execute and the probe costs one create and nothing else.
 * The expiry is measured from the transaction's own valid start, so the bracket
 * the bisection reports does not drift with network latency.
 */
async function probeExpiry(context: Context, offsetSeconds: number, tag: string): Promise<Probe> {
  const transactionId = TransactionId.generate(context.operatorId);
  const validStart = transactionId.validStart as Timestamp;
  const expiry = new Timestamp(validStart.seconds.toNumber() + offsetSeconds, 0);

  const transfer = new TransferTransaction()
    .addTokenTransfer(context.tokenId, context.payerId, -DUST)
    .addTokenTransfer(context.tokenId, context.destination, DUST);

  const create = new ScheduleCreateTransaction()
    .setScheduledTransaction(transfer)
    .setScheduleMemo(`creance spike expiry ${tag}`)
    .setExpirationTime(expiry)
    .setWaitForExpiry(true)
    .setAdminKey(context.operatorKey.publicKey)
    .setTransactionId(transactionId)
    .freezeWith(context.client);

  try {
    const response = await create.execute(context.client);
    const record = await response.getRecord(context.client);
    const consensus = record.consensusTimestamp.seconds.toNumber();
    return {
      offsetSeconds,
      accepted: true,
      status: record.receipt.status.toString(),
      scheduleId: record.receipt.scheduleId?.toString() ?? null,
      consensusDeltaSeconds: expiry.seconds.toNumber() - consensus,
    };
  } catch (error) {
    return {
      offsetSeconds,
      accepted: false,
      status: statusOf(error),
      scheduleId: null,
      consensusDeltaSeconds: null,
    };
  }
}

async function runBisect(context: Context): Promise<void> {
  console.log('\n== stage bisect: the maximum expiry window ==');

  const low = await probeExpiry(context, LOW_BOUND_SECONDS, 'low');
  console.log(`  ${LOW_BOUND_SECONDS}s -> ${low.status}`);
  if (!low.accepted) {
    throw new Error(`the low bound of ${LOW_BOUND_SECONDS}s was rejected with ${low.status}`);
  }
  const high = await probeExpiry(context, HIGH_BOUND_SECONDS, 'high');
  console.log(`  ${HIGH_BOUND_SECONDS}s -> ${high.status}`);
  if (high.accepted) {
    throw new Error(`the high bound of ${HIGH_BOUND_SECONDS}s was accepted; raise it and re-run`);
  }

  const probes: Probe[] = [low, high];
  let accepted = low;
  let rejected = high;
  let step = 0;
  while (rejected.offsetSeconds - accepted.offsetSeconds > 1) {
    step += 1;
    const middle = Math.floor((accepted.offsetSeconds + rejected.offsetSeconds) / 2);
    const probe = await probeExpiry(context, middle, `bisect-${step}`);
    probes.push(probe);
    console.log(
      `  ${middle}s -> ${probe.status}` +
        (probe.consensusDeltaSeconds === null
          ? ''
          : ` (expiry minus consensus ${probe.consensusDeltaSeconds}s)`),
    );
    if (probe.accepted) {
      accepted = probe;
    } else {
      rejected = probe;
    }
  }

  console.log('\n  measured:');
  console.log(`    largest offset accepted   ${accepted.offsetSeconds}s`);
  console.log(`    smallest offset rejected  ${rejected.offsetSeconds}s`);
  console.log(`    rejection status          ${rejected.status}`);
  console.log(
    `    expiry minus consensus at the largest accepted offset  ${String(
      accepted.consensusDeltaSeconds,
    )}s`,
  );
  console.log(
    `    that is ${(Number(accepted.consensusDeltaSeconds) / DAY).toFixed(4)} days from consensus`,
  );

  // Clean up. Every probe schedule is unsigned and would expire unexecuted, but
  // deleting them also proves the cancellation path a lapsed policy needs.
  const created = probes.filter((probe) => probe.scheduleId).map((probe) => probe.scheduleId!);
  console.log(`\n  deleting ${created.length} probe schedules with the admin key`);
  let deleted = 0;
  for (const scheduleId of created) {
    try {
      const receipt = await (
        await new ScheduleDeleteTransaction()
          .setScheduleId(scheduleId)
          .freezeWith(context.client)
          .sign(context.operatorKey)
      )
        .execute(context.client)
        .then((response) => response.getReceipt(context.client));
      deleted += 1;
      if (deleted === 1) {
        console.log(`    ${scheduleId} -> ${receipt.status.toString()}`);
      }
    } catch (error) {
      console.log(`    ${scheduleId} -> ${statusOf(error)}`);
    }
  }
  console.log(`    deleted ${deleted} of ${created.length}`);
}

async function runPast(context: Context): Promise<void> {
  console.log('\n== stage past: an expiry that has already gone ==');
  const probe = await probeExpiry(context, -60, 'past');
  console.log(`  -60s -> ${probe.status}`);
  if (probe.scheduleId) {
    console.log(`  it was accepted as ${probe.scheduleId}, which the docs do not describe`);
  }
}

async function runImmediate(context: Context): Promise<void> {
  console.log('\n== stage immediate: wait for expiry false, all signatures present ==');
  const now = new Date();
  const slot = premiumSlot('POL-SPIKE-NOW', periodOfDate(now), new Date(now.getTime() + 10 * 60_000));

  const scheduled = await scheduleTransfer({
    client: context.client,
    tokenId: context.tokenId,
    payer: { accountId: context.payerId, key: context.payerKey },
    to: context.destination,
    amount: UNIT,
    executeAt: slot.executeAt,
    memo: slot.memo,
    adminKey: context.operatorKey.publicKey,
    waitForExpiry: false,
    readFee: true,
  });

  console.log(`  schedule            ${scheduled.scheduleId}`);
  console.log(`  create fee          ${String(scheduled.createFeeHbar)}`);
  console.log(`  scheduled tx id     ${scheduled.scheduledTransactionId}`);
  console.log(`  expiry set to       ${scheduled.expirationTime.toISOString()}`);
  console.log(`  schedule link       ${scheduled.links.schedule}`);
  console.log(`  create link         ${scheduled.links.create}`);

  const execution = await waitForExecution(MIRROR_URL, scheduled.scheduleId, {
    attempts: 20,
    delayMs: 3000,
  });
  if (!execution) {
    console.log('  it did not execute inside the poll budget');
    return;
  }
  console.log(`  executed at         ${execution.executedAt}`);
  console.log(`  executed tx id      ${execution.executedTransactionId}`);
  console.log(`  result              ${execution.result}`);
  console.log(`  executed link       ${execution.link}`);
  console.log(`  mirror schedule     ${mirrorScheduleUrl(MIRROR_URL, scheduled.scheduleId)}`);

  const record = await readSchedule(MIRROR_URL, scheduled.scheduleId);
  console.log(`  mirror expiration_time  ${String(record?.expiration_time)}`);
  console.log(`  mirror wait_for_expiry  ${String(record?.wait_for_expiry)}`);
}

/** The long-term path, and the transfer the acceptance line links to. */
async function runFuture(context: Context): Promise<{ scheduleId: string; slot: ReturnType<typeof premiumSlot> }> {
  console.log('\n== stage future: wait for expiry true, a few minutes out ==');
  const dueAt = new Date(Date.now() + 3 * 60_000);
  const slot = premiumSlot('POL-SPIKE-1', periodOfDate(dueAt), dueAt);

  const scheduled = await scheduleTransfer({
    client: context.client,
    tokenId: context.tokenId,
    payer: { accountId: context.payerId, key: context.payerKey },
    to: context.destination,
    amount: UNIT,
    executeAt: slot.executeAt,
    memo: slot.memo,
    adminKey: context.operatorKey.publicKey,
    waitForExpiry: true,
    readFee: true,
  });

  console.log(`  schedule            ${scheduled.scheduleId}`);
  console.log(`  memo                ${scheduled.memo}`);
  console.log(`  create fee          ${String(scheduled.createFeeHbar)}`);
  console.log(`  due at              ${slot.executeAt.toISOString()}`);
  console.log(`  schedule link       ${scheduled.links.schedule}`);
  console.log(`  create link         ${scheduled.links.create}`);
  console.log(`  predicted scheduled tx  ${toMirrorTransactionId(scheduled.scheduledTransactionId)}`);

  const pending = await readSchedule(MIRROR_URL, scheduled.scheduleId);
  console.log(`  mirror expiration_time before execution  ${String(pending?.expiration_time)}`);

  const execution = await waitForExecution(MIRROR_URL, scheduled.scheduleId, {
    attempts: 80,
    delayMs: 5000,
  });
  if (!execution) {
    throw new Error(`schedule ${scheduled.scheduleId} never executed inside the poll budget`);
  }
  const lagSeconds = Number(execution.executedAt.split('.')[0]) - Math.floor(slot.executeAt.getTime() / 1000);
  console.log(`  executed at         ${execution.executedAt}`);
  console.log(`  lag past the expiry ${lagSeconds}s`);
  console.log(`  executed tx id      ${execution.executedTransactionId}`);
  console.log(`  result              ${execution.result}`);
  console.log(`  executed link       ${execution.link}`);
  console.log(`  matches the predicted scheduled tx id: ${
    execution.executedTransactionId === toMirrorTransactionId(scheduled.scheduledTransactionId)
  }`);

  return { scheduleId: scheduled.scheduleId, slot };
}

async function runChain(
  context: Context,
  watched: { scheduleId: string; slot: ReturnType<typeof premiumSlot> },
): Promise<void> {
  console.log('\n== stage chain: scheduleNext creates the following month ==');
  const result = await scheduleNext({
    client: context.client,
    mirrorUrl: MIRROR_URL,
    scheduleId: watched.scheduleId,
    slot: watched.slot,
    tokenId: context.tokenId,
    payer: { accountId: context.payerId, key: context.payerKey },
    to: context.destination,
    amount: UNIT,
    adminKey: context.operatorKey.publicKey,
    waitForExpiry: true,
    poll: { attempts: 20, delayMs: 3000 },
    onExecuted: (execution) => {
      console.log(
        `  onExecuted: policy ${execution.policyId} period ${execution.period} ` +
          `paid in ${execution.executedTransactionId} (${execution.result})`,
      );
      console.log('  T09 turns that into CoverPool.recordPremium from the api account');
    },
    onFailed: (execution) => {
      console.log(
        `  onFailed: policy ${execution.policyId} period ${execution.period} ` +
          `executed as ${execution.result} and moved nothing`,
      );
      console.log('  nothing may be recorded as paid; the policy is heading for lapse');
    },
  });

  if (!result) {
    throw new Error(`schedule ${watched.scheduleId} has not executed, so nothing was chained`);
  }
  console.log(`  settled             ${result.settled}`);
  console.log(`  next period         ${result.slot.period}`);
  console.log(`  next due at         ${result.slot.executeAt.toISOString()}`);
  console.log(`  next schedule       ${result.next.scheduleId}`);
  console.log(`  next memo           ${result.next.memo}`);
  console.log(`  next schedule link  ${result.next.links.schedule}`);
  console.log(`  next create link    ${result.next.links.create}`);
}

/**
 * The other shape DESIGN.md 3.7 allows: the schedule is created by one account
 * and signed by another. The create is charged to the operator, the schedule
 * sits incomplete until the payer signs, and only then does it execute.
 */
async function runSign(context: Context): Promise<void> {
  console.log('\n== stage sign: created by one account, signed by the payer ==');
  const dueAt = new Date(Date.now() + 2 * 60_000);
  const slot = premiumSlot('POL-SPIKE-2', periodOfDate(dueAt), dueAt);

  const scheduled = await scheduleTransfer({
    client: context.client,
    tokenId: context.tokenId,
    payer: { accountId: context.payerId },
    to: context.destination,
    amount: UNIT,
    executeAt: slot.executeAt,
    memo: slot.memo,
    adminKey: context.operatorKey.publicKey,
    waitForExpiry: false,
    preSign: false,
    readFee: true,
  });

  console.log(`  schedule            ${scheduled.scheduleId}`);
  console.log(`  create fee          ${String(scheduled.createFeeHbar)}`);
  console.log(`  pre-signed          ${scheduled.preSigned}`);
  console.log(`  create link         ${scheduled.links.create}`);

  const before = await readSchedule(MIRROR_URL, scheduled.scheduleId);
  console.log(`  executed before the signature  ${String(before?.executed_timestamp)}`);
  console.log(`  signatures before              ${String(before?.signatures.length)}`);

  const signature = await signSchedule({
    client: context.client,
    scheduleId: scheduled.scheduleId,
    key: context.payerKey,
  });
  console.log(`  ScheduleSign        ${signature.status}`);
  console.log(`  sign link           ${signature.link}`);

  const execution = await waitForExecution(MIRROR_URL, scheduled.scheduleId, {
    attempts: 20,
    delayMs: 3000,
  });
  if (!execution) {
    console.log('  it did not execute inside the poll budget');
    return;
  }
  console.log(`  executed at         ${execution.executedAt}`);
  console.log(`  executed tx id      ${execution.executedTransactionId}`);
  console.log(`  result              ${execution.result}`);
  console.log(`  executed link       ${execution.link}`);
}

async function main(): Promise<void> {
  const requested = process.argv.slice(2).filter((argument) => !argument.startsWith('-'));
  const stages: Stage[] =
    requested.length > 0
      ? requested.map((argument) => {
          if (!(STAGES as readonly string[]).includes(argument)) {
            throw new Error(`unknown stage ${argument}; one of ${STAGES.join(', ')}`);
          }
          return argument as Stage;
        })
      : [...STAGES];

  const resources = readResources();
  if (resources.network !== 'testnet') {
    throw new Error('this spike is testnet only');
  }

  const operatorId = AccountId.fromString(process.env.HEDERA_OPERATOR_ID ?? '');
  const operatorHex = operatorKeyHex();
  const operatorKey = PrivateKey.fromStringECDSA(operatorHex);

  const client = Client.forTestnet();
  client.setOperator(operatorId, operatorKey);
  client.setDefaultMaxTransactionFee(new Hbar(10));
  client.setDefaultMaxQueryPayment(new Hbar(5));

  const payer = resources.accounts['policyholder-1'];
  const destination = resources.accounts.steward;
  if (!payer || !destination) {
    throw new Error('docs/hedera.testnet.json is missing policyholder-1 or steward');
  }

  const context: Context = {
    client,
    tokenId: resources.settlementToken.tokenId,
    payerId: payer.accountId,
    payerKey: roleKey(operatorHex, 'policyholder-1'),
    operatorId,
    operatorKey,
    destination: destination.accountId,
  };

  console.log(`Settlement token ${context.tokenId}, ${resources.settlementToken.decimals} decimals`);
  console.log(`Payer ${context.payerId}, destination ${context.destination}`);
  console.log(`Mirror node ${MIRROR_URL}`);
  console.log(`Payer account ${hashscanUrl('account', context.payerId)}`);

  try {
    let watched: { scheduleId: string; slot: ReturnType<typeof premiumSlot> } | null = null;
    for (const stage of stages) {
      if (stage === 'bisect') await runBisect(context);
      if (stage === 'past') await runPast(context);
      if (stage === 'immediate') await runImmediate(context);
      if (stage === 'future') watched = await runFuture(context);
      if (stage === 'chain') {
        if (!watched) {
          throw new Error('the chain stage needs the future stage in the same run');
        }
        await runChain(context, watched);
      }
      if (stage === 'sign') await runSign(context);
    }
  } finally {
    client.close();
  }
}

await main();
