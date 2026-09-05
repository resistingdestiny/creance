import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { roleKeyHex } from '@creance/client';

/// What the Steward needs to know before it can do anything.
///
/// The same two sources apps/api reads, in the same order: the environment
/// first, then the day 0 resources file docs/hedera.testnet.json, which carries
/// the account ids, the settlement token and the topics. Nothing here is a
/// secret except the key, and the key is derived rather than stored: every
/// account in this build carries an HKDF-SHA256 key over the operator key with
/// the label `creance/testnet/<role>`, so a clone with the operator key already
/// has the Steward's. An explicit HEDERA_STEWARD_KEY wins, which is what a
/// rotation looks like.

const DEFAULT_RESOURCES = '../../../docs/hedera.testnet.json';
const DEFAULT_PROFILE = '../profiles/policyholder-2.json';
const DEFAULT_STATE_DIR = '../../../var/steward';
const DEFAULT_API_URL = 'http://127.0.0.1:3210';
const DEFAULT_MIRROR_URL = 'https://testnet.mirrornode.hedera.com/api/v1';

interface ResourcesFile {
  network?: string;
  accounts?: Record<string, { accountId?: string; evmAddress?: string }>;
  settlementToken?: { tokenId?: string; decimals?: number; symbol?: string };
  topics?: Record<string, { topicId?: string }>;
}

export interface StewardConfig {
  network: string;
  apiUrl: string;
  mirrorUrl: string;
  steward: { accountId: string; privateKey: string };
  /** The account every premium is paid to: the same one the first premium settled to. */
  premiumAccountId: string;
  settlementToken: { tokenId: string; decimals: number; symbol: string };
  journalTopicId: string;
  profilePath: string;
  stateDir: string;
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

/** The steward key: explicit if set, otherwise derived from the operator key. */
function stewardKey(): string {
  const explicit = env('HEDERA_STEWARD_KEY');
  if (explicit !== undefined) return explicit;
  const operator = required(env('HEDERA_OPERATOR_KEY'), 'the operator key');
  return roleKeyHex(operator, 'steward');
}

export function loadStewardConfig(options: { profilePath?: string } = {}): StewardConfig {
  const resourcesPath = env('CREANCE_HEDERA_RESOURCES') ?? fromHere(DEFAULT_RESOURCES);
  const resources = readJson<ResourcesFile>(resourcesPath);
  const network = env('HEDERA_NETWORK') ?? resources?.network ?? 'testnet';
  if (network !== 'testnet') {
    throw new Error(`refusing to run against ${network}: this build is testnet only`);
  }

  return {
    network,
    apiUrl: (env('CREANCE_API_URL') ?? DEFAULT_API_URL).replace(/\/+$/, ''),
    mirrorUrl: (env('HEDERA_MIRROR_URL') ?? DEFAULT_MIRROR_URL).replace(/\/+$/, ''),
    steward: {
      accountId: required(
        env('HEDERA_STEWARD_ID') ?? resources?.accounts?.['steward']?.accountId,
        "the Steward's account id",
      ),
      privateKey: stewardKey(),
    },
    premiumAccountId: required(
      env('HEDERA_API_ID') ?? resources?.accounts?.['api']?.accountId,
      'the account premiums are paid to',
    ),
    settlementToken: {
      tokenId: required(
        env('HEDERA_SETTLEMENT_TOKEN_ID') ?? resources?.settlementToken?.tokenId,
        'the settlement token id',
      ),
      decimals: resources?.settlementToken?.decimals ?? 6,
      symbol: resources?.settlementToken?.symbol ?? 'TUSD',
    },
    journalTopicId: required(
      env('HEDERA_TOPIC_JOURNAL') ?? resources?.topics?.['agent-journal']?.topicId,
      'the agent journal topic',
    ),
    profilePath: options.profilePath ?? env('STEWARD_PROFILE') ?? fromHere(DEFAULT_PROFILE),
    stateDir: env('STEWARD_STATE') ?? fromHere(DEFAULT_STATE_DIR),
  };
}
