import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { roleKeyHex } from '@creance/client';

/// What the Adjuster needs before it can decide anything.
///
/// The same two sources apps/api and apps/steward read, in the same order: the
/// environment first, then the day 0 resources file docs/hedera.testnet.json,
/// which carries the account ids and the topics. The adjuster key is derived
/// rather than stored: every account in this build carries an HKDF-SHA256 key
/// over the operator key with the label `creance/testnet/<role>`, so a clone
/// with the operator key already has the Adjuster's. An explicit
/// HEDERA_ADJUSTER_KEY wins, which is what a rotation looks like.
///
/// Two secrets and no others: the admin token it authenticates to the API with,
/// and the model key. It never holds the CLAIMS key, never signs the
/// authorisation and never opens a database connection.

const DEFAULT_RESOURCES = '../../../docs/hedera.testnet.json';
const DEFAULT_API_URL = 'http://127.0.0.1:3210';

interface ResourcesFile {
  network?: string;
  accounts?: Record<string, { accountId?: string; evmAddress?: string }>;
  settlementToken?: { tokenId?: string; decimals?: number; symbol?: string };
  topics?: Record<string, { topicId?: string }>;
}

export interface AdjusterConfig {
  network: string;
  apiUrl: string;
  /**
   * The bearer token the queue is behind, when this deployment has one. It is
   * undefined rather than fatal here so that the testnet publish, which talks
   * only to the topic, runs without one. The pass asks for it and says which
   * name to set.
   */
  adminToken: string | undefined;
  adjuster: { accountId: string; privateKey: string };
  /** The claims topic, whose submit key is the adjuster account's. */
  claimsTopicId: string;
  settlementToken: { tokenId: string; decimals: number };
  model: { apiKey: string | undefined; id: string; effort: 'low' | 'medium' | 'high' };
}

function env(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value.trim() === '' ? undefined : value.trim();
}

function required(value: string | undefined, what: string): string {
  if (value === undefined) {
    throw new Error(`${what} is not configured. Fill it in from the example environment file.`);
  }
  return value;
}

function readJson<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

/** Explicit if set, otherwise derived from the operator key. */
function adjusterKey(): string {
  const explicit = env('HEDERA_ADJUSTER_KEY');
  if (explicit !== undefined) return explicit;
  const operator = required(env('HEDERA_OPERATOR_KEY'), 'the operator key');
  return roleKeyHex(operator, 'adjuster');
}

/** The admin token, or a refusal that names the variable to set. */
export function requireAdminToken(config: AdjusterConfig): string {
  return required(
    config.adminToken,
    "the Adjuster's admin token (ADJUSTER_ADMIN_TOKEN, or ADMIN_TOKEN)",
  );
}

export function loadAdjusterConfig(): AdjusterConfig {
  const resourcesPath =
    env('CREANCE_HEDERA_RESOURCES') ?? fileURLToPath(new URL(DEFAULT_RESOURCES, import.meta.url));
  const resources = readJson<ResourcesFile>(resourcesPath);
  const network = env('HEDERA_NETWORK') ?? resources?.network ?? 'testnet';
  if (network !== 'testnet') {
    throw new Error(`refusing to run against ${network}: this build is testnet only`);
  }

  const effort = (env('ADJUSTER_MODEL_EFFORT') ?? 'medium') as 'low' | 'medium' | 'high';
  if (!['low', 'medium', 'high'].includes(effort)) {
    throw new Error(`ADJUSTER_MODEL_EFFORT takes low, medium or high, got ${effort}`);
  }

  return {
    network,
    apiUrl: (env('CREANCE_API_URL') ?? DEFAULT_API_URL).replace(/\/+$/, ''),
    adminToken: env('ADJUSTER_ADMIN_TOKEN') ?? env('ADMIN_TOKEN'),
    adjuster: {
      accountId: required(
        env('HEDERA_ADJUSTER_ID') ?? resources?.accounts?.['adjuster']?.accountId,
        "the Adjuster's account id",
      ),
      privateKey: adjusterKey(),
    },
    claimsTopicId: required(
      env('HEDERA_TOPIC_CLAIMS') ?? resources?.topics?.['claims']?.topicId,
      'the claims topic',
    ),
    settlementToken: {
      tokenId: required(
        env('HEDERA_SETTLEMENT_TOKEN_ID') ?? resources?.settlementToken?.tokenId,
        'the settlement token id',
      ),
      decimals: resources?.settlementToken?.decimals ?? 6,
    },
    model: {
      apiKey: env('ANTHROPIC_API_KEY'),
      id: env('ADJUSTER_MODEL') ?? 'claude-opus-5',
      effort,
    },
  };
}
