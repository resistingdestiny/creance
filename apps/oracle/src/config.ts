import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Where the oracle gets its addresses.
 *
 * contracts/deployments/testnet.json is the machine readable copy of what is on
 * testnet and it is read as a data file, the way apps/api/src/investor/config.ts
 * reads it, rather than imported from the contracts workspace. Every value can
 * be overridden from the environment so a judge can point the worker at a
 * different deployment without editing anything.
 *
 * No secret is stored here. The signing key is fetched separately, in keys.ts,
 * at the moment it is used.
 */

/** A cover series the oracle can submit observations for. */
export interface OracleSeries {
  /** ASCII label, `ODI-COMP-2026-01`. */
  label: string;
  /** The same label right padded into bytes32, as the contract holds it. */
  seriesId: string;
  /** The index group the series settles against, `computer_math`. */
  groupKey: string;
}

export interface OracleConfig {
  network: string;
  rpcUrl: string;
  mirrorUrl: string;
  /** The index topic, in 0.0.x form. */
  topicId: string;
  /** The oracle account, in 0.0.x form. It pays for the topic message. */
  accountId: string;
  coverPoolAddress: string;
  vaultAddress: string;
  /**
   * Explicit because `eth_estimateGas` cannot price a call that reaches the
   * token service. An opening month measured 271,024; unused gas is refunded in
   * full, so a generous limit is free.
   */
  submitGasLimit: number;
  statePath: string;
  observationsPath: string;
  /** Every registered cover series, in deployment record order. */
  series: OracleSeries[];
}

const DEFAULT_RECORD = '../../../contracts/deployments/testnet.json';
const DEFAULT_STATE = '../../../var/oracle/replay-state.json';
const DEFAULT_OBSERVATIONS = '../../../var/oracle/observations.json';

interface DeploymentFile {
  network?: string;
  collateralVault?: { address: string };
  coverPool?: { address: string };
  series?: { id: string; label: string; group: string };
}

function fromHere(relative: string): string {
  return fileURLToPath(new URL(relative, import.meta.url));
}

function readJson<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

function required(value: string | undefined, name: string): string {
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed.length === 0) {
    throw new Error(`${name} is not set: copy .env.example and fill it in`);
  }
  return trimmed;
}

export interface LoadOptions {
  recordPath?: string;
  environment?: NodeJS.ProcessEnv;
}

export function loadOracleConfig(options: LoadOptions = {}): OracleConfig {
  const vars = options.environment ?? process.env;
  const recordPath =
    options.recordPath ?? vars.CREANCE_DEPLOYMENT_RECORD ?? fromHere(DEFAULT_RECORD);
  const record = readJson<DeploymentFile>(recordPath);
  if (record === undefined) {
    throw new Error(`no deployment record at ${recordPath}: run pnpm contracts:deploy first`);
  }

  const network = record.network ?? vars.HEDERA_NETWORK ?? 'testnet';
  if (network !== 'testnet') {
    throw new Error(`refusing to run against ${network}: this build is testnet only`);
  }

  const series: OracleSeries[] = [];
  if (record.series !== undefined) {
    series.push({
      label: record.series.label,
      seriesId: vars.HEDERA_SERIES_ID?.trim() || record.series.id,
      groupKey: record.series.group,
    });
  }

  return {
    network,
    rpcUrl: vars.HEDERA_RPC_URL?.trim() || 'https://testnet.hashio.io/api',
    mirrorUrl: vars.HEDERA_MIRROR_URL?.trim() || 'https://testnet.mirrornode.hedera.com/api/v1',
    topicId: required(vars.HEDERA_TOPIC_INDEX, 'HEDERA_TOPIC_INDEX'),
    accountId: required(vars.HEDERA_ORACLE_ID, 'HEDERA_ORACLE_ID'),
    coverPoolAddress: required(
      vars.HEDERA_COVERPOOL_ADDRESS ?? record.coverPool?.address,
      'HEDERA_COVERPOOL_ADDRESS',
    ),
    vaultAddress: required(
      vars.HEDERA_VAULT_ADDRESS ?? record.collateralVault?.address,
      'HEDERA_VAULT_ADDRESS',
    ),
    submitGasLimit: Number(vars.ORACLE_SUBMIT_GAS_LIMIT ?? 1_000_000),
    statePath: resolve(vars.ORACLE_STATE_PATH?.trim() || fromHere(DEFAULT_STATE)),
    observationsPath: resolve(
      vars.ORACLE_OBSERVATIONS_PATH?.trim() || fromHere(DEFAULT_OBSERVATIONS),
    ),
    series,
  };
}

/** The cover series for a group, or undefined when the group has none. */
export function seriesForGroup(config: OracleConfig, groupKey: string): OracleSeries | undefined {
  return config.series.find((entry) => entry.groupKey === groupKey);
}

/** The cover series a command named, by label or by its bytes32 key. */
export function findSeries(config: OracleConfig, id: string): OracleSeries | undefined {
  const wanted = id.trim().toLowerCase();
  return config.series.find(
    (entry) => entry.label.toLowerCase() === wanted || entry.seriesId.toLowerCase() === wanted,
  );
}
