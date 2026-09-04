// Mirror node reads. Receipts are the source of truth for anything this script
// creates; the mirror node is how the next run finds out what already exists,
// and it lags consensus, so every read that follows a write is a poll.
// https://docs.hedera.com/hedera/sdks-and-apis/rest-api

export interface MirrorAccount {
  account: string;
  evm_address: string | null;
  balance: { balance: number } | null;
  max_automatic_token_associations: number | null;
  key: { _type: string; key: string } | null;
  deleted: boolean | null;
}

export interface MirrorToken {
  token_id: string;
  name: string;
  symbol: string;
  decimals: string;
  type: string;
  freeze_default: boolean;
  deleted: boolean | null;
}

export interface MirrorTopic {
  topic_id: string;
  memo: string;
  deleted: boolean | null;
}

export interface MirrorTokenRelationship {
  token_id: string;
  balance: number;
  automatic_association: boolean;
  freeze_status: string | null;
}

export class Mirror {
  constructor(private readonly baseUrl: string) {}

  private url(path: string): string {
    return `${this.baseUrl.replace(/\/+$/, '')}${path}`;
  }

  /** A raw GET. Returns the status alongside the body so 404 can mean "absent". */
  async get<T>(path: string): Promise<{ status: number; body: T | null }> {
    const response = await fetch(this.url(path), { headers: { accept: 'application/json' } });
    if (response.status === 404) {
      await response.text();
      return { status: 404, body: null };
    }
    if (!response.ok) {
      throw new Error(`mirror node ${response.status} for ${path}: ${await response.text()}`);
    }
    return { status: response.status, body: (await response.json()) as T };
  }

  /** The account by id or by 0x EVM address, or null when it does not exist. */
  async account(idOrEvmAddress: string): Promise<MirrorAccount | null> {
    return (await this.get<MirrorAccount>(`/accounts/${idOrEvmAddress}?limit=1`)).body;
  }

  async token(tokenId: string): Promise<MirrorToken | null> {
    return (await this.get<MirrorToken>(`/tokens/${tokenId}`)).body;
  }

  /**
   * A topic by id. Note that this endpoint does return 404 for an unknown
   * topic, unlike the messages endpoint under it, which answers 200 with an
   * empty list. See docs/harness-notes.md.
   */
  async topic(topicId: string): Promise<MirrorTopic | null> {
    return (await this.get<MirrorTopic>(`/topics/${topicId}`)).body;
  }

  /** The account to token relationship, or null when the two are not associated. */
  async tokenRelationship(
    accountId: string,
    tokenId: string,
  ): Promise<MirrorTokenRelationship | null> {
    const { body } = await this.get<{ tokens: MirrorTokenRelationship[] }>(
      `/accounts/${accountId}/tokens?token.id=${tokenId}&limit=1`,
    );
    return body?.tokens?.[0] ?? null;
  }

  async operatorBalanceHbar(accountId: string): Promise<number> {
    const account = await this.account(accountId);
    if (!account?.balance) {
      throw new Error(`the mirror node has no balance for ${accountId}`);
    }
    return account.balance.balance / 1e8;
  }
}

/**
 * Poll until the read returns something, because a receipt arrives before the
 * mirror node has the entity. Throws with the description when it never does.
 */
export async function pollMirror<T>(
  description: string,
  read: () => Promise<T | null>,
  { attempts = 20, delayMs = 1500 }: { attempts?: number; delayMs?: number } = {},
): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const value = await read();
      if (value !== null && value !== undefined) {
        return value;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  const suffix = lastError instanceof Error ? `: ${lastError.message}` : '';
  throw new Error(`the mirror node never reported ${description} after ${attempts} tries${suffix}`);
}

/**
 * Confirm the JSON-RPC relay is answering for Hedera testnet before anything
 * writes. 0x128 is 296.
 * https://docs.hedera.com/hedera/core-concepts/smart-contracts/deploying-smart-contracts/json-rpc-relay
 */
export async function assertTestnetChainId(rpcUrl: string): Promise<string> {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
  });
  if (!response.ok) {
    throw new Error(`the relay at ${rpcUrl} answered ${response.status}`);
  }
  const body = (await response.json()) as { result?: string };
  if (body.result !== '0x128') {
    throw new Error(`expected chain id 0x128 from ${rpcUrl}, got ${String(body.result)}`);
  }
  return body.result;
}
