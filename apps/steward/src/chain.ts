import {
  AccountId,
  Client,
  Hbar,
  PrivateKey,
  TopicMessageSubmitTransaction,
} from '@hiero-ledger/sdk';
import { hashscanUrl, scheduleTransfer, type CreatedSchedule } from '@creance/client';

import type { PlannedPremium } from './premiums.js';

/// What the Steward does directly against Hedera, without the API and without
/// the facilitator.
///
/// Two things. It creates the premium schedules, because months two onwards
/// cannot go through x402: the Hedera exact scheme requires a bare
/// `TransferTransaction` and forbids one wrapped in a `ScheduleCreate`. And it
/// writes its journal to the agent-journal topic, which has no submit key and
/// is public by design, so the agent submits to it under its own account.
///
/// The Steward is the operator of this client, so it pays for everything it
/// does here: the schedule creates, the executions, the premiums themselves and
/// the topic submits.

export interface TopicReceipt {
  topicId: string;
  sequenceNumber: number;
  transactionId: string;
  link: string;
}

/** A client whose operator is the Steward's own account. */
export function stewardClient(accountId: string, privateKey: string, network: string): Client {
  if (network !== 'testnet') {
    throw new Error(`refusing to build a ${network} client: this build is testnet only`);
  }
  const client = Client.forTestnet();
  client.setOperator(AccountId.fromString(accountId), PrivateKey.fromStringECDSA(privateKey));
  client.setDefaultMaxTransactionFee(new Hbar(10));
  return client;
}

/** One journal entry on the agent-journal topic. */
export async function publishJournal(
  client: Client,
  topicId: string,
  message: string,
): Promise<TopicReceipt> {
  const response = await new TopicMessageSubmitTransaction()
    .setTopicId(topicId)
    .setMessage(message)
    .execute(client);
  const receipt = await response.getReceipt(client);
  return {
    topicId,
    sequenceNumber: Number(receipt.topicSequenceNumber?.toString() ?? '0'),
    transactionId: response.transactionId.toString(),
    link: hashscanUrl('topic', topicId),
  };
}

export interface PremiumScheduleInput {
  client: Client;
  tokenId: string;
  /** The Steward's account and key: it pays the create, the execution and the transfer. */
  payer: { accountId: string; privateKey: string };
  /** The premium account, which is the account the first premium settled to. */
  to: string;
  amount: bigint;
  premiums: PlannedPremium[];
}

/**
 * Create one Scheduled Transaction per planned premium, each pre-signed and
 * held until its due date.
 *
 * `waitForExpiry` is on, which is what makes this a schedule and not a queue: a
 * fully signed schedule with it off executes in the same consensus round, which
 * would take every remaining premium at bind time and still return a normal
 * receipt. Each schedule carries an admin key, because a schedule without one
 * is immutable and a lapsed policy has to be able to stop the premiums it has
 * already pre-signed (DESIGN.md 3.5, the 15 day grace).
 *
 * Creating a schedule proves nothing about whether it will pay: an underfunded
 * payer still gets a successful create. The outcome is read from the execution.
 */
export async function createPremiumSchedules(
  input: PremiumScheduleInput,
): Promise<CreatedSchedule[]> {
  const key = PrivateKey.fromStringECDSA(input.payer.privateKey);
  const created: CreatedSchedule[] = [];
  for (const premium of input.premiums) {
    created.push(
      await scheduleTransfer({
        client: input.client,
        tokenId: input.tokenId,
        payer: { accountId: input.payer.accountId, key },
        to: input.to,
        amount: input.amount,
        executeAt: premium.slot.executeAt,
        memo: premium.slot.memo,
        adminKey: key.publicKey,
        waitForExpiry: true,
        preSign: true,
      }),
    );
  }
  return created;
}
