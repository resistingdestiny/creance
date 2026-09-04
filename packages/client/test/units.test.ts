import { describe, expect, it } from 'vitest';

import { money, toDisplay, toSmallest } from '../src/units.js';

describe('toSmallest', () => {
  it('scales a display amount into minor units', () => {
    expect(toSmallest('28.00', 6)).toBe('28000000');
    expect(toSmallest('328.767123', 6)).toBe('328767123');
    expect(toSmallest('100000', 6)).toBe('100000000000');
  });

  it('takes an amount with no fraction and one with no whole part', () => {
    expect(toSmallest('.5', 6)).toBe('500000');
    expect(toSmallest('7', 0)).toBe('7');
  });

  it('refuses to round away a place the asset cannot hold', () => {
    expect(() => toSmallest('0.1234567', 6)).toThrow(/more than 6 decimal places/);
  });

  it('refuses anything that is not a decimal amount', () => {
    expect(() => toSmallest('28.00 TUSD', 6)).toThrow(/decimal amount/);
    expect(() => toSmallest('', 6)).toThrow(/decimal amount/);
  });
});

describe('toDisplay', () => {
  it('shows two places by default', () => {
    expect(toDisplay('28000000', 6)).toBe('28.00');
    expect(toDisplay('100000000000', 6)).toBe('100000.00');
  });

  it('keeps every significant place a coupon needs', () => {
    expect(toDisplay('328767123', 6)).toBe('328.767123');
  });

  it('round trips with toSmallest', () => {
    expect(toSmallest(toDisplay('657534246', 6), 6)).toBe('657534246');
  });

  it('takes a bigint as well as a string', () => {
    expect(toDisplay(1n, 6)).toBe('0.000001');
  });
});

describe('money', () => {
  it('carries the asset and the scale with the amount', () => {
    expect(money(328_767_123n, '0.0.10366463', 6)).toEqual({
      amount: '328767123',
      asset: '0.0.10366463',
      decimals: 6,
      display: '328.767123',
    });
  });
});
