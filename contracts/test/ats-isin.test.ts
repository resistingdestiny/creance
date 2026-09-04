import { describe, expect, it } from 'vitest';

import { isValidIsin, isinCheckDigit, testIsinFor } from '../ats/isin.js';

describe('the ISO 6166 check digit', () => {
  // Published ISINs, used as the fixture the algorithm has to reproduce.
  // https://www.isin.org/isin-format/
  const published = [
    'US0378331005',
    'US9311421039',
    'GB0002634946',
    'AU0000XVGZA3',
    'DE000BAY0017',
  ];

  it('reproduces the check digit of a published ISIN', () => {
    for (const isin of published) {
      expect(isinCheckDigit(isin.slice(0, 11))).toBe(Number(isin[11]));
    }
  });

  it('accepts a published ISIN and rejects one digit changed', () => {
    for (const isin of published) {
      expect(isValidIsin(isin)).toBe(true);
      const wrong = `${isin.slice(0, 11)}${(Number(isin[11]) + 1) % 10}`;
      expect(isValidIsin(wrong)).toBe(false);
    }
  });

  it('rejects anything that is not twelve characters in the ISIN shape', () => {
    expect(isValidIsin('')).toBe(false);
    expect(isValidIsin('US037833100')).toBe(false);
    expect(isValidIsin('US03783310055')).toBe(false);
    expect(isValidIsin('us0378331005')).toBe(false);
    expect(isValidIsin('0S0378331005')).toBe(false);
  });
});

describe('the test ISIN for a series', () => {
  it('is valid, deterministic and carries the series label', () => {
    const isin = testIsinFor('ODI-COMP-2026-01');
    expect(isin).toBe(testIsinFor('ODI-COMP-2026-01'));
    expect(isValidIsin(isin)).toBe(true);
    expect(isin.startsWith('ZZODIC')).toBe(true);
  });

  it('differs between series', () => {
    expect(testIsinFor('ODI-COMP-2026-01')).not.toBe(testIsinFor('ODI-OFFICE-2026-01'));
  });
});
