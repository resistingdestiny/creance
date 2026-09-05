import { loadApiConfig, type ApiConfig } from './config.js';
import { CredentialIssuer } from './credentials.js';
import { MemoryRepository } from './db/memory.js';
import { createPool, PostgresRepository } from './db/postgres.js';
import { migrate } from './db/migrate.js';
import type { GroupRow, Repository } from './db/types.js';
import { EthersChainGateway, type ChainGateway } from './chain/cover-pool.js';
import { SdkHederaGateway, type HederaGateway } from './chain/hedera.js';
import { seriesRowFrom } from './series.js';
import { loadX402Config } from './x402/config.js';
import { X402Gate } from './x402/gate.js';
import {
  allObservationRows,
  frozenThresholds,
  loadIndexData,
  type IndexData,
  type Thresholds,
} from './index-data.js';

/// What the routes are handed.
///
/// Everything that talks to the outside world is behind an interface, so a unit
/// test builds a server with a memory repository and recorded chain state and
/// `pnpm test` needs neither Postgres nor testnet. `buildServices` is the wire
/// up that the real process uses.

export interface Services {
  config: ApiConfig;
  repository: Repository;
  chain: ChainGateway;
  hedera: HederaGateway | null;
  issuer: CredentialIssuer;
  indexData: IndexData | null;
  /** The frozen A and L per group, which are not columns on observations. */
  thresholds: Map<string, Thresholds>;
  /** The x402 gate, or null when this deployment serves the routes open. */
  x402: X402Gate | null;
  gitSha: string;
  startedAt: Date;
}

export interface BuildServicesOptions {
  config?: ApiConfig;
  repository?: Repository;
  chain?: ChainGateway;
  hedera?: HederaGateway | null;
  issuer?: CredentialIssuer;
  indexData?: IndexData | null;
  thresholds?: Map<string, Thresholds>;
  x402?: X402Gate | null;
  /** Skip the archive load, which costs a second and is not wanted in tests. */
  loadIndex?: boolean;
  /** Run migrations and backfill the index before serving. */
  prepareDatabase?: boolean;
}

export async function buildServices(options: BuildServicesOptions = {}): Promise<Services> {
  const config = options.config ?? loadApiConfig();

  let repository = options.repository;
  if (repository === undefined) {
    if (config.databaseUrl === undefined || config.databaseUrl === '') {
      throw new Error('DATABASE_URL is not set, so the API has nowhere to write a policy');
    }
    const pool = createPool(config.databaseUrl);
    if (options.prepareDatabase !== false) await migrate(pool);
    repository = new PostgresRepository(pool);
  }

  const chain =
    options.chain ??
    new EthersChainGateway(
      config.coverPoolAddress,
      config.vaultAddress,
      config.rpcUrl,
      config.chainId,
      config.api.key,
    );

  const hedera =
    options.hedera !== undefined
      ? options.hedera
      : buildHederaGateway(config);

  const issuer =
    options.issuer ??
    (await CredentialIssuer.create({
      issuer: `${config.publicBaseUrl}/`,
      ttlSeconds: config.credentialTtlSeconds,
      signingJwk: process.env.ELIGIBILITY_SIGNING_JWK,
      kid: process.env.ELIGIBILITY_KID,
    }));

  const indexData =
    options.indexData !== undefined
      ? options.indexData
      : options.loadIndex === false
        ? null
        : loadIndexData();

  const x402Config = loadX402Config(config);
  const x402 =
    options.x402 !== undefined
      ? options.x402
      : x402Config === null
        ? null
        : new X402Gate({
            config: x402Config,
            repository,
            hedera,
            paymentsTopicId: config.paymentsTopicId,
          });

  return {
    config,
    repository,
    chain,
    hedera,
    issuer,
    indexData,
    x402,
    thresholds: options.thresholds ?? frozenThresholds(),
    gitSha: process.env.GIT_SHA ?? 'unknown',
    startedAt: new Date(),
  };
}

/**
 * The SDK client, when the process has both keys. It has two: the api key
 * writes the payments topic, the operator key signs the policy NFT's mint,
 * transfer and freeze, because the collection's keys are the operator's.
 * Without them the API still serves every read and refuses a bind with a 503.
 */
function buildHederaGateway(config: ApiConfig): HederaGateway | null {
  if (
    config.api.key === undefined ||
    config.operator.key === undefined ||
    config.policyNftTokenId === '' ||
    config.paymentsTopicId === ''
  ) {
    return null;
  }
  return new SdkHederaGateway({
    network: config.network,
    mirrorUrl: config.mirrorUrl,
    policyNftTokenId: config.policyNftTokenId,
    apiAccountId: config.api.accountId,
    apiKey: config.api.key,
    operatorAccountId: config.operator.accountId,
    operatorKey: config.operator.key,
  });
}

/**
 * Write the registered series into `series` from what the chain says.
 *
 * The row is a cache: `registerSeries` froze the terms and nothing off chain
 * may disagree with them. It runs at boot because the credentials and the
 * policies both reference it, so the first request must not be the thing that
 * discovers it is missing.
 */
export async function syncSeries(services: Services): Promise<number> {
  let written = 0;
  for (const series of services.config.series) {
    const state = await services.chain.seriesState(series.seriesId);
    await services.repository.upsertSeries(seriesRowFrom(series, state, services.config));
    written += 1;
  }
  return written;
}

/**
 * Load the archive into `observations` once, so that GET /v1/index/:group reads
 * the table rather than recomputing. T12 becomes the writer; until then this is
 * where the published history comes from. Existing rows are left alone: the
 * first published value settles forever.
 */
export async function backfillObservations(services: Services): Promise<number> {
  if (services.indexData === null) return 0;
  return await services.repository.upsertObservations(allObservationRows(services.indexData));
}

/** The reference rows the index endpoint needs, for the memory repository. */
export function groupRowsFrom(rows: GroupRow[]): MemoryRepository {
  return new MemoryRepository(rows);
}
