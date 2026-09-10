import { afterEach, describe, expect, it } from 'vitest';

import { COUPON, NOTE, noteNameFor, OPERATOR_ROLES, ROLES } from '../ats/config.js';
import { catalogue } from '../scripts/deploy/catalogue.js';

// The module reads the environment when it loads its constants, so the version
// helper is imported fresh in each case that changes it.
async function pinned(value: string | undefined): Promise<number | undefined> {
  if (value === undefined) delete process.env.ATS_BOND_CONFIG_VERSION;
  else process.env.ATS_BOND_CONFIG_VERSION = value;
  const { pinnedBondConfigVersion } = await import('../ats/config.js');
  return pinnedBondConfigVersion();
}

const before = process.env.ATS_BOND_CONFIG_VERSION;

afterEach(() => {
  if (before === undefined) delete process.env.ATS_BOND_CONFIG_VERSION;
  else process.env.ATS_BOND_CONFIG_VERSION = before;
});

describe('the pinned configuration version', () => {
  it('is undefined when the variable is unset or blank, so the resolver decides', async () => {
    expect(await pinned(undefined)).toBeUndefined();
    expect(await pinned('')).toBeUndefined();
    expect(await pinned('  ')).toBeUndefined();
  });

  it('is the integer when one is pinned', async () => {
    expect(await pinned('1')).toBe(1);
    expect(await pinned('7')).toBe(7);
  });

  it('refuses anything that is not an integer of one or more', async () => {
    await expect(pinned('abc')).rejects.toThrow(/integer of 1 or more/);
    await expect(pinned('0')).rejects.toThrow(/integer of 1 or more/);
    await expect(pinned('1.5')).rejects.toThrow(/integer of 1 or more/);
  });
});

describe('the note terms', () => {
  it('matches the demo numbers in DESIGN.md 3.4', () => {
    expect(NOTE.units * NOTE.nominalValue).toBe(100_000n);
    expect(NOTE.decimals).toBe(6);
    expect(COUPON.ratePercent).toBe(8);
  });

  it('holds the coupon rate as a value and a scale, which is what setCoupon takes', () => {
    expect(Number(COUPON.rate) / 10 ** COUPON.rateDecimals).toBe(COUPON.ratePercent / 100);
  });

  it('names the demo note the way every note is named, so nothing was renamed', () => {
    expect(noteNameFor('ODI-COMP-2026-01')).toBe(NOTE.name);
  });

  it('sizes every other note to the capacity its series is funded with', () => {
    for (const entry of catalogue().slice(1)) {
      expect(entry.noteUnits * NOTE.nominalValue).toBe(25_000n);
      expect(noteNameFor(entry.label)).toBe(`Creance Displacement Bond Note ${entry.label}`);
    }
  });
});

describe('the role hashes', () => {
  it('are the 8.0.0 keccak values, thirty-two bytes each', () => {
    for (const role of OPERATOR_ROLES) {
      expect(ROLES[role]).toMatch(/^0x[0-9a-f]{64}$/);
    }
  });

  it('are all different, so no two grants collide', () => {
    expect(new Set(OPERATOR_ROLES.map((role) => ROLES[role])).size).toBe(OPERATOR_ROLES.length);
  });
});
