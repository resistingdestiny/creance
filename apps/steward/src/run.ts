import { randomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  createX402Payer,
  hashscanTransactionUrl,
  hashscanUrl,
  MirrorClient,
  readPaymentRequired,
  toDisplay,
  waitForExecution,
  type CreatedSchedule,
} from '@creance/client';

import { StewardApi, type PolicyResponse } from './api.js';
import { createPremiumSchedules, publishJournal, stewardClient } from './chain.js';
import { loadStewardConfig, type StewardConfig } from './config.js';
import { encodeJournalMessage, journalMessage, type JournalSettlements } from './journal.js';
import { creatable, deferred, premiumPlan, type Cadence } from './premiums.js';
import { parseProfile, type Profile } from './profile.js';
import { decide, explain, periodNumber, type HeldPolicy } from './rule.js';
import { readState, writeState } from './state.js';

/// One Steward cycle, in the order DESIGN.md 3.7 gives it.
///
///     read the principal's profile
///     pay for the index
///     decide by the written rule
///     quote
///     bind, the first premium settled over x402
///     schedule the premiums
///     write a journal entry to the agent-journal topic
///
/// Everything it prints is the transcript: the 402 before the payment, every
/// settlement transaction id with its HashScan link, the rule's inputs and its
/// result, the schedules with their due months and the journal's sequence
/// number. A run that decides not to buy still journals and still exits 0.

/**
 * A ceiling, not a price. The server names the price and the payer refuses
 * anything above this. The largest thing a cycle pays is one month's premium.
 */
const MAX_PER_PAYMENT = '100000000';

export interface RunOptions {
  profilePath?: string | undefined;
  /** A replay vantage for the decision rule, `YYYY-MM`. Labelled everywhere. */
  asOf?: string | undefined;
  cadence: Cadence;
  /** How many premiums to plan after the one the bind pays. */
  premiums: number;
  /** Wait for the first scheduled premium to execute and report the outcome. */
  wait: boolean;
  now?: Date | undefined;
}

export async function runCycle(options: RunOptions): Promise<number> {
  const config = loadStewardConfig({
    ...(options.profilePath === undefined ? {} : { profilePath: options.profilePath }),
  });
  const profile = loadProfile(config.profilePath);
  const now = options.now ?? new Date();
  const token = config.settlementToken;

  const payer = createX402Payer({
    accountId: config.steward.accountId,
    privateKey: config.steward.privateKey,
    asset: token.tokenId,
    maxAmountPerPayment: MAX_PER_PAYMENT,
  });
  const api = new StewardApi(config.apiUrl, payer);
  const mirror = new MirrorClient({ baseUrl: config.mirrorUrl });

  header(config, profile, options);

  // 1. The profile, and what the agent remembers about this principal.
  const state = readState(config.stateDir, profile.principal);
  const held = await heldPolicy(api, state.policy_id);
  console.log(`\n1. the principal's profile: ${config.profilePath}`);
  console.log(`   occupation ${profile.occupation}, wallet ${profile.wallet.accountId}`);
  console.log(
    `   cover wanted ${toDisplay(profile.coverLimit, token.decimals)} ${token.symbol}, ` +
      `credential from ${profile.eligibility.kind === 'inline' ? 'the profile' : 'the API interim issuer'}`,
  );
  console.log(
    held === null
      ? '   no policy from an earlier run'
      : `   last policy ${held.policyId}, status ${held.status}, cover ends ${held.coverEnds}`,
  );

  const startingBalance = await balance(mirror, config);
  console.log(
    `   the agent holds ${toDisplay(startingBalance.toString(), token.decimals)} ${token.symbol}`,
  );

  // 2. The metered feed. The unpaid call first, because the 402 is the part a
  // reader of the transcript needs to see.
  console.log(`\n2. GET /v1/index/${profile.occupation}, the metered feed`);
  await showTheGate(config, profile.occupation, token.decimals, token.symbol);
  const index = await api.index(profile.occupation);
  const settlements: JournalSettlements = { index: index.settlement.transactionId };
  console.log(`   paid, settled ${index.settlement.transactionId}`);
  console.log(`   ${hashscanTransactionUrl(index.settlement.transactionId)}`);
  console.log(
    `   latest reading ${index.body.as_of}: odi ${String(index.body.reading.odi)}, ` +
      `ebar ${String(index.body.reading.ebar)}, claims ${index.body.trigger.open ? 'open' : 'closed'}`,
  );

  // 3. The written rule, on the history that read just bought.
  const replay = options.asOf !== undefined && options.asOf !== index.body.as_of;
  const decision = decide({
    history: index.body.history,
    ...(options.asOf === undefined ? {} : { asOf: options.asOf }),
    policy: held,
    now,
  });
  console.log('\n3. the decision rule (DESIGN.md 3.7)');
  console.log(`   vantage month ${decision.trend.asOf}${replay ? ' (replay, labelled)' : ''}`);
  console.log(
    `   three month ODI ${decision.trend.periods.join(' ')} = ${decision.trend.odi.join(' ')}`,
  );
  console.log(`   rising ${String(decision.trend.rising)}, cover in force ${String(decision.coverInForce)}, at renewal ${String(decision.atRenewal)}`);
  console.log(`   ${explain(decision)}`);

  const client = stewardClient(config.steward.accountId, config.steward.privateKey, config.network);
  try {
    if (!decision.buy) {
      console.log('\n   the rule says hold, so nothing is bought. The cycle still journals.');
      await journal(client, config, profile, decision, replay, settlements, undefined, 4);
      return 0;
    }

    // 4. The quote.
    console.log('\n4. POST /v1/quote');
    const quote = await api.quote({
      group: profile.occupation,
      limit: profile.coverLimit,
      wallet: profile.wallet.accountId,
    });
    settlements.quote = quote.settlement.transactionId;
    console.log(`   paid, settled ${quote.settlement.transactionId}`);
    console.log(`   ${hashscanTransactionUrl(quote.settlement.transactionId)}`);
    console.log(
      `   quote ${quote.body.quote_id} on ${quote.body.series_id}: premium ${quote.body.premium.display} ` +
        `${token.symbol} a month for ${quote.body.limit.display} ${token.symbol} of cover, ` +
        `${quote.body.term_months} months, expires ${quote.body.expires_at}`,
    );

    // 5. The eligibility credential. The agent never performs the selfie
    // (DESIGN.md 3.6): it presents a credential issued to its principal.
    const credential = await eligibility(api, profile);
    console.log('\n5. the eligibility credential');
    console.log(
      profile.eligibility.kind === 'inline'
        ? '   carried in the profile, issued to the principal'
        : '   from POST /v1/demo/eligibility, the API interim issuer. NOT a World Selfie Check:' +
            ' it stands in for one until T11 wires IDKit.',
    );
    console.log(`   issued to ${profile.wallet.accountId} for ${profile.occupation}`);

    // 6. The bind, paid with the first month's premium.
    console.log('\n6. POST /v1/bind, the first month premium over x402');
    const bound = await api.bind({ quoteId: quote.body.quote_id, credential });
    settlements.premium = bound.settlement.transactionId;
    const policy = bound.body;
    console.log(`   paid, settled ${bound.settlement.transactionId}`);
    console.log(`   ${hashscanTransactionUrl(bound.settlement.transactionId)}`);
    console.log(
      `   policy ${policy.policy_id}, status ${policy.status}, premium ${policy.premium.display} ${token.symbol}`,
    );
    console.log(
      `   receipt NFT ${String(policy.nft.token_id)} serial ${String(policy.nft.serial)}, minted to ` +
        `${policy.holder_account}, not to the agent`,
    );
    console.log(
      `   HCS receipt topic ${String(policy.hcs_receipt.topic_id)} sequence ${String(policy.hcs_receipt.sequence_number)}`,
    );
    console.log(`   cover ${policy.cover_starts} to ${policy.cover_ends}, paid through ${policy.paid_through}`);
    writeState(config.stateDir, {
      principal: profile.principal,
      policy_id: policy.policy_id,
      bound_at: now.toISOString(),
    });

    // 7. The premium schedule. Not x402: the exact scheme forbids a transfer
    // wrapped in a ScheduleCreate, so months two onwards are Scheduled
    // Transactions the agent creates and pre-signs itself.
    const schedules = await scheduleThePremiums({
      client,
      config,
      policy,
      options,
      createdAt: new Date(),
    });

    // 8. The journal.
    const cycle = {
      quoteId: quote.body.quote_id,
      policyId: policy.policy_id,
      nft: { tokenId: policy.nft.token_id, serial: policy.nft.serial },
      premium: {
        amount: policy.premium.amount,
        asset: policy.premium.asset,
        decimals: policy.premium.decimals,
      },
      cadence: options.cadence.kind,
      schedules: schedules.created.map((created, position) => ({
        id: created.scheduleId,
        period: schedules.periods[position] as number,
      })),
      deferred: schedules.deferredPeriods,
    };
    const receipt = await journal(client, config, profile, decision, replay, settlements, cycle, 8);

    if (options.wait && schedules.created.length > 0) {
      await watchFirstPremium(config, schedules.created[0] as CreatedSchedule);
    }

    const endingBalance = await balance(mirror, config);
    console.log(
      `\nthe cycle cost the agent ${toDisplay((startingBalance - endingBalance).toString(), token.decimals)} ` +
        `${token.symbol} in payments and premiums, plus HBAR fees for the schedules and the journal`,
    );
    console.log('\nlinks');
    console.log(`   index read     ${hashscanTransactionUrl(settlements.index)}`);
    console.log(`   quote          ${hashscanTransactionUrl(settlements.quote)}`);
    console.log(`   first premium  ${hashscanTransactionUrl(settlements.premium)}`);
    for (const [position, created] of schedules.created.entries()) {
      console.log(
        `   premium ${String(schedules.periods[position])}   ${created.links.schedule}`,
      );
    }
    console.log(`   journal        ${receipt.link} sequence ${receipt.sequenceNumber}`);
    return 0;
  } finally {
    // The SDK holds gRPC connections open, so the process never exits without
    // this.
    client.close();
  }
}

function header(config: StewardConfig, profile: Profile, options: RunOptions): void {
  console.log(`creance steward, one cycle for ${profile.principal}`);
  console.log(`   agent      ${config.steward.accountId}`);
  console.log(`   api        ${config.apiUrl}`);
  console.log(
    `   settles in ${config.settlementToken.symbol} ${config.settlementToken.tokenId}, premiums to ${config.premiumAccountId}`,
  );
  console.log(
    `   cadence    ${options.cadence.kind === 'monthly' ? 'monthly, the real product' : `demo, one premium every ${options.cadence.intervalSeconds} seconds`}`,
  );
}

function loadProfile(path: string): Profile {
  try {
    return parseProfile(JSON.parse(readFileSync(path, 'utf8')) as unknown);
  } catch (error) {
    throw new Error(`the profile at ${path} could not be read: ${(error as Error).message}`, {
      cause: error,
    });
  }
}

/** The policy from a previous run, as the API reports it today. */
async function heldPolicy(api: StewardApi, policyId: string | null): Promise<HeldPolicy | null> {
  if (policyId === null) return null;
  const policy = await api.policy(policyId);
  if (policy === null) return null;
  return { policyId: policy.policy_id, status: policy.status, coverEnds: policy.cover_ends };
}

/** The unpaid request, so the transcript carries the 402 the agent answers. */
async function showTheGate(
  config: StewardConfig,
  group: string,
  decimals: number,
  symbol: string,
): Promise<void> {
  const unpaid = await fetch(`${config.apiUrl}/v1/index/${group}`);
  await unpaid.text();
  if (unpaid.status !== 402) {
    throw new Error(
      `the index feed answered ${unpaid.status} unpaid: the x402 gate is off, and this run proves nothing`,
    );
  }
  const required = readPaymentRequired(unpaid);
  const accepts = required?.accepts?.[0];
  if (accepts === undefined) {
    throw new Error('the 402 carried no PAYMENT-REQUIRED header a payer could build against');
  }
  console.log(
    `   402: ${toDisplay(accepts.amount, decimals)} ${symbol} to ${accepts.payTo}, ` +
      `scheme ${accepts.scheme} on ${accepts.network}, facilitator fee payer ${String(accepts.extra?.['feePayer'])}`,
  );
}

async function eligibility(api: StewardApi, profile: Profile): Promise<string> {
  if (profile.eligibility.kind === 'inline') {
    return profile.eligibility.credential;
  }
  // A fresh nullifier per run. One active policy per nullifier per series is
  // enforced in /v1/bind, so re-using one would refuse the second run with
  // already_covered rather than prove anything.
  const nullifier = `${Date.now()}${randomInt(100_000, 999_999)}`;
  const issued = await api.demoEligibility({
    group: profile.occupation,
    wallet: profile.wallet.accountId,
    walletEvm: profile.wallet.evmAddress,
    nullifier,
  });
  return issued.eligibility;
}

interface ScheduledPremiums {
  created: CreatedSchedule[];
  periods: number[];
  deferredPeriods: number[];
}

async function scheduleThePremiums(input: {
  client: ReturnType<typeof stewardClient>;
  config: StewardConfig;
  policy: PolicyResponse;
  options: RunOptions;
  createdAt: Date;
}): Promise<ScheduledPremiums> {
  const { client, config, policy, options, createdAt } = input;
  const token = config.settlementToken;
  const firstDueAt = dueAt(policy, createdAt, options.cadence);
  const plan = premiumPlan({
    policyId: policy.policy_id,
    paidThrough: periodNumber(policy.paid_through),
    firstDueAt,
    count: options.premiums,
    cadence: options.cadence,
    createdAt,
  });
  const toCreate = creatable(plan);
  const notYet = deferred(plan);

  console.log(`\n7. the premium schedule, ${options.premiums} months as Scheduled Transactions`);
  console.log(
    `   not x402: the exact scheme requires a bare TransferTransaction and forbids one wrapped in a ScheduleCreate`,
  );
  console.log(
    `   payer ${config.steward.accountId}, payee ${config.premiumAccountId}, ` +
      `${toDisplay(policy.premium.amount, token.decimals)} ${token.symbol} a month`,
  );

  const created = await createPremiumSchedules({
    client,
    tokenId: token.tokenId,
    payer: { accountId: config.steward.accountId, privateKey: config.steward.privateKey },
    to: config.premiumAccountId,
    amount: BigInt(policy.premium.amount),
    premiums: toCreate,
  });
  for (const [position, schedule] of created.entries()) {
    const premium = toCreate[position];
    console.log(
      `   ${String(premium?.slot.period)}  schedule ${schedule.scheduleId}, due ${schedule.expirationTime.toISOString()}, ` +
        `memo "${schedule.memo}"`,
    );
    console.log(`          ${schedule.links.schedule}`);
  }
  for (const premium of notYet) {
    console.log(
      `   ${String(premium.slot.period)}  not created: due in ${Math.round(premium.secondsOut / 86400)} days, past the 62 day cap. ` +
        `The watcher creates it when the month before it executes.`,
    );
  }
  console.log(
    '   nothing calls CoverPool.recordPremium for these months yet: it is onlyRole(BINDER_ROLE),',
  );
  console.log(
    '   held by the api account, and no endpoint exposes it. The schedule ids and memos are in the',
  );
  console.log('   journal so the watcher can find them. See docs/DECISIONS.md, T09.');

  return {
    created,
    periods: toCreate.map((premium) => premium.slot.period),
    deferredPeriods: notYet.map((premium) => premium.slot.period),
  };
}

/**
 * When the second premium is due. The API answers it as `next_payment_due`, a
 * calendar date; the compressed demo cadence ignores it and counts from now.
 */
function dueAt(policy: PolicyResponse, createdAt: Date, cadence: Cadence): Date {
  if (cadence.kind === 'demo') {
    return new Date(createdAt.getTime() + cadence.intervalSeconds * 1000);
  }
  if (policy.next_payment_due === null) {
    throw new Error(`the policy ${policy.policy_id} carries no next payment date`);
  }
  const parsed = Date.parse(`${policy.next_payment_due}T12:00:00Z`);
  if (Number.isNaN(parsed)) {
    throw new Error(`next_payment_due is YYYY-MM-DD, got ${policy.next_payment_due}`);
  }
  return new Date(parsed);
}

async function journal(
  client: ReturnType<typeof stewardClient>,
  config: StewardConfig,
  profile: Profile,
  decision: ReturnType<typeof decide>,
  replay: boolean,
  settlements: JournalSettlements,
  bound: Parameters<typeof journalMessage>[0]['bound'],
  step: number,
): Promise<{ link: string; sequenceNumber: number }> {
  const message = journalMessage({
    agent: config.steward.accountId,
    principal: { wallet: profile.wallet.accountId, group: profile.occupation },
    eligibility: profile.eligibility.kind,
    decision,
    replay,
    settlements,
    bound,
  });
  const text = encodeJournalMessage(message);
  console.log(`\n${step}. the journal, topic ${config.journalTopicId}`);
  console.log(`   ${text}`);
  const receipt = await publishJournal(client, config.journalTopicId, text);
  console.log(
    `   published at sequence ${receipt.sequenceNumber}, transaction ${receipt.transactionId}`,
  );
  console.log(`   ${receipt.link}`);
  return { link: receipt.link, sequenceNumber: receipt.sequenceNumber };
}

/** Wait for the first scheduled premium and say whether the money moved. */
async function watchFirstPremium(config: StewardConfig, schedule: CreatedSchedule): Promise<void> {
  const waitSeconds = Math.max(
    30,
    Math.ceil((schedule.expirationTime.getTime() - Date.now()) / 1000) + 90,
  );
  console.log(
    `\n9. waiting up to ${waitSeconds}s for schedule ${schedule.scheduleId} to execute at ${schedule.expirationTime.toISOString()}`,
  );
  const execution = await waitForExecution(config.mirrorUrl, schedule.scheduleId, {
    attempts: Math.ceil(waitSeconds / 5),
    delayMs: 5000,
  });
  if (execution === null) {
    console.log('   it has not executed yet. A schedule that never executes is a missed premium.');
    return;
  }
  console.log(
    `   executed ${execution.executedAt}, result ${execution.result}, settled ${String(execution.settled)}`,
  );
  console.log(`   ${execution.link}`);
  console.log(`   schedule ${hashscanUrl('schedule', schedule.scheduleId)}`);
}

async function balance(mirror: MirrorClient, config: StewardConfig): Promise<bigint> {
  const relationship = await mirror.tokenRelationship(
    config.steward.accountId,
    config.settlementToken.tokenId,
  );
  if (relationship === null) {
    throw new Error(
      `the agent ${config.steward.accountId} is not associated with ${config.settlementToken.symbol}`,
    );
  }
  return BigInt(relationship.balance);
}
