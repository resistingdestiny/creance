// Pure helpers for the day 0 Hedera setup. Nothing here touches the network, so
// the unit suite can cover all of it and `pnpm test` stays offline.
import { PrivateKey } from '@hiero-ledger/sdk';
import { deriveRoleKeyHex, labelForRole, normaliseRawKeyHex } from '@creance/client';

// The HKDF derivation itself lives in packages/client, because apps/api needs
// it too and an import from this workspace would pull Hardhat into the API's
// dependency graph. One implementation, re-exported here so that nothing which
// already reads it from this module has to move.
export { deriveRoleKeyHex, labelForRole, normaliseRawKeyHex };

/** The roles this build creates from the operator account, in creation order. */
export const ACCOUNT_ROLES = [
  'oracle',
  'api',
  'steward',
  'adjuster',
  'policyholder-1',
  'policyholder-2',
  'policyholder-3',
  'investor-1',
  'investor-2',
] as const;

export type AccountRole = (typeof ACCOUNT_ROLES)[number];

/**
 * Initial HBAR balance per role. The split comes from a 100 HBAR operator: the
 * oracle and the api pay for a message and a contract call per period, the
 * steward for the premium schedule, and the rest only ever receive.
 */
export const ROLE_FUNDING_HBAR: Record<AccountRole, number> = {
  oracle: 15,
  api: 15,
  steward: 10,
  adjuster: 5,
  'policyholder-1': 5,
  'policyholder-2': 5,
  'policyholder-3': 5,
  'investor-1': 5,
  'investor-2': 5,
};

/** The .env names later tickets read, one per role. */
export function envNamesForRole(role: AccountRole): { id: string; key: string } {
  const stem = role.toUpperCase().replace(/-/g, '_');
  return { id: `HEDERA_${stem}_ID`, key: `HEDERA_${stem}_KEY` };
}

/** Derive the role key and return it as an SDK key. */
export function roleKey(operatorKeyHex: string, role: string): PrivateKey {
  return PrivateKey.fromStringECDSA(deriveRoleKeyHex(operatorKeyHex, labelForRole(role)));
}

/**
 * The EVM address an ECDSA key gets at account creation: keccak-256 of the
 * public key, rightmost 20 bytes. Not the long-zero form.
 */
export function evmAddressFromKey(key: PrivateKey): string {
  return `0x${key.publicKey.toEvmAddress().toLowerCase()}`;
}

/**
 * True when the address is the entity number padded to 20 bytes. A long-zero
 * account cannot pass an ECRECOVER check, which is how CoverPool authorises a
 * claim payment, so every account this script creates must fail this test.
 * https://docs.hedera.com/hedera/core-concepts/accounts/account-properties
 */
export function isLongZeroAddress(address: string): boolean {
  return /^0x0{24}[0-9a-fA-F]{16}$/.test(address.trim().toLowerCase());
}

/**
 * Long-zero EVM address of a 0.0.x entity. Tokens and topics only ever have
 * this form, and it is what a Solidity call to the HTS system contract takes.
 */
export function entityIdToEvmAddress(entityId: string): string {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(entityId.trim());
  if (!match) {
    throw new Error(`expected a shard.realm.number entity id, got ${entityId}`);
  }
  const num = BigInt(match[3] as string);
  if (num < 0n || num > 0xffffffffffffffffn) {
    throw new Error(`entity number out of range in ${entityId}`);
  }
  return `0x${num.toString(16).padStart(40, '0')}`;
}

/**
 * The SDK prints a transaction id as `0.0.x@seconds.nanos`. The mirror node and
 * HashScan both want `0.0.x-seconds-nanos`.
 */
export function toMirrorTransactionId(sdkTransactionId: string): string {
  const match = /^(\d+\.\d+\.\d+)@(\d+)\.(\d+)$/.exec(sdkTransactionId.trim());
  if (!match) {
    throw new Error(`expected a shard.realm.number@seconds.nanos id, got ${sdkTransactionId}`);
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
}

export type HashscanKind = 'account' | 'token' | 'topic' | 'transaction' | 'contract';

/** Explorer link for anything this script creates. */
export function hashscanUrl(kind: HashscanKind, id: string): string {
  return `https://hashscan.io/testnet/${kind}/${id}`;
}

/**
 * Amounts are always integers in the smallest unit. 28.00 TUSD at 6 decimals
 * is 28000000, and nothing in the SDK divides by 10^decimals for you.
 */
export function toMinorUnits(whole: number | bigint, decimals: number): bigint {
  return BigInt(whole) * 10n ** BigInt(decimals);
}

/** Format minor units back to a human string, for the markdown table only. */
export function fromMinorUnits(minor: bigint, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  const whole = minor / scale;
  const rest = (minor % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  return rest.length > 0 ? `${whole}.${rest}` : whole.toString();
}
