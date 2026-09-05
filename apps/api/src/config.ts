import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { roleKeyHex } from '@creance/client';

import { loadWorldConfig, type WorldConfig } from './world/config.js';

/// Everything the policy endpoints need to know about the deployment, read
/// once at boot and never at request time.
///
/// The two JSON files are the machine readable record of what is on testnet:
/// `docs/hedera.testnet.json` is what `pnpm hedera:setup` created and
/// `contracts/deployments/testnet.json` is what `pnpm contracts:deploy` wrote.
/// They are read as data, exactly as apps/api/src/investor/config.ts reads
/// them, so nothing here imports the contracts workspace. Every value can be
/// overridden from the environment so a judge can repoint the API without
/// editing a file.
///
/// Secrets come from `process.env` and are never logged, copied or returned.

export interface AccountConfig {
  accountId: string;
  address: string;
}

export interface SeriesConfig {
  label: string;
  /** The bytes32 key the contracts take. */
  seriesId: string;
  groupKey: string;
  maturityAt: number;
}

export interface ApiConfig {
  network: string;
  chainId: number;
  rpcUrl: string;
  mirrorUrl: string;
  publicBaseUrl: string;
  coverPoolAddress: string;
  vaultAddress: string;
  settlementToken: { tokenId: string; address: string; decimals: number; symbol: string };
  policyNftTokenId: string;
  paymentsTopicId: string;
  indexTopicId: string;
  /**
   * The claims topic. The API reads it for the audit trail and never writes
   * it: its submit key is the adjuster's (docs/HEDERA.md, Topics).
   */
  claimsTopicId: string;
  series: SeriesConfig[];
  /** The account holding BINDER_ROLE and the payments topic submit key. */
  api: AccountConfig & { key: string | undefined };
  /**
   * The operator. It is here because the policy NFT collection's supply and
   * freeze keys are the operator's, not the api account's: see
   * docs/DECISIONS.md, "The policy NFT is minted and frozen with the operator
   * key".
   */
  operator: AccountConfig & { key: string | undefined };
  credentialTtlSeconds: number;
  quoteTtlSeconds: number;
  /** The World ID app this deployment runs its Selfie Check against. */
  world: WorldConfig;
  /** The defaults a new series row takes for the Adjuster's auto-approval gate. */
  autoApproval: { limit: string; confidence: number };
  /** Serve the labelled demo eligibility issuer. Replaced by T11's World path. */
  demoIssuer: boolean;
  databaseUrl: string | undefined;
}

const DEFAULT_RECORD = '../../../contracts/deployments/testnet.json';
const DEFAULT_RESOURCES = '../../../docs/hedera.testnet.json';

interface DeploymentFile {
  network?: string;
  chainId?: number;
  coverPool?: { address: string };
  collateralVault?: { address: string };
  series?: { id: string; label: string; group: string; maturityAt: number };
}

interface ResourcesFile {
  network?: string;
  accounts?: Record<string, { accountId: string; evmAddress: string }>;
  operator?: { accountId: string; evmAddress: string };
  settlementToken?: { tokenId: string; evmAddress: string; decimals: number; symbol: string };
  policyNft?: { tokenId: string };
  topics?: Record<string, { topicId: string }>;
}

function readJson<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

/**
 * A variable set to nothing is not set.
 *
 * The README tells a judge to copy the example environment and fill in the few
 * lines it names, so every other line arrives as `NAME=` and node reads it as
 * the empty string. `??` does not catch that, and an empty string here would
 * erase a default the deployment record or the resources file already carries:
 * a copied example alone stopped the API booting, because the path to the
 * deployment record came out as `''` rather than as the file next to this one.
 * Blank is absent, which is what makes a partly filled file behave like one.
 */
function fromEnv(name: string): string | undefined {
  const raw = process.env[name];
  return raw === undefined || raw.trim() === '' ? undefined : raw.trim();
}

function required(value: string | undefined, what: string): string {
  if (value === undefined || value === '') {
    throw new Error(`${what} is missing: set it in the environment or in the deployment record`);
  }
  return value;
}

/**
 * The api account's key.
 *
 * It is named in the example environment, but it does not have to be filled in:
 * every account in this build carries a key derived from the operator key with
 * HKDF-SHA256 and the label `creance/testnet/<role>`, so a clone that has the
 * operator key already has all of them and no derived secret is ever stored.
 * An explicit value wins, which is what a rotation would look like.
 */
function roleKey(role: string, explicit: string | undefined): string | undefined {
  if (explicit !== undefined && explicit.trim() !== '') return explicit.trim();
  const operator = process.env.HEDERA_OPERATOR_KEY;
  if (operator === undefined || operator.trim() === '') return undefined;
  try {
    return roleKeyHex(operator, role);
  } catch {
    return undefined;
  }
}

function seconds(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive whole number of seconds, got ${raw}`);
  }
  return value;
}

export function loadApiConfig(
  options: { recordPath?: string; resourcesPath?: string } = {},
): ApiConfig {
  const recordPath =
    options.recordPath ??
    fromEnv('CREANCE_DEPLOYMENT_RECORD') ??
    fileURLToPath(new URL(DEFAULT_RECORD, import.meta.url));
  const resourcesPath =
    options.resourcesPath ??
    fromEnv('CREANCE_HEDERA_RESOURCES') ??
    fileURLToPath(new URL(DEFAULT_RESOURCES, import.meta.url));

  const record = readJson<DeploymentFile>(recordPath);
  const resources = readJson<ResourcesFile>(resourcesPath);
  if (record === undefined) {
    throw new Error(`no deployment record at ${recordPath}: run pnpm contracts:deploy first`);
  }

  const network = record.network ?? resources?.network ?? 'testnet';
  if (network !== 'testnet') {
    throw new Error(`refusing to serve ${network}: this build is testnet only`);
  }

  const token = resources?.settlementToken;
  const series: SeriesConfig[] =
    record.series === undefined
      ? []
      : [
          {
            label: record.series.label,
            seriesId: fromEnv('HEDERA_SERIES_ID') ?? record.series.id,
            groupKey: record.series.group,
            maturityAt: record.series.maturityAt,
          },
        ];

  const apiAccount = resources?.accounts?.api;
  const operator = resources?.operator;

  return {
    network,
    chainId: record.chainId ?? 296,
    rpcUrl: fromEnv('HEDERA_RPC_URL') ?? 'https://testnet.hashio.io/api',
    mirrorUrl: fromEnv('HEDERA_MIRROR_URL') ?? 'https://testnet.mirrornode.hedera.com/api/v1',
    publicBaseUrl: (fromEnv('PUBLIC_SITE_URL') ?? 'http://localhost:3210').replace(/\/+$/, ''),
    coverPoolAddress: required(
      fromEnv('HEDERA_COVERPOOL_ADDRESS') ?? record.coverPool?.address,
      'the CoverPool address',
    ),
    vaultAddress: required(
      fromEnv('HEDERA_VAULT_ADDRESS') ?? record.collateralVault?.address,
      'the CollateralVault address',
    ),
    settlementToken: {
      tokenId: fromEnv('HEDERA_SETTLEMENT_TOKEN_ID') ?? token?.tokenId ?? '',
      address: token?.evmAddress ?? '',
      decimals: token?.decimals ?? 6,
      symbol: token?.symbol ?? 'TUSD',
    },
    policyNftTokenId: fromEnv('HEDERA_POLICY_NFT_ID') ?? resources?.policyNft?.tokenId ?? '',
    paymentsTopicId:
      fromEnv('HEDERA_TOPIC_PAYMENTS') ?? resources?.topics?.payments?.topicId ?? '',
    indexTopicId: fromEnv('HEDERA_TOPIC_INDEX') ?? resources?.topics?.index?.topicId ?? '',
    claimsTopicId: fromEnv('HEDERA_TOPIC_CLAIMS') ?? resources?.topics?.claims?.topicId ?? '',
    series,
    api: {
      accountId: fromEnv('HEDERA_API_ID') ?? apiAccount?.accountId ?? '',
      address: apiAccount?.evmAddress ?? '',
      key: roleKey('api', fromEnv('HEDERA_API_KEY')),
    },
    operator: {
      accountId: fromEnv('HEDERA_OPERATOR_ID') ?? operator?.accountId ?? '',
      address: operator?.evmAddress ?? '',
      key: fromEnv('HEDERA_OPERATOR_KEY'),
    },
    credentialTtlSeconds: seconds('CREDENTIAL_TTL_SECONDS', 1800),
    world: loadWorldConfig(),
    quoteTtlSeconds: seconds('QUOTE_TTL_SECONDS', 900),
    autoApproval: {
      limit: fromEnv('AUTO_APPROVAL_LIMIT') ?? '5000000000',
      confidence: Number(fromEnv('AUTO_APPROVAL_CONFIDENCE') ?? '0.9'),
    },
    demoIssuer: (fromEnv('DEMO_ELIGIBILITY_ISSUER') ?? 'true') !== 'false',
    databaseUrl: fromEnv('DATABASE_URL'),
  };
}

/** The series a request names, by label, group key or bytes32 key. */
export function findSeries(config: ApiConfig, id: string): SeriesConfig | undefined {
  const wanted = id.trim().toLowerCase();
  return config.series.find(
    (series) =>
      series.label.toLowerCase() === wanted ||
      series.seriesId.toLowerCase() === wanted ||
      series.groupKey.toLowerCase() === wanted,
  );
}

/** The single series offering cover for a group, or undefined when none does. */
export function seriesForGroup(config: ApiConfig, groupKey: string): SeriesConfig | undefined {
  return config.series.find((series) => series.groupKey === groupKey);
}
