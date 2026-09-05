import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/// The demo series, frozen at issuance. The shock attachment and the level line
/// come from the published calibration for the detailed BLS group "computer and
/// mathematical" and are scaled by 1e4, so 2.0 points is 20000 and -0.68 points
/// is -6800. A negative level line is real, and it is the form that opens the
/// demo window.
export const SERIES_LABEL = 'ODI-COMP-2026-01';
export const GROUP_LABEL = 'computer_math';
export const ATTACHMENT_SHOCK = 20_000n;
export const LEVEL_LINE = -6_800n;
export const EXHAUSTION_SHOCK = 40_000n;

const DAY = 24 * 60 * 60;

export const SERIES_TERMS = {
  payoutMode: 0, // Full: proof of loss makes the payout an indemnity.
  waitingPeriod: 60 * DAY,
  term: 365 * DAY,
  gracePeriod: 15 * DAY,
  claimWindowFromObservation: 30 * DAY,
  claimWindowFromSeparation: 60 * DAY,
  lookbackMonths: 2,
};

/// Explicit gas limits everywhere. The relay's eth_estimateGas cannot see the
/// state dependent cost of a token service call, and unused gas is refunded in
/// full, so a generous limit costs nothing. The per transaction cap is 15
/// million.
/// https://docs.hedera.com/hedera/tutorials/smart-contracts/deploy-a-smart-contract-using-hardhat
export const GAS = {
  deployVault: 4_000_000,
  deployPool: 6_000_000,
  associate: 2_000_000,
  grantRole: 300_000,
  openSeries: 300_000,
  registerSeries: 600_000,
  setCoverPool: 200_000,
};

export interface HederaResources {
  network: string;
  operator: { accountId: string; evmAddress: string };
  accounts: Record<string, { accountId: string; evmAddress: string }>;
  settlementToken: { tokenId: string; evmAddress: string; decimals: number; symbol: string };
}

export function readResources(): HederaResources {
  const path = fileURLToPath(new URL('../../../docs/hedera.testnet.json', import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as HederaResources;
}

export const MIRROR_URL =
  process.env.HEDERA_MIRROR_URL ?? 'https://testnet.mirrornode.hedera.com/api/v1';

export const RPC_URL = process.env.HEDERA_RPC_URL ?? 'https://testnet.hashio.io/api';

export const CHAIN_ID = 296;

/// A long-zero address is an entity number left padded to twenty bytes. Token
/// ids always take that form; an account created from an ECDSA public key never
/// does, and only the second kind can pass an ECRECOVER check.
export function isLongZero(address: string): boolean {
  return address.toLowerCase().startsWith('0x000000000000000000000000');
}
