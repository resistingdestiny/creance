import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AtsRecord } from '../../ats/record.js';
import type { SecondaryMarketRecord } from '../../market/record.js';
import type {
  CouponSettlementRecord,
  MaturityDemoRecord,
  SubscriptionRecord,
} from '../../coupons/record.js';

/// The deployment record. Every step reads it, does only what is missing and
/// writes it back, so a relay timeout half way through is recovered by running
/// the same command again. T07 and T12 read the addresses from here rather than
/// parsing markdown.
export interface DeploymentRecord {
  network: string;
  chainId: number;
  settlementToken?: { tokenId: string; evmAddress: string };
  collateralVault?: ContractRecord;
  coverPool?: ContractRecord;
  coverPoolWired?: boolean;
  settlementTokenAssociated?: boolean;
  associationTx?: string;
  roles?: Record<string, string>;
  /// Every series opened in the vault and registered on the pool, in the order
  /// they were issued. The demo series ODI-COMP-2026-01 is the first entry and
  /// stays first, because the API's own series list is built from this one and
  /// the testnet scripts default to its head.
  series?: SeriesRecord[];
  verification?: Record<string, string>;
  gasUsed?: Record<string, number>;
  testnetRunthrough?: { series: string; at: string; links: Record<string, string> };
  /// The short dated series T14 opened to reach maturity inside the event. It
  /// is not the demo series and nothing else reads it.
  maturityDemo?: MaturityDemoRecord;
  /// The short window series T24 opened so that a claim window can close on
  /// camera. The demo series' window runs to 5 October, past the event. Not the
  /// demo series, and nothing else reads it.
  demoRelease?: DemoReleaseRecord;
  /// The NoteMarket venue and every trade settled on it. One venue serves every
  /// note, so it sits here rather than under a series.
  secondaryMarket?: SecondaryMarketRecord;
}

/// What `pnpm --filter @creance/contracts demo:release` proved on testnet.
export interface DemoReleaseRecord {
  series: string;
  at: string;
  windowSeconds: number;
  principalFunded: string;
  principalRemaining: string;
  reservedOnOpen: string;
  released: string;
  links: Record<string, string>;
}

export interface ContractRecord {
  address: string;
  contractId?: string;
  deploymentTx: string;
  gasUsed: number;
  constructorArgs: string[];
}

export interface SeriesRecord {
  id: string;
  label: string;
  group: string;
  attachmentShock: string;
  levelLine: string;
  exhaustionShock: string;
  payoutMode: string;
  maturityAt: number;
  openSeriesTx?: string;
  registerSeriesTx?: string;
  /// The note issued for this series through the Asset Tokenization Studio,
  /// written by `pnpm ats:issue`. The vault's own atsToken field is zero in
  /// this deployment, so this is where the note address is read from.
  ats?: AtsRecord;
  /// One entry per settled ATS coupon, keyed by the coupon id. Written by
  /// `pnpm coupons:pay`, read by the investor endpoints.
  couponSettlements?: Record<string, CouponSettlementRecord>;
  /// What each noteholder has subscribed in the vault, so the principal the
  /// note reports and the principal the vault holds can be compared.
  subscriptions?: SubscriptionRecord[];
  /// Why this series has no note. The ATS deploy is the heaviest call in the
  /// system and it must not gate the cover, so a failure is written here and
  /// the series stays buyable rather than the run stopping. Removed as soon as
  /// a later run issues the note.
  noteFailure?: { at: string; reason: string };
}

const RECORD_PATH = fileURLToPath(new URL('../../deployments/testnet.json', import.meta.url));

export function readRecord(): DeploymentRecord {
  try {
    return JSON.parse(readFileSync(RECORD_PATH, 'utf8')) as DeploymentRecord;
  } catch {
    return { network: 'testnet', chainId: 296 };
  }
}

export function writeRecord(record: DeploymentRecord): void {
  mkdirSync(dirname(RECORD_PATH), { recursive: true });
  writeFileSync(RECORD_PATH, `${JSON.stringify(record, null, 2)}\n`);
}

export function recordPath(): string {
  return RECORD_PATH;
}

/// The series in the record, or an empty list before the first deploy. Every
/// reader goes through this rather than touching the optional field, so a
/// record written before the field became a list still reads.
export function seriesList(record: DeploymentRecord): SeriesRecord[] {
  return record.series ?? [];
}

/// The series a caller named, by label, group key or bytes32 id. The three
/// spellings are accepted because a command line argument is a label, a
/// catalogue entry is a group key and the chain only knows the id.
export function findSeries(record: DeploymentRecord, id: string): SeriesRecord | undefined {
  const wanted = id.trim().toLowerCase();
  return seriesList(record).find(
    (series) =>
      series.label.toLowerCase() === wanted ||
      series.group.toLowerCase() === wanted ||
      series.id.toLowerCase() === wanted,
  );
}

/// The first series in the record. It is the demo series, and it is what a
/// command with no series argument acts on, so `pnpm ats:issue` and the coupon
/// scripts keep doing exactly what they did when the record held one object.
export function defaultSeries(record: DeploymentRecord): SeriesRecord | undefined {
  return seriesList(record)[0];
}

/// Write a series into the record, replacing the entry with the same label and
/// otherwise appending. The runner calls this the moment a series completes, so
/// an interrupted run leaves every finished series on disk.
export function upsertSeries(record: DeploymentRecord, series: SeriesRecord): void {
  const list = seriesList(record);
  const index = list.findIndex((entry) => entry.label === series.label);
  if (index === -1) list.push(series);
  else list[index] = series;
  record.series = list;
}
