import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  roles?: Record<string, string>;
  series?: SeriesRecord;
  verification?: Record<string, string>;
  gasUsed?: Record<string, number>;
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
