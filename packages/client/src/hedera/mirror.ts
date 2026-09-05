/// Mirror node reads, for anything that has to be verified rather than trusted.
///
/// The mirror node is how a client checks what the API says happened: the HCS
/// receipt for a policy, and the NFT serial in the holder's account. It lags
/// consensus, so every read that follows a write is a poll, and a caller that
/// treats one 404 as an answer will be wrong about half the time.
///
/// REST reference: https://docs.hedera.com/hedera/sdks-and-apis/rest-api

export interface MirrorTopicMessage {
  consensus_timestamp: string;
  topic_id: string;
  sequence_number: number;
  /** The message, base64 encoded. `decodeMessage` turns it back into text. */
  message: string;
  running_hash: string;
  payer_account_id: string;
}

export interface MirrorNft {
  token_id: string;
  serial_number: number;
  account_id: string;
  /** Base64, as the mirror node returns it. */
  metadata: string;
  deleted: boolean | null;
  created_timestamp: string;
}

export interface MirrorTokenRelationship {
  token_id: string;
  balance: number;
  automatic_association: boolean;
  /** NOT_APPLICABLE, FROZEN or UNFROZEN. */
  freeze_status: string | null;
}

export interface MirrorClientOptions {
  /** Defaults to Hedera testnet. Testnet only, per MISSION rule 1. */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export const TESTNET_MIRROR_URL = 'https://testnet.mirrornode.hedera.com/api/v1';

export class MirrorClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: MirrorClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? TESTNET_MIRROR_URL).replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /** A raw GET. 404 comes back as null so an absent entity is not an error. */
  async get<T>(path: string): Promise<T | null> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      headers: { accept: 'application/json' },
    });
    if (response.status === 404) {
      await response.text();
      return null;
    }
    if (!response.ok) {
      throw new Error(`mirror node ${response.status} for ${path}: ${await response.text()}`);
    }
    return (await response.json()) as T;
  }

  /**
   * Messages on a topic, oldest first by default.
   *
   * Note the asymmetry, measured on testnet and recorded in
   * docs/harness-notes.md: `/topics/{id}` answers 404 for a topic that does not
   * exist, but `/topics/{id}/messages` answers 200 with an empty list. So an
   * empty result here means "no messages yet", never "no such topic".
   */
  async topicMessages(
    topicId: string,
    options: {
      sequenceNumber?: number;
      /** Everything from this sequence number on, which `sequencenumber=gte:` does. */
      fromSequenceNumber?: number;
      limit?: number;
      order?: 'asc' | 'desc';
    } = {},
  ): Promise<MirrorTopicMessage[]> {
    const query = new URLSearchParams({
      limit: String(options.limit ?? 25),
      order: options.order ?? 'asc',
    });
    if (options.sequenceNumber !== undefined) {
      query.set('sequencenumber', `eq:${options.sequenceNumber}`);
    } else if (options.fromSequenceNumber !== undefined) {
      query.set('sequencenumber', `gte:${options.fromSequenceNumber}`);
    }
    const body = await this.get<{ messages?: MirrorTopicMessage[] }>(
      `/topics/${topicId}/messages?${query.toString()}`,
    );
    return body?.messages ?? [];
  }

  /**
   * The window a policy's receipt sits in: its own message and the few that
   * follow it. A bind writes two messages and only the first sequence number is
   * stored (docs/DECISIONS.md, T07, "A bind writes two topic messages, not
   * one"), so the second is found by reading forward from the first.
   */
  async topicMessagesFrom(
    topicId: string,
    sequenceNumber: number,
    limit = 25,
  ): Promise<MirrorTopicMessage[]> {
    return await this.topicMessages(topicId, { fromSequenceNumber: sequenceNumber, limit });
  }

  /** One message by its sequence number, or null until the mirror has it. */
  async topicMessage(topicId: string, sequenceNumber: number): Promise<MirrorTopicMessage | null> {
    const messages = await this.topicMessages(topicId, { sequenceNumber, limit: 1 });
    return messages[0] ?? null;
  }

  /** One serial of an HTS collection, or null until the mirror has it. */
  async nft(tokenId: string, serial: number): Promise<MirrorNft | null> {
    return await this.get<MirrorNft>(`/tokens/${tokenId}/nfts/${serial}`);
  }

  /** The account to token relationship, or null when the two are not associated. */
  async tokenRelationship(
    accountId: string,
    tokenId: string,
  ): Promise<MirrorTokenRelationship | null> {
    const body = await this.get<{ tokens?: MirrorTokenRelationship[] }>(
      `/accounts/${accountId}/tokens?token.id=${tokenId}&limit=1`,
    );
    return body?.tokens?.[0] ?? null;
  }
}

/** A topic message's payload as text. The mirror node returns it base64 encoded. */
export function decodeMessage(message: MirrorTopicMessage): string {
  return Buffer.from(message.message, 'base64').toString('utf8');
}

/** The same, parsed, for the JSON receipts this build writes. */
export function decodeJsonMessage<T>(message: MirrorTopicMessage): T {
  return JSON.parse(decodeMessage(message)) as T;
}

export interface MirrorPollOptions {
  attempts?: number;
  delayMs?: number;
}

/**
 * Poll until the read returns something. A transaction receipt arrives before
 * the mirror node has the entity, so anything read straight after a write has
 * to wait for it rather than conclude it is missing.
 */
export async function pollMirror<T>(
  description: string,
  read: () => Promise<T | null>,
  { attempts = 20, delayMs = 1500 }: MirrorPollOptions = {},
): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const value = await read();
      if (value !== null && value !== undefined) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  const suffix = lastError instanceof Error ? `: ${lastError.message}` : '';
  throw new Error(`the mirror node never reported ${description} after ${attempts} tries${suffix}`);
}
