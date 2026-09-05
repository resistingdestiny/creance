import { MirrorClient } from '@creance/client';

import type { ApiConfig } from '../src/config.js';
import type { BindCall, ChainGateway, ChainWrite, SeriesChainState } from '../src/chain/cover-pool.js';
import type { HederaGateway, MintedPolicyNft, TopicReceipt } from '../src/chain/hedera.js';
import { CredentialIssuer } from '../src/credentials.js';
import { MemoryRepository } from '../src/db/memory.js';
import type { GroupRow, ObservationRow } from '../src/db/types.js';
import { buildServer } from '../src/server.js';
import type { Services } from '../src/services.js';

/// The demo deployment as it stands on testnet, so the unit tests check shapes
/// against real ids with no chain, no database and no key.

export const DEMO_SERIES_KEY =
  '0x4f44492d434f4d502d323032362d303100000000000000000000000000000000';

export const POLICYHOLDER_1 = {
  accountId: '0.0.10366453',
  address: '0xcad39730d48683b13e6077a70c6972add449b6f5',
};

export const CONFIG: ApiConfig = {
  network: 'testnet',
  chainId: 296,
  rpcUrl: 'https://testnet.hashio.io/api',
  mirrorUrl: 'https://testnet.mirrornode.hedera.com/api/v1',
  publicBaseUrl: 'http://localhost:3210',
  coverPoolAddress: '0x6358ddd5AA2e1797ddA949D7d82eA86C9F89ff09',
  vaultAddress: '0xD0473d355ECB299F2ECc0d92124bc8CF63554e60',
  settlementToken: {
    tokenId: '0.0.10366463',
    address: '0x00000000000000000000000000000000009e2dff',
    decimals: 6,
    symbol: 'TUSD',
  },
  policyNftTokenId: '0.0.10366468',
  paymentsTopicId: '0.0.10366471',
  indexTopicId: '0.0.10366470',
  claimsTopicId: '0.0.10366473',
  series: [
    {
      label: 'ODI-COMP-2026-01',
      seriesId: DEMO_SERIES_KEY,
      groupKey: 'computer_math',
      maturityAt: 1820082162,
    },
  ],
  api: {
    accountId: '0.0.10366450',
    address: '0x7c02879d6b95f923681f517b0487aa45af2b8fdf',
    key: undefined,
  },
  operator: {
    accountId: '0.0.10362512',
    address: '0x639444758b987b4d938c57169a1f61a62b2d009c',
    key: undefined,
  },
  credentialTtlSeconds: 1800,
  quoteTtlSeconds: 900,
  world: {
    appId: 'app_8569aa8d1bbfb24b1243e86d4fc34adc',
    rpId: 'rp_d6ae9b4ff2018a15',
    verifyId: 'rp_d6ae9b4ff2018a15',
    verifyUrl: 'https://developer.world.org/api/v4/verify',
    // The vector key from the World signatures page, never a real one. The
    // tests that sign anything stub the clock and the random source with it.
    signingKey: `0x${'ab'.repeat(32)}`,
    signerAddress: '0xe239cdc5fbe977a8a141b72194d3cf8c41bc5bc6',
    actionEligibility: 'occupation-cover-eligibility',
    actionClaim: 'occupation-cover-claim',
    environment: 'staging',
    preset: 'selfieCheckLegacy',
    identifiers: ['selfie', 'face'],
    rpContextTtlSeconds: 300,
    enabled: true,
  },
  demoIssuer: true,
  databaseUrl: undefined,
};

export const GROUPS: GroupRow[] = [
  {
    groupKey: 'computer_math',
    label: 'Computer and mathematical',
    blsSeries: 'LNU04032215',
    pickerOrder: 11,
  },
  {
    groupKey: 'legal',
    label: 'Legal',
    blsSeries: 'LNU04032218',
    pickerOrder: 12,
  },
];

/** The registered series as CoverPool reports it: 100,000 TUSD, nothing bound. */
export const SERIES_STATE: SeriesChainState = {
  status: 'active',
  groupKey: 'computer_math',
  attachmentShock: 2,
  levelLine: -0.68,
  exhaustionShock: 4,
  payoutMode: 'full',
  waitingPeriodSeconds: 5_184_000,
  termSeconds: 31_536_000,
  gracePeriodSeconds: 1_296_000,
  claimWindowObsSeconds: 2_592_000,
  claimWindowSepSeconds: 5_184_000,
  lookbackMonths: 2,
  activeExposure: 0n,
  principalRemaining: 100_000_000_000n,
  freeCapacity: 100_000_000_000n,
};

export class FakeChain implements ChainGateway {
  readonly binds: BindCall[] = [];
  bindError: Error | null = null;

  constructor(private state: SeriesChainState = SERIES_STATE) {}

  set(state: Partial<SeriesChainState>): void {
    this.state = { ...this.state, ...state };
  }

  async seriesState(): Promise<SeriesChainState> {
    return this.state;
  }

  async activePolicyOf(): Promise<string> {
    return `0x${'0'.repeat(64)}`;
  }

  async bind(call: BindCall): Promise<ChainWrite> {
    if (this.bindError !== null) throw this.bindError;
    this.binds.push(call);
    return {
      transactionHash: `0x${'ab'.repeat(32)}`,
      hashscan: `https://hashscan.io/testnet/transaction/0x${'ab'.repeat(32)}`,
      gasUsed: '224668',
    };
  }

  async recordPremium(): Promise<ChainWrite> {
    return {
      transactionHash: `0x${'cd'.repeat(32)}`,
      hashscan: `https://hashscan.io/testnet/transaction/0x${'cd'.repeat(32)}`,
      gasUsed: '66627',
    };
  }
}

export class FakeHedera implements HederaGateway {
  readonly published: { topicId: string; message: string }[] = [];
  readonly minted: { holder: string; metadata: string }[] = [];
  /// Set to make the mint throw, which is the path that leaves a policy bound
  /// on chain with no receipt in the holder's wallet.
  mintError: Error | null = null;
  /// Set to make the nth publish throw. 2 is the outcome message.
  failPublishAt: number | null = null;
  private sequence = 40;

  async publish(topicId: string, message: string): Promise<TopicReceipt> {
    if (this.failPublishAt !== null && this.published.length + 1 === this.failPublishAt) {
      throw new Error('the topic refused the message');
    }
    this.sequence += 1;
    this.published.push({ topicId, message });
    return {
      topicId,
      sequenceNumber: this.sequence,
      transactionId: `0.0.10366450@1757000000.00000000${this.published.length}`,
      hashscan: `https://hashscan.io/testnet/topic/${topicId}`,
    };
  }

  async mintPolicyNft(holder: string, metadata: string): Promise<MintedPolicyNft> {
    if (this.mintError !== null) throw this.mintError;
    this.minted.push({ holder, metadata });
    return {
      tokenId: '0.0.10366468',
      serial: this.minted.length,
      mintTransactionId: '0.0.10366450@1757000001.000000000',
      transferTransactionId: '0.0.10366450@1757000002.000000000',
      freezeTransactionId: '0.0.10366450@1757000003.000000000',
      hashscan: `https://hashscan.io/testnet/token/0.0.10366468/${this.minted.length}`,
    };
  }

  close(): void {
    // Nothing to release.
  }
}

/** One published observation, the July 2026 reading for the demo group. */
export function observation(overrides: Partial<ObservationRow> = {}): ObservationRow {
  return {
    groupKey: 'computer_math',
    seriesId: null,
    period: 202607,
    uG: 4.1,
    uAll: 4.5,
    e: -0.4,
    ebar: -0.6,
    odi: 0.3,
    open: false,
    openReason: null,
    status: 'final',
    modelVersion: 'odi-1',
    source: 'bls:LNU04032215',
    sourceHash: `sha256:${'0'.repeat(64)}`,
    computedAt: '2026-08-07T12:31:00.000Z',
    hcsTopic: null,
    hcsSeq: null,
    submitTx: null,
    replay: false,
    ...overrides,
  };
}

/**
 * The mirror node, recorded rather than reached.
 *
 * `pnpm test` is chain free, and the audit endpoint's whole point is that it
 * answers from the topic. So the topic is a list of messages here and the
 * client is the real `MirrorClient` over a stub fetch, which means the query
 * building, the base64 decoding and the 404 handling are all the real ones.
 */
export class MirrorStub {
  private readonly messages = new Map<string, { seq: number; at: string; body: string }[]>();
  /** Set to make every read throw, which is the mirror being unreachable. */
  unreachable = false;

  add(topicId: string, sequenceNumber: number, body: unknown, consensusTimestamp: string): this {
    const list = this.messages.get(topicId) ?? [];
    list.push({
      seq: sequenceNumber,
      at: consensusTimestamp,
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
    list.sort((a, b) => a.seq - b.seq);
    this.messages.set(topicId, list);
    return this;
  }

  client(): MirrorClient {
    return new MirrorClient({
      baseUrl: 'https://testnet.mirrornode.hedera.com/api/v1',
      fetchImpl: (async (input: string) => {
        if (this.unreachable) throw new TypeError('fetch failed');
        const url = new URL(String(input));
        const topicId = /\/topics\/([^/]+)\/messages/.exec(url.pathname)?.[1] ?? '';
        const filter = url.searchParams.get('sequencenumber');
        const limit = Number(url.searchParams.get('limit') ?? '25');
        const all = this.messages.get(topicId) ?? [];
        const wanted = all.filter((message) => {
          if (filter === null) return true;
          const [operator, value] = filter.split(':');
          const sequence = Number(value);
          return operator === 'eq' ? message.seq === sequence : message.seq >= sequence;
        });
        return new Response(
          JSON.stringify({
            messages: wanted.slice(0, limit).map((message) => ({
              consensus_timestamp: message.at,
              topic_id: topicId,
              sequence_number: message.seq,
              message: Buffer.from(message.body, 'utf8').toString('base64'),
              running_hash: '0x00',
              payer_account_id: '0.0.10366450',
            })),
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }) as unknown as typeof fetch,
    });
  }
}

export interface TestHarness {
  services: Services;
  repository: MemoryRepository;
  chain: FakeChain;
  hedera: FakeHedera;
  mirror: MirrorStub;
}

export async function buildTestServices(
  options: {
    observations?: ObservationRow[];
    hedera?: FakeHedera | null;
    mirror?: MirrorStub;
  } = {},
): Promise<TestHarness> {
  const repository = new MemoryRepository(GROUPS);
  await repository.upsertObservations(options.observations ?? [observation()]);
  const chain = new FakeChain();
  const hedera = options.hedera === undefined ? new FakeHedera() : options.hedera;
  const mirror = options.mirror ?? new MirrorStub();
  const issuer = await CredentialIssuer.create({
    issuer: `${CONFIG.publicBaseUrl}/`,
    ttlSeconds: CONFIG.credentialTtlSeconds,
  });
  const services: Services = {
    config: CONFIG,
    repository,
    chain,
    hedera,
    mirror: mirror.client(),
    issuer,
    indexData: null,
    // No gate: the paid path has its own file and its own testnet command.
    x402: null,
    thresholds: new Map([['computer_math', { attachmentShock: 2, levelLine: -0.68 }]]),
    gitSha: 'testsha',
    startedAt: new Date('2026-09-05T00:00:00Z'),
  };
  return { services, repository, chain, hedera: hedera ?? new FakeHedera(), mirror };
}

export async function buildTestServer(
  options: {
    observations?: ObservationRow[];
    hedera?: FakeHedera | null;
    mirror?: MirrorStub;
  } = {},
) {
  const harness = await buildTestServices(options);
  const app = await buildServer({ services: harness.services });
  await app.ready();
  return { app, ...harness };
}

/** A credential the demo issuer would have minted, and its stored row. */
export async function issueCredential(
  harness: TestHarness,
  overrides: {
    nullifier?: string;
    group?: string;
    seriesId?: string;
    wallet?: string;
    walletEvm?: string;
  } = {},
): Promise<string> {
  const nullifier = overrides.nullifier ?? '5972000000000000000000000000000000000000000000000009143';
  const groupKey = overrides.group ?? 'computer_math';
  const wallet = overrides.wallet ?? POLICYHOLDER_1.accountId;
  const walletEvm = overrides.walletEvm ?? POLICYHOLDER_1.address;
  const issued = await harness.services.issuer.issue({
    nullifier,
    group: groupKey,
    series_id: overrides.seriesId ?? 'ODI-COMP-2026-01',
    wallet,
    wallet_evm: walletEvm,
    scope: 'bind',
    world: {
      action: 'occupation-cover-eligibility',
      environment: 'demo',
      credential: 'demo-issuer',
      verified_at: 1757000000,
      presence: false,
    },
  });
  await harness.repository.upsertUser({ nullifier, groupKey, wallet, walletEvm });
  await harness.repository.insertCredential({
    jti: issued.jti,
    kind: 'eligibility',
    nullifier,
    seriesId: overrides.seriesId ?? 'ODI-COMP-2026-01',
    groupKey,
    policyId: null,
    wallet,
    walletEvm,
    presence: false,
    issuer: 'demo',
    issuedAt: issued.issuedAt.toISOString(),
    expiresAt: issued.expiresAt.toISOString(),
    consumedAt: null,
  });
  return issued.token;
}
