import {
  AccountId,
  Client,
  Hbar,
  PrivateKey,
  TopicMessageSubmitTransaction,
} from '@hiero-ledger/sdk';
import { hashscanUrl } from '@creance/client';

/// What the Adjuster does directly against Hedera.
///
/// One thing: it writes the decision hash to the claims topic. That topic's
/// submit key is the adjuster account's (docs/HEDERA.md, Topics), so the API
/// cannot write it at all and the Adjuster builds its own client with its own
/// key rather than asking the API to publish on its behalf.
///
/// The message itself is built by the API's audit helpers, which enforce the
/// roughly 1 KB cap and the fixed version 1 shape. This file is only the key
/// and the transaction.

export interface TopicReceipt {
  topicId: string;
  sequenceNumber: number;
  transactionId: string;
  link: string;
}

/** A client whose operator is the Adjuster's own account. */
export function adjusterClient(accountId: string, privateKey: string, network: string): Client {
  if (network !== 'testnet') {
    throw new Error(`refusing to build a ${network} client: this build is testnet only`);
  }
  const client = Client.forTestnet();
  client.setOperator(AccountId.fromString(accountId), PrivateKey.fromStringECDSA(privateKey));
  client.setDefaultMaxTransactionFee(new Hbar(10));
  return client;
}

/** One message on the claims topic. */
export async function publishToTopic(
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

/**
 * The publisher the pass is handed.
 *
 * Behind an interface so `pnpm test` never touches testnet and a dry run can
 * decide a whole queue without writing anything. A null publisher is a
 * deployment with no key: it still decides, and the decision is stored without
 * a sequence number, which is a query rather than a lost decision.
 */
export interface DecisionPublisher {
  publish(message: string): Promise<TopicReceipt | null>;
}

export class TopicDecisionPublisher implements DecisionPublisher {
  constructor(
    private readonly client: Client,
    private readonly topicId: string,
  ) {}

  async publish(message: string): Promise<TopicReceipt | null> {
    return await publishToTopic(this.client, this.topicId, message);
  }

  close(): void {
    this.client.close();
  }
}

/** Publishes nothing and says so. Used by `--dry-run`. */
export class NoPublisher implements DecisionPublisher {
  async publish(): Promise<TopicReceipt | null> {
    return null;
  }
}
