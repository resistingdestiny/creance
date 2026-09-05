import { describe, expect, it } from 'vitest';

import { deriveRoleKeyHex, labelForRole, normaliseRawKeyHex, oracleKeyHex } from '../src/keys.js';

const OPERATOR = '0x'.concat('11'.repeat(32));

describe('oracle key handling', () => {
  it('strips the prefix and lowercases a raw key', () => {
    expect(normaliseRawKeyHex(`0x${'AB'.repeat(32)}`)).toBe('ab'.repeat(32));
  });

  it('refuses anything that is not a raw 32 byte key', () => {
    expect(() => normaliseRawKeyHex('302e0201')).toThrow(/raw 32 byte hex/);
  });

  it('derives the same key for the same label every time', () => {
    const first = deriveRoleKeyHex(OPERATOR, labelForRole('oracle'));
    expect(deriveRoleKeyHex(OPERATOR, labelForRole('oracle'))).toBe(first);
    expect(deriveRoleKeyHex(OPERATOR, labelForRole('api'))).not.toBe(first);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  // Pinned values, not just self consistency. The derivation moved out of this
  // app and into packages/client when T07 merged, and a derivation that changed
  // would silently sign with a key no account holds the role for. These are
  // what the copy in this app produced before the swap.
  it('derives the values the copy in this app produced before it was shared', () => {
    expect(deriveRoleKeyHex(OPERATOR, labelForRole('oracle'))).toBe(
      '85ff9719d7e96a7da535dd677bc31b0fbd8bf2139913e7687b4edbaa1209c7af',
    );
    expect(deriveRoleKeyHex(OPERATOR, labelForRole('api'))).toBe(
      '6ddcb61c2c8a7e60df86ce39963847f756925d7509b8f3a47db062d01dfd01a2',
    );
  });

  it('prefers the explicit key and falls back to the operator', () => {
    const explicit = 'cd'.repeat(32);
    expect(oracleKeyHex({ HEDERA_ORACLE_KEY: explicit })).toBe(explicit);
    expect(oracleKeyHex({ HEDERA_OPERATOR_KEY: OPERATOR })).toBe(
      deriveRoleKeyHex(OPERATOR, 'creance/testnet/oracle'),
    );
    expect(() => oracleKeyHex({})).toThrow(/HEDERA_ORACLE_KEY/);
  });
});
