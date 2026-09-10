import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/// Where the investor endpoints get their addresses.
///
/// The deployment record contracts/deployments/testnet.json is the machine
/// readable copy of what is on testnet, and it is read as a data file rather
/// than imported from the contracts workspace. Every value in it can be
/// overridden from the environment, so a judge can point the API at a different
/// deployment without editing anything.

export interface HolderConfig {
  role: string;
  accountId: string;
  address: string;
}

export interface CouponSettlementConfig {
  couponId: string;
  couponRef: string;
  ratePercent: number;
  recordDate: number;
  executionDate: number;
  startDate: number;
  endDate: number;
  holders: {
    role: string;
    accountId: string;
    address: string;
    numerator: string;
    denominator: string;
    amount: string;
    remainder: string;
    scheduleId?: string;
    scheduleMemo?: string;
    executedAt?: string;
    executedTransactionId?: string;
    result?: string;
    settled?: boolean;
    gasUsed?: number;
    topicSequenceNumber?: string;
  }[];
}

export interface SeriesConfig {
  label: string;
  seriesId: string;
  group: string;
  maturityAt: number;
  vault: { address: string; contractId?: string };
  coverPool?: { address: string; contractId?: string };
  note?: { address: string; contractId?: string };
  settlementToken: { tokenId: string; address: string; decimals: number; symbol: string };
  holders: HolderConfig[];
  coupons: CouponSettlementConfig[];
  paymentsTopicId?: string;
}

export interface InvestorConfig {
  network: string;
  rpcUrl: string;
  mirrorUrl: string;
  series: SeriesConfig[];
}

const DEFAULT_RECORD = '../../../../contracts/deployments/testnet.json';
const DEFAULT_RESOURCES = '../../../../docs/hedera.testnet.json';

interface DeploymentFile {
  network?: string;
  collateralVault?: { address: string; contractId?: string };
  coverPool?: { address: string; contractId?: string };
  settlementToken?: { tokenId: string; evmAddress: string };
  testnetRunthrough?: unknown;
  maturityDemo?: {
    label: string;
    seriesId: string;
    maturityAt: number;
    note?: { address: string; contractId?: string };
  };
  series?: SeriesFile[];
}

interface SeriesFile {
  id: string;
  label: string;
  group: string;
  maturityAt: number;
  ats?: { note?: { address: string; contractId?: string } };
  couponSettlements?: Record<string, CouponSettlementConfig>;
  subscriptions?: { role: string }[];
}

interface ResourcesFile {
  network?: string;
  operator?: { accountId: string; evmAddress: string };
  accounts?: Record<string, { accountId: string; evmAddress: string }>;
  settlementToken?: { tokenId: string; evmAddress: string; decimals: number; symbol: string };
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
 * The noteholders a series has, in the order they were issued to.
 *
 * The demo series was issued to the two investor accounts. Every series the
 * capacity runner opened is seeded by the operator, which is the account whose
 * settlement tokens are in the vault, so the record's own subscription roles
 * are what decides. The fallback is the demo pair, for a record written before
 * the subscriptions were on it.
 */
const DEMO_HOLDER_ROLES = ['investor-1', 'investor-2'];

function holdersFor(series: SeriesFile, resources: ResourcesFile | undefined): HolderConfig[] {
  const roles = series.subscriptions?.map((subscription) => subscription.role) ?? [];
  const wanted = roles.length > 0 ? [...new Set(roles)] : DEMO_HOLDER_ROLES;
  return wanted.flatMap((role) => {
    const account = role === 'operator' ? resources?.operator : resources?.accounts?.[role];
    return account === undefined
      ? []
      : [{ role, accountId: account.accountId, address: account.evmAddress }];
  });
}

/**
 * A variable set to nothing is not set. The same reader as apps/api/src/config.ts,
 * for the same reason: a copied example environment arrives with every line it
 * documents present and blank, and `??` reads a blank as a value.
 */
function fromEnv(name: string): string | undefined {
  const raw = process.env[name];
  return raw === undefined || raw.trim() === '' ? undefined : raw.trim();
}

/**
 * Build the configuration from the deployment record and the day 0 resources.
 *
 * Both paths can be overridden, which is what the tests use, and every field
 * that a judge might need to repoint has an environment name.
 */
export function loadInvestorConfig(options: { recordPath?: string; resourcesPath?: string } = {}): InvestorConfig {
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

  const vaultAddress = fromEnv('HEDERA_VAULT_ADDRESS') ?? record.collateralVault?.address;
  if (vaultAddress === undefined) {
    throw new Error('no CollateralVault address in the deployment record or the environment');
  }
  const vault = {
    address: vaultAddress,
    ...(record.collateralVault?.contractId === undefined
      ? {}
      : { contractId: record.collateralVault.contractId }),
  };

  // The pool is optional. Its two fields, active exposure and the term, are the
  // only things on the investor view that degrade to null without it, so a
  // deployment record written before the pool existed still serves.
  // `HEDERA_COVERPOOL_ADDRESS` is the documented name and the one
  // apps/api/src/config.ts reads, so setting it has to repoint both halves of
  // the same process. The older spelling is still accepted.
  const coverPoolAddress =
    fromEnv('HEDERA_COVERPOOL_ADDRESS') ??
    fromEnv('HEDERA_COVER_POOL_ADDRESS') ??
    record.coverPool?.address;
  const coverPool =
    coverPoolAddress === undefined
      ? undefined
      : {
          address: coverPoolAddress,
          ...(record.coverPool?.contractId === undefined
            ? {}
            : { contractId: record.coverPool.contractId }),
        };

  const token = resources?.settlementToken;
  const settlementToken = {
    tokenId: token?.tokenId ?? '',
    address: token?.evmAddress ?? record.settlementToken?.evmAddress ?? '',
    decimals: token?.decimals ?? 6,
    symbol: token?.symbol ?? 'TUSD',
  };

  const recorded = record.series ?? [];
  // `ATS_NOTE_ADDRESS` repoints the demo series' note, which is the head of
  // the record. It predates the record carrying more than one series and it
  // has never named which one it meant.
  const noteOverride = fromEnv('ATS_NOTE_ADDRESS');
  const series: SeriesConfig[] = recorded.map((entry, index) => {
    const noteAddress = (index === 0 ? noteOverride : undefined) ?? entry.ats?.note?.address;
    const contractId = entry.ats?.note?.contractId;
    return {
      label: entry.label,
      seriesId: entry.id,
      group: entry.group,
      maturityAt: entry.maturityAt,
      vault,
      ...(coverPool === undefined ? {} : { coverPool }),
      ...(noteAddress === undefined
        ? {}
        : {
            note: {
              address: noteAddress,
              ...(contractId === undefined ? {} : { contractId }),
            },
          }),
      settlementToken,
      holders: holdersFor(entry, resources),
      coupons: Object.values(entry.couponSettlements ?? {}),
      ...(resources?.topics?.payments?.topicId === undefined
        ? {}
        : { paymentsTopicId: resources.topics.payments.topicId }),
    };
  });
  // The short dated maturity demonstration is served too, so the redemption can
  // be read through the same endpoint as the coupon. It is a demonstration and
  // its label says so; nothing derives the demo series from it.
  if (record.maturityDemo !== undefined) {
    series.push({
      label: record.maturityDemo.label,
      seriesId: record.maturityDemo.seriesId,
      group: recorded[0]?.group ?? '',
      maturityAt: record.maturityDemo.maturityAt,
      vault,
      ...(coverPool === undefined ? {} : { coverPool }),
      ...(record.maturityDemo.note === undefined ? {} : { note: record.maturityDemo.note }),
      settlementToken,
      holders: holdersFor({ id: '', label: '', group: '', maturityAt: 0 }, resources),
      coupons: [],
    });
  }

  return {
    network,
    rpcUrl:
      fromEnv('HEDERA_RPC_URL') ??
      fromEnv('HEDERA_JSON_RPC') ??
      'https://testnet.hashio.io/api',
    mirrorUrl:
      fromEnv('HEDERA_MIRROR_URL') ??
      fromEnv('HEDERA_MIRROR') ??
      'https://testnet.mirrornode.hedera.com/api/v1',
    series,
  };
}

/** The series a request names, by label or by its bytes32 key. Case insensitive. */
export function findSeries(config: InvestorConfig, id: string): SeriesConfig | undefined {
  const wanted = id.trim().toLowerCase();
  return config.series.find(
    (series) => series.label.toLowerCase() === wanted || series.seriesId.toLowerCase() === wanted,
  );
}
