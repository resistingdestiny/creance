import { describe, expect, it } from 'vitest';
import { PrivateKey } from '@hiero-ledger/sdk';
import {
  ACCOUNT_ROLES,
  deriveRoleKeyHex,
  entityIdToEvmAddress,
  envNamesForRole,
  evmAddressFromKey,
  fromMinorUnits,
  hashscanUrl,
  isLongZeroAddress,
  labelForRole,
  normaliseRawKeyHex,
  roleKey,
  toMinorUnits,
  toMirrorTransactionId,
} from '../scripts/hedera/derive.js';

// A throwaway key, never used on any network. The vectors below are pinned so
// that a change to the derivation is a failing test rather than a new set of
// accounts nobody can find again. The gitleaks marker says the same thing to
// the pre-commit scanner, which cannot tell a fixture from a real key.
const OPERATOR_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'; // gitleaks:allow

describe('normaliseRawKeyHex', () => {
  it('accepts the raw form with and without the prefix', () => {
    expect(normaliseRawKeyHex(OPERATOR_KEY)).toBe(OPERATOR_KEY);
    expect(normaliseRawKeyHex(`0x${OPERATOR_KEY.toUpperCase()}`)).toBe(OPERATOR_KEY);
    expect(normaliseRawKeyHex(`  0x${OPERATOR_KEY}  `)).toBe(OPERATOR_KEY);
  });

  it('rejects a DER encoded key rather than deriving a different account from it', () => {
    const der = PrivateKey.generateECDSA().toStringDer();
    expect(der.length).toBeGreaterThan(64);
    expect(() => normaliseRawKeyHex(der)).toThrow(/raw 32 byte hex/);
  });

  it('rejects anything that is not 64 hex characters', () => {
    expect(() => normaliseRawKeyHex('')).toThrow();
    expect(() => normaliseRawKeyHex('0x1234')).toThrow();
    expect(() => normaliseRawKeyHex(`${OPERATOR_KEY.slice(0, 63)}z`)).toThrow();
  });
});

describe('deriveRoleKeyHex', () => {
  it('is deterministic, so a re-run recovers the same accounts', () => {
    const first = deriveRoleKeyHex(OPERATOR_KEY, labelForRole('oracle'));
    const second = deriveRoleKeyHex(`0x${OPERATOR_KEY}`, labelForRole('oracle'));
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it('pins the vector for the oracle role', () => {
    expect(deriveRoleKeyHex(OPERATOR_KEY, labelForRole('oracle'))).toBe(
      'ab55bf6a94938adfb3111a8d0500d2fada522f74a725b9913d899c2c4a829090',
    );
  });

  it('gives every role a different key', () => {
    const keys = ACCOUNT_ROLES.map((role) => deriveRoleKeyHex(OPERATOR_KEY, labelForRole(role)));
    expect(new Set(keys).size).toBe(ACCOUNT_ROLES.length);
  });

  it('changes completely when the operator key changes', () => {
    const other = `f${OPERATOR_KEY.slice(1)}`;
    expect(deriveRoleKeyHex(other, labelForRole('oracle'))).not.toBe(
      deriveRoleKeyHex(OPERATOR_KEY, labelForRole('oracle')),
    );
  });
});

describe('evmAddressFromKey', () => {
  it('derives the address from the public key, not from the account number', () => {
    const address = evmAddressFromKey(roleKey(OPERATOR_KEY, 'oracle'));
    expect(address).toMatch(/^0x[0-9a-f]{40}$/);
    expect(isLongZeroAddress(address)).toBe(false);
  });

  it('pins the oracle address so the account list is reproducible', () => {
    expect(evmAddressFromKey(roleKey(OPERATOR_KEY, 'oracle'))).toBe(
      '0x2859acb4fd57629669bf515c1a59bca92bc9b3a2',
    );
  });
});

describe('isLongZeroAddress', () => {
  it('spots the entity number padded to twenty bytes', () => {
    expect(isLongZeroAddress('0x000000000000000000000000000000000000004d')).toBe(true);
    expect(isLongZeroAddress('0x0000000000000000000000000000000000000000')).toBe(true);
    expect(isLongZeroAddress('0x00000000000000000000000000000000000004AB')).toBe(true);
  });

  it('passes a key derived address', () => {
    expect(isLongZeroAddress('0x639444758b987b4d938c57169a1f61a62b2d009c')).toBe(false);
    // Eleven leading zero bytes is one short of long-zero.
    expect(isLongZeroAddress('0x0000000000000000000000ff00000000000000ff')).toBe(false);
  });
});

describe('entityIdToEvmAddress', () => {
  it('matches the SDK for a token id', () => {
    expect(entityIdToEvmAddress('0.0.429274')).toBe('0x0000000000000000000000000000000000068cda');
    expect(entityIdToEvmAddress('0.0.77')).toBe('0x000000000000000000000000000000000000004d');
    expect(isLongZeroAddress(entityIdToEvmAddress('0.0.429274'))).toBe(true);
  });

  it('rejects anything that is not shard.realm.number', () => {
    expect(() => entityIdToEvmAddress('0x68cda')).toThrow();
    expect(() => entityIdToEvmAddress('0.0')).toThrow();
  });
});

describe('minor units', () => {
  it('carries a premium of 28 TUSD as an integer', () => {
    expect(toMinorUnits(28, 6)).toBe(28_000_000n);
    expect(fromMinorUnits(28_000_000n, 6)).toBe('28');
    expect(fromMinorUnits(28_500_000n, 6)).toBe('28.5');
    expect(fromMinorUnits(1n, 6)).toBe('0.000001');
  });
});

describe('naming', () => {
  it('maps a role to the env names later tickets read', () => {
    expect(envNamesForRole('policyholder-1')).toEqual({
      id: 'HEDERA_POLICYHOLDER_1_ID',
      key: 'HEDERA_POLICYHOLDER_1_KEY', // gitleaks:allow, this is a variable name
    });
    expect(envNamesForRole('api')).toEqual({ id: 'HEDERA_API_ID', key: 'HEDERA_API_KEY' });
  });

  it('turns an SDK transaction id into the form the explorer wants', () => {
    expect(toMirrorTransactionId('0.0.10362512@1757003000.123456789')).toBe(
      '0.0.10362512-1757003000-123456789',
    );
    expect(() => toMirrorTransactionId('0.0.10362512-1757003000-123456789')).toThrow();
  });

  it('builds explorer links', () => {
    expect(hashscanUrl('token', '0.0.429274')).toBe('https://hashscan.io/testnet/token/0.0.429274');
  });
});
