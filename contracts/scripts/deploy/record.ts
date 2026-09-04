import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AtsRecord } from '../../ats/record.js';
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
  series?: SeriesRecord;
  verification?: Record<string, string>;
  gasUsed?: Record<string, number>;
  testnetRunthrough?: { series: string; at: string; links: Record<string, string> };
  /// The short dated series T14 opened to reach maturity inside the event. It
  /// is not the demo series and nothing else reads it.
  maturityDemo?: MaturityDemoRecord;
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
