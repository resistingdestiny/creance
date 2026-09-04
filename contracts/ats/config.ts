import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/// The Asset Tokenization Studio release this note is issued against. Release
/// 8.0.0 replaced the Equity and Bond monoliths with composable facets and
/// renamed every role, resolver key and storage slot, so nothing written for an
/// earlier release applies. The tag carries a dot after the v.
/// https://github.com/hashgraph/asset-tokenization-studio/releases/tag/v.8.0.0-ats
export const ATS_VERSION = '8.0.0';
export const ATS_TAG = 'v.8.0.0-ats';

/// The testnet factory and resolver the 8.0.0 web application ships in its own
/// example environment file, deployed twelve days before the release. The
/// deployed-addresses page in the same tree lists a different pair under the
/// heading "Smart Contract Version: 4.0.0"; that pair predates the release by
/// five months and its resolver cannot carry the 8.0.0 facet hashes. See
/// docs/harness-notes.md.
export const ATS = {
  resolverId: '0.0.9212226',
  resolver: '0xba2d5fc2083a0b8f164c50e65d782087fba18e0a',
  factoryId: '0.0.9213391',
  factory: '0xd1f118a40f3b02883d35909ef2517e7edd78379d',
  /// Configuration 1 is equity and 2 is bond. The version is read off the
  /// resolver at run time rather than pinned here, because a resolver upgrade
  /// changes it and a stale pin fails opaquely; the value actually used is
  /// written into the deployment record.
  bondConfigId: `0x${'00'.repeat(31)}02`,
} as const;

/// ATS holds every balance in one partition unless the security is created
/// multi-partition, and this one is not.
export const PARTITION_1 = `0x${'00'.repeat(31)}01`;

/// The note terms. Units times nominal value is the series principal of
/// 100,000, and 1,000 per unit is the ordinary corporate bond convention.
/// Decimals match the settlement token so the API never carries two scales.
export const NOTE = {
  name: 'Creance Displacement Bond Note ODI-COMP-2026-01',
  symbol: 'CDBN01',
  decimals: 6,
  units: 100n,
  nominalValue: 1_000n,
  /// bytes3, the ASCII of USD. The web application shows a fixed "USD" label
  /// and the SDK validates the field with checkBytes3Format, so the string
  /// "USD" is not what reaches the chain.
  currency: '0x555344',
  /// Regulation S, the international offering. RegulationType 1, subtype 0.
  /// The choice cannot be altered after deployment.
  regulationType: 1,
  regulationSubType: 0,
} as const;

/// The coupon DESIGN.md 3.4 sets for the demo series: 8 percent a year, paid
/// monthly. ATS stores a rate and its scale, so 8 percent is 8 at two decimals.
export const COUPON = {
  ratePercent: 8,
  rate: 8n,
  rateDecimals: 2,
  /// RateCalculationStatus.SET. PENDING is for the KPI linked and
  /// sustainability variants and the contract rejects the mix.
  rateStatusSet: 1,
} as const;

/// Explicit gas limits everywhere, for the reason contracts/scripts/deploy
/// gives: the relay's eth_estimateGas cannot price a call whose cost depends on
/// state it cannot see, and unused gas is refunded in full. The per transaction
/// cap is 15 million. The deploy figure is the SDK's own CREATE_BOND_ST.
export const GAS = {
  deployBond: 15_000_000,
  grantRole: 2_000_000,
  addIssuer: 1_500_000,
  grantKyc: 1_500_000,
  issue: 3_000_000,
  transfer: 1_500_000,
  pause: 1_500_000,
  freeze: 1_500_000,
  setCoupon: 3_000_000,
} as const;

/// Roles read from packages/ats/contracts/scripts/domain/atsRoles.generated.ts
/// at the tag. The keccak values changed in 8.0.0, so a constant copied from an
/// older article names a role that no longer exists.
export const ROLES = {
  ROLE_SSI_MANAGER: '0x3120494a82251fe85b0403877539486dbfcf0f94c20741a3229cfad31f625ee1',
  ROLE_KYC: '0x754f499f9fdfbb089d12bdec817a6863d593d8a3ea7f546c00a5cafd20957bfc',
  ROLE_ISSUER: '0x5eeaf5602c75bf26e73b5206d0bd6ee82f621166255e5fd73cc06bc7bd84a95f',
  ROLE_CORPORATE_ACTION: '0xa1acfc499025c99f55059195e6276f639d34a18aad7b8121b9192b7f438c55cd',
  ROLE_PAUSER: '0x3cb8b459fdb6e7dc3d2a2aa529e530f885d45e03584adb438423209c86a2731f',
  ROLE_FREEZE_MANAGER: '0x71ae38482e1ab1c28e767d64766d686215b490c8c1bd7dfe6b101525187c2155',
  ROLE_MATURITY_REDEEMER: '0x433f48f8aca23480f6ab07666cbc9131d32a0b4672033453f65e18f4dd390523',
  ROLE_MATURITY_MANAGER: '0xc20b7fd7efe1a2c9f69003a21c2c55c79ef84e16252b62599246ff01f6207314',
} as const;

export type RoleName = keyof typeof ROLES;

/// Everything the operator has to hold for the run through, in the order the
/// sequence needs it. ROLE_SSI_MANAGER has to land before the issuer is
/// registered and ROLE_KYC before the first grant.
export const OPERATOR_ROLES: RoleName[] = [
  'ROLE_SSI_MANAGER',
  'ROLE_KYC',
  'ROLE_ISSUER',
  'ROLE_CORPORATE_ACTION',
  'ROLE_PAUSER',
  'ROLE_FREEZE_MANAGER',
  'ROLE_MATURITY_REDEEMER',
  'ROLE_MATURITY_MANAGER',
];

export const MIRROR_URL =
  process.env.HEDERA_MIRROR_URL ?? 'https://testnet.mirrornode.hedera.com/api/v1';
export const RPC_URL = process.env.HEDERA_RPC_URL ?? 'https://testnet.hashio.io/api';
export const CHAIN_ID = 296;

export interface HederaResources {
  network: string;
  operator: { accountId: string; evmAddress: string };
  accounts: Record<string, { accountId: string; evmAddress: string }>;
  settlementToken: { tokenId: string; evmAddress: string; decimals: number; symbol: string };
}

export function readResources(): HederaResources {
  const path = fileURLToPath(new URL('../../docs/hedera.testnet.json', import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as HederaResources;
}
