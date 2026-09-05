import { Wallet } from 'ethers';

import { MirrorClient } from '@creance/client';

import type { ApiConfig } from '../src/config.js';
import type {
  BindCall,
  ChainGateway,
  ChainWrite,
  ClaimCall,
  LossWindow,
  LossWindowAnswer,
  SeriesChainState,
} from '../src/chain/cover-pool.js';
import {
  claimAuthorisationDomain,
  CLAIM_AUTHORISATION_TYPES,
  type ClaimAuthorisation,
} from '../src/chain/authorisation.js';
import type { HederaGateway, MintedPolicyNft, TopicReceipt } from '../src/chain/hedera.js';
import {
  MemoryObjectStore,
  loadEvidenceKeys,
  sealField,
  type EvidenceKeys,
} from '../src/claims/evidence.js';
import type { AdminTokens } from '../src/claims/token.js';
import { TopicOutbox } from '../src/x402/settlement.js';
import { CredentialIssuer } from '../src/credentials.js';
import { MemoryRepository } from '../src/db/memory.js';
import type { ClaimRow, GroupRow, ObservationRow } from '../src/db/types.js';
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
    // No Mini App is registered yet, so the surface has an id only in the tests
    // that ask what the entry links look like.
    miniAppId: '',
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
  autoApproval: { limit: '5000000000', confidence: 0.9 },
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
  firstOpenMonth: 202604,
  lastOpenMonth: 202605,
  lastObservedMonth: 202607,
  windowEndsAt: Math.floor(Date.parse('2026-10-05T09:04:51Z') / 1000),
};

export class FakeChain implements ChainGateway {
  readonly binds: BindCall[] = [];
  bindError: Error | null = null;
  /** What `openMonths` reports. The window rules read the chain, never a table. */
  openMonths: number[] = [202604, 202605];
  /** What `claimDeadline` reports, in seconds. Deliberately not recomputed. */
  deadlineAt = Math.floor(Date.parse('2026-10-05T00:00:00Z') / 1000);

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

  async lossWindow(): Promise<LossWindow> {
    return { openMonths: this.openMonths, lastObservedMonth: this.state.lastObservedMonth };
  }

  async claimDeadline(): Promise<number> {
    return this.deadlineAt;
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

  /// The claim half. `payClaim` is recorded rather than sent, and the
  /// authorisation is a real EIP-712 signature from a throwaway key, so a test
  /// can recover the signer and check every field the contract checks.
  readonly claims: { call: ClaimCall; authorisation: string }[] = [];
  readonly authorised: ClaimAuthorisation[] = [];
  readonly closed: string[] = [];
  payClaimError: Error | null = null;
  closeWindowError: Error | null = null;
  /** What `expectedPayout` reports. The demo series pays the cover limit. */
  payout = 1_000_000_000n;
  /** What `isInLossWindow` reports for any month, so a test can move the key. */
  window: LossWindowAnswer = { inWindow: true, qualifyingPeriod: 202604 };
  readonly claimsSigner = new Wallet(`0x${'11'.repeat(32)}`);

  async isInLossWindow(): Promise<LossWindowAnswer> {
    return this.window;
  }

  async expectedPayout(): Promise<bigint> {
    return this.payout;
  }

  async signAuthorisation(authorisation: ClaimAuthorisation): Promise<string> {
    this.authorised.push(authorisation);
    return await this.claimsSigner.signTypedData(
      claimAuthorisationDomain(CONFIG.chainId, CONFIG.coverPoolAddress),
      CLAIM_AUTHORISATION_TYPES as unknown as Record<string, { name: string; type: string }[]>,
      authorisation,
    );
  }

  async payClaim(call: ClaimCall, authorisation: string): Promise<ChainWrite> {
    if (this.payClaimError !== null) throw this.payClaimError;
    this.claims.push({ call, authorisation });
    return {
      transactionHash: `0x${'ef'.repeat(32)}`,
      hashscan: `https://hashscan.io/testnet/transaction/0x${'ef'.repeat(32)}`,
      gasUsed: '172689',
    };
  }

  async closeWindow(seriesKey: string): Promise<ChainWrite> {
    if (this.closeWindowError !== null) throw this.closeWindowError;
    this.closed.push(seriesKey);
    // The contract puts the series back where it was and clears the window, so
    // the recording does too: a job that reads the state back afterwards has to
    // see what the chain would have shown it.
    this.set({ status: 'active', windowEndsAt: 0 });
    return {
      transactionHash: `0x${'ba'.repeat(32)}`,
      hashscan: `https://hashscan.io/testnet/transaction/0x${'ba'.repeat(32)}`,
      gasUsed: '96000',
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

/// The committed packet A, as a claim row.
///
/// One builder, so the review queue's tests and the submission's tests agree
/// about what a submitted claim looks like and a new column is filled in once.

export const CLAIM_ID = 'clm_01K4YBA1Q7F0M3X8T5W2D6C9E4';
export const CLAIM_POLICY_ID = 'pol_01K4YB9X3M8Q0RZ7T2VD6C5H9E';
export const CLAIM_NULLIFIER = '308127544618763950125321744193216571892261741436541721317481123';

export function claimRow(patch: Partial<ClaimRow> = {}): ClaimRow {
  return {
    claimId: CLAIM_ID,
    policyId: CLAIM_POLICY_ID,
    seriesId: 'ODI-COMP-2026-01',
    nullifier: CLAIM_NULLIFIER,
    claimNullifier: null,
    groupKey: 'computer_math',
    status: 'submitted',
    employerNameEnc: sealField(TEST_EVIDENCE_KEYS, 'Northgate Systems Ltd'),
    claimantNameEnc: sealField(TEST_EVIDENCE_KEYS, 'Alex Mercer'),
    jobTitle: 'Software Engineer',
    separationDate: '2026-03-13',
    separationType: 'redundancy',
    attestationMethod: 'eip191',
    attestationVerified: true,
    statementAccepted: true,
    verifiedAt: '2026-09-05T11:56:00Z',
    worldAction: 'occupation-cover-claim',
    worldPresence: true,
    packetHash: 'sha256:abc',
    packetManifest: null,
    decision: null,
    reasons: [],
    reasonLines: [],
    resubmit: null,
    confidence: null,
    reviewer: null,
    decidedBy: null,
    decisionHash: null,
    decisionRecord: null,
    amount: null,
    qualifyingMonth: 202604,
    claimDeadline: '2026-10-05T00:00:00Z',
    authorisation: null,
    authorisationDeadline: null,
    hcsSubmittedSeq: 11,
    hcsDecisionSeq: null,
    paidTx: null,
    submittedAt: '2026-09-05T11:58:00Z',
    decidedAt: null,
    paidAt: null,
    ...patch,
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

/// The review queue's two actors, so a test can prove they are told apart.
export const ADMIN_TOKENS: AdminTokens = {
  admin: 'test-admin-token',
  adjuster: 'test-adjuster-token',
  reviewerName: 'root',
};

/// A throwaway key encryption key. Thirty-two bytes of a fixed pattern: the
/// tests need a key that opens what they sealed and nothing else.
export const TEST_EVIDENCE_KEYS = loadEvidenceKeys({
  EVIDENCE_KEK: Buffer.alloc(32, 7).toString('base64'),
  EVIDENCE_KEK_ID: 'test-kek',
}) as EvidenceKeys;

export interface TestHarness {
  services: Services;
  repository: MemoryRepository;
  chain: FakeChain;
  hedera: FakeHedera;
  mirror: MirrorStub;
  evidenceStore: MemoryObjectStore;
}

export async function buildTestServices(
  options: {
    /** The whole configuration, for a test that turns one field of it off. */
    config?: ApiConfig;
    observations?: ObservationRow[];
    hedera?: FakeHedera | null;
    mirror?: MirrorStub;
    adminTokens?: AdminTokens;
    evidenceKeys?: EvidenceKeys | null;
    evidenceStore?: MemoryObjectStore;
    outbox?: TopicOutbox;
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
    config: options.config ?? CONFIG,
    repository,
    chain,
    hedera,
    mirror: mirror.client(),
    issuer,
    indexData: null,
    // No gate: the paid path has its own file and its own testnet command.
    x402: null,
    outbox: options.outbox ?? new TopicOutbox({ attempts: 1 }),
    adminTokens: options.adminTokens ?? ADMIN_TOKENS,
    evidenceKeys: options.evidenceKeys === undefined ? TEST_EVIDENCE_KEYS : options.evidenceKeys,
    evidenceStore: options.evidenceStore ?? new MemoryObjectStore(),
    thresholds: new Map([['computer_math', { attachmentShock: 2, levelLine: -0.68 }]]),
    gitSha: 'testsha',
    startedAt: new Date('2026-09-05T00:00:00Z'),
  };
  return {
    services,
    repository,
    chain,
    hedera: hedera ?? new FakeHedera(),
    mirror,
    evidenceStore: services.evidenceStore as MemoryObjectStore,
  };
}

export async function buildTestServer(
  options: {
    config?: ApiConfig;
    observations?: ObservationRow[];
    hedera?: FakeHedera | null;
    mirror?: MirrorStub;
    adminTokens?: AdminTokens;
    evidenceKeys?: EvidenceKeys | null;
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
