import { hkdfSync } from 'node:crypto';

/// Role keys, derived from the operator key.
///
/// Every account this build uses carries a key derived from the operator key
/// with HKDF-SHA256 and the label `creance/testnet/<role>`, so the same
/// operator key always yields the same accounts and a clone recovers all of
/// them without a single new secret being stored. Testnet only: a derived key
/// is exactly as secret as the operator key it came from.
///
/// This lives here rather than in the contracts workspace because the API needs
/// it too and an import from there would pull Hardhat into the API's dependency
/// graph. `contracts/scripts/hedera/derive.ts` re-exports it, so there is one
/// implementation and the day 0 setup and the API cannot derive different keys.
///
/// https://www.rfc-editor.org/rfc/rfc5869.html

/// Order of the secp256k1 group. A private key must be in [1, n-1], so a
/// derived 32 byte string outside that range is rejected and re-derived.
const SECP256K1_ORDER = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

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

/** The HKDF label for a role. Kept in one place so nobody re-spells it. */
export function labelForRole(role: string): string {
  return `creance/testnet/${role}`;
}

/** Derive a role key from the operator key. The label is the only variable. */
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

/** The raw hex key for a role, by name rather than by label. */
export function roleKeyHex(operatorKeyHex: string, role: string): string {
  return deriveRoleKeyHex(operatorKeyHex, labelForRole(role));
}
