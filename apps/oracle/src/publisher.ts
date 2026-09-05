import {
  AccountId,
  Client,
  PrivateKey,
  TopicId,
  TopicMessageSubmitTransaction,
} from '@hiero-ledger/sdk';

/**
 * Putting a signed observation on the index topic.
 *
 * The sequence number comes back on the receipt and it is what the on chain
 * submission carries, so the order is fixed: publish first, read
 * `topicSequenceNumber`, then call `submitObservation`. A submission that
 * pointed at a message which was never written would be an index nobody can
 * check.
 *
 * The index topic has a submit key and it is the oracle's own key, so the
 * client's operator signature is the submit signature. Nothing else can write
 * to the topic.
 */

export interface PublishResult {
  sequenceNumber: number;
  /** The SDK form, `0.0.x@seconds.nanos`. */
  transactionId: string;
  topicId: string;
}

export interface Publisher {
  publish(bytes: Buffer): Promise<PublishResult>;
  close(): Promise<void>;
}

export class HcsPublisher implements Publisher {
  private readonly client: Client;

  constructor(
    private readonly topicId: string,
    accountId: string,
    privateKeyHex: string,
  ) {
    this.client = Client.forTestnet().setOperator(
      AccountId.fromString(accountId),
      PrivateKey.fromStringECDSA(privateKeyHex),
    );
  }

  async publish(bytes: Buffer): Promise<PublishResult> {
    const response = await new TopicMessageSubmitTransaction()
      .setTopicId(TopicId.fromString(this.topicId))
      .setMessage(bytes)
      .execute(this.client);
    const receipt = await response.getReceipt(this.client);
    const sequence = receipt.topicSequenceNumber;
    if (sequence === null) {
      throw new Error(`the receipt for ${response.transactionId.toString()} carries no sequence`);
    }
    return {
      sequenceNumber: Number(sequence.toString()),
      transactionId: response.transactionId.toString(),
      topicId: this.topicId,
    };
  }

  async close(): Promise<void> {
    this.client.close();
  }
}

/**
 * The publisher a dry run uses. It hands back the sequence numbers the topic
 * would have given so that the rest of the pipeline runs exactly as it would
 * live, including the on chain call's payload, without writing anything.
 */
export class DryRunPublisher implements Publisher {
  private next: number;
  readonly published: Buffer[] = [];

  constructor(
    private readonly topicId = 'dry-run',
    firstSequence = 1,
  ) {
    this.next = firstSequence;
  }

  async publish(bytes: Buffer): Promise<PublishResult> {
    this.published.push(bytes);
    const sequenceNumber = this.next;
    this.next += 1;
    return { sequenceNumber, transactionId: `dry-run-${sequenceNumber}`, topicId: this.topicId };
  }

  async close(): Promise<void> {}
}

/** HashScan link for a topic message, for the run log and docs/HEDERA.md. */
export function topicMessageUrl(topicId: string, sequenceNumber: number): string {
  return `https://hashscan.io/testnet/topic/${topicId}?ps=1&pf=1&ss=${sequenceNumber}`;
}

/**
 * The mirror node link that answers with the message itself.
 *
 * docs/harness-notes.md records that `GET /topics/{id}/messages` answers 200
 * with an empty array for a topic that does not exist, so a reader checking
 * whether anything was published must confirm the topic through
 * `GET /topics/{id}` first. This link is the message, not the existence check.
 */
export function mirrorMessageUrl(
  mirrorUrl: string,
  topicId: string,
  sequenceNumber: number,
): string {
  return `${mirrorUrl.replace(/\/$/, '')}/topics/${topicId}/messages/${sequenceNumber}`;
}
