import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { loadInvestorConfig, type InvestorConfig, type SeriesConfig } from '../investor/config.js';

/// Where the market endpoints get their addresses and their signing accounts.
///
/// The venue and the notes are two different reads of the same deployment
/// record: `secondaryMarket.market` is the NoteMarket, and the note each offer
/// names is one of the series the investor endpoints already serve. Rather than
/// repeat that mapping, this builds on `loadInvestorConfig` and adds the venue.

export interface MarketVenue {
  address: string;
  contractId?: string;
}

export interface MarketAccount {
  role: string;
  accountId: string;
  address: string;
}

export interface MarketConfig {
  network: string;
  rpcUrl: string;
  venue: MarketVenue | null;
  series: SeriesConfig[];
  settlementToken: SeriesConfig['settlementToken'];
  /// Every account the API can sign as, by role. The keys are not here: they
  /// are derived at the point of use from the operator key, and nothing stores
  /// a derived secret.
  accounts: MarketAccount[];
}

const DEFAULT_RECORD = '../../../../contracts/deployments/testnet.json';
const DEFAULT_RESOURCES = '../../../../docs/hedera.testnet.json';

interface DeploymentFile {
  secondaryMarket?: { market?: { address: string; contractId?: string } };
}

interface ResourcesFile {
  operator?: { accountId: string; evmAddress: string };
  accounts?: Record<string, { accountId: string; evmAddress: string }>;
}

function readJson<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

function fromEnv(name: string): string | undefined {
  const raw = process.env[name];
  return raw === undefined || raw.trim() === '' ? undefined : raw.trim();
}

/**
 * The market configuration, from the deployment record and the day 0 resources.
 *
 * `venue` is null on a deployment where the market has not been deployed. The
 * read routes then answer an empty book rather than an error, because a venue
 * that exists nowhere has no offers, and the write routes refuse.
 */
export function loadMarketConfig(
  options: { recordPath?: string; resourcesPath?: string; investor?: InvestorConfig } = {},
): MarketConfig {
  const recordPath =
    options.recordPath ??
    fromEnv('CREANCE_DEPLOYMENT_RECORD') ??
    fileURLToPath(new URL(DEFAULT_RECORD, import.meta.url));
  const resourcesPath =
    options.resourcesPath ??
    fromEnv('CREANCE_HEDERA_RESOURCES') ??
    fileURLToPath(new URL(DEFAULT_RESOURCES, import.meta.url));

  const investor =
    options.investor ??
    loadInvestorConfig({
      ...(options.recordPath === undefined ? {} : { recordPath: options.recordPath }),
      ...(options.resourcesPath === undefined ? {} : { resourcesPath: options.resourcesPath }),
    });
  const record = readJson<DeploymentFile>(recordPath);
  const resources = readJson<ResourcesFile>(resourcesPath);

  const recorded = record?.secondaryMarket?.market;
  const address = fromEnv('HEDERA_NOTE_MARKET_ADDRESS') ?? recorded?.address;
  const venue: MarketVenue | null =
    address === undefined
      ? null
      : {
          address,
          ...(recorded?.contractId === undefined ? {} : { contractId: recorded.contractId }),
        };

  const accounts: MarketAccount[] = [];
  if (resources?.operator !== undefined) {
    accounts.push({
      role: 'operator',
      accountId: resources.operator.accountId,
      address: resources.operator.evmAddress,
    });
  }
  for (const [role, account] of Object.entries(resources?.accounts ?? {})) {
    accounts.push({ role, accountId: account.accountId, address: account.evmAddress });
  }

  return {
    network: investor.network,
    rpcUrl: investor.rpcUrl,
    venue,
    series: investor.series,
    settlementToken:
      investor.series[0]?.settlementToken ??
      ({ tokenId: '', address: '', decimals: 6, symbol: 'TUSD' } as SeriesConfig['settlementToken']),
    accounts,
  };
}

/** The series a note address belongs to, or undefined for one this API does not serve. */
export function seriesForNote(config: MarketConfig, note: string): SeriesConfig | undefined {
  const wanted = note.trim().toLowerCase();
  return config.series.find((series) => series.note?.address.toLowerCase() === wanted);
}

/** The series a request names, by label, bytes32 id or occupation group. */
export function findMarketSeries(config: MarketConfig, id: string): SeriesConfig | undefined {
  const wanted = id.trim().toLowerCase();
  return config.series.find(
    (series) =>
      series.label.toLowerCase() === wanted ||
      series.seriesId.toLowerCase() === wanted ||
      series.group.toLowerCase() === wanted,
  );
}

/**
 * The account a request names, by role, account id or EVM address.
 *
 * A role is the spelling the write routes take, because the API can only sign
 * for an account whose key it derives, and the roles are exactly those. The
 * other two spellings are accepted on reads, where anybody's address is fair.
 */
export function findAccount(config: MarketConfig, id: string): MarketAccount | undefined {
  const wanted = id.trim().toLowerCase();
  return config.accounts.find(
    (account) =>
      account.role.toLowerCase() === wanted ||
      account.accountId.toLowerCase() === wanted ||
      account.address.toLowerCase() === wanted,
  );
}
