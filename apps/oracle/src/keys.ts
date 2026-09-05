import { hkdfSync } from 'node:crypto';

/**
 * The oracle's own key handling.
 *
 * `HEDERA_ORACLE_KEY` is the normal path: `pnpm hedera:setup` prints it and a
 * judge pastes it into the environment file. The derivation below is the
 * fallback for a clone that has only the operator key, and it is a copy of the
 * HKDF loop the setup script uses rather than an import: the contracts
 * workspace pulls Hardhat and its plugins into whatever imports it, and the
 * oracle has no business carrying a compiler.
 *
 * Testnet only. Every derived key is exactly as secret as the operator key.
 */

// Order of the secp256k1 group. A private key must be in [1, n-1], so a derived
// 32 byte string outside that range has to be rejected and re-derived.
const SECP256K1_ORDER = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

/**
 * Accept the raw 32 byte hex form of an ECDSA key with or without the 0x
 * prefix and return it lowercase without the prefix. Anything else throws,
 * because a DER encoded key silently produces a different address.
 */
export function normaliseRawKeyHex(raw: string): string {
  const trimmed = raw.trim();
  const hex = trimmed.startsWith('0x') || trimmed.startsWith('0X') ? trimmed.slice(2) : trimmed;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('expected a raw 32 byte hex ECDSA private key, 64 hex characters');
  }
  return hex.toLowerCase();
}

/** The HKDF label for a role. Kept in one place so nobody re-spells it. */
export function labelForRole(role: string): string {
  return `creance/testnet/${role}`;
}

/** Derive a role key from the operator key with HKDF-SHA256, empty salt. */
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

/**
 * The oracle signing key as raw hex, from the environment.
 *
 * Never logged, never written to a file, never put in a message. The only
 * things that leave this module are a signature and, through
 * `oracleAddress`, a public address.
 */
export function oracleKeyHex(env: NodeJS.ProcessEnv = process.env): string {
  const direct = env.HEDERA_ORACLE_KEY?.trim();
  if (direct !== undefined && direct.length > 0) return normaliseRawKeyHex(direct);
  const operator = env.HEDERA_OPERATOR_KEY?.trim();
  if (operator !== undefined && operator.length > 0) {
    return deriveRoleKeyHex(operator, labelForRole('oracle'));
  }
  throw new Error('set HEDERA_ORACLE_KEY, or HEDERA_OPERATOR_KEY to derive it');
}
