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

  it('prefers the explicit key and falls back to the operator', () => {
    const explicit = 'cd'.repeat(32);
    expect(oracleKeyHex({ HEDERA_ORACLE_KEY: explicit })).toBe(explicit);
    expect(oracleKeyHex({ HEDERA_OPERATOR_KEY: OPERATOR })).toBe(
      deriveRoleKeyHex(OPERATOR, 'creance/testnet/oracle'),
    );
    expect(() => oracleKeyHex({})).toThrow(/HEDERA_ORACLE_KEY/);
  });
});
