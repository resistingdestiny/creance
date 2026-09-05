// Pure helpers for the day 0 Hedera setup. Nothing here touches the network, so
// the unit suite can cover all of it and `pnpm test` stays offline.
import { hkdfSync } from 'node:crypto';
import { PrivateKey } from '@hiero-ledger/sdk';

// Order of the secp256k1 group. A private key must be in [1, n-1], so a derived
// 32 byte string outside that range has to be rejected and re-derived.
const SECP256K1_ORDER = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

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

/**
 * Accept the raw 32 byte hex form of an ECDSA key with or without the 0x
 * prefix and return it lowercase without the prefix. Anything else throws,
 * because a DER encoded key silently produces a different account.
 */
export function normaliseRawKeyHex(raw: string): string {
  const trimmed = raw.trim();
  const hex = trimmed.startsWith('0x') || trimmed.startsWith('0X') ? trimmed.slice(2) : trimmed;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('expected a raw 32 byte hex ECDSA private key, 64 hex characters');
  }
  return hex.toLowerCase();
}

/**
 * Derive a role key from the operator key with HKDF-SHA256. The label is the
 * only input that varies, so the same operator key always yields the same ten
 * accounts and a re-run recovers them without storing a single new secret.
 * Testnet only: every derived key is exactly as secret as the operator key.
 */
export function deriveRoleKeyHex(operatorKeyHex: string, label: string): string {
  const ikm = Buffer.from(normaliseRawKeyHex(operatorKeyHex), 'hex');
  for (let counter = 0; counter < 256; counter += 1) {
    const info = counter === 0 ? label : `${label}#${counter}`;
    const out = Buffer.from(hkdfSync('sha256', ikm, Buffer.alloc(0), info, 32));
    const scalar = BigInt(`0x${out.toString('hex')}`);
    if (scalar > 0n && scalar < SECP256K1_ORDER) {
      return out.toString('hex');
    }
  }
  throw new Error(`no valid secp256k1 scalar derived for ${label}`);
}

/** The HKDF label for a role. Kept in one place so nobody re-spells it. */
export function labelForRole(role: string): string {
  return `creance/testnet/${role}`;
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
