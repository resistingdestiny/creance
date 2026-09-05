import { describe, expect, it } from 'vitest';

import {
  fmt2,
  mean,
  nearestHalf,
  orderStatistic,
  populationStdDev,
  pub,
  sampleStdDev,
  toScaledInt,
} from '../src/rounding.js';

describe('pub', () => {
  it('rounds half away from zero, not half to even', () => {
    // 0.005 * 100 + 0.5 = 1.0, floor 1, so one cent. Math.round(-0.005) is -0
    // and (0.125).toFixed(2) is "0.13" only by accident of the binary value.
    expect(pub(0.005)).toBe(0.01);
    expect(pub(-0.005)).toBe(-0.01);
    expect(pub(0.125)).toBe(0.13);
    expect(pub(-0.125)).toBe(-0.13);
    expect(pub(0.015)).toBe(0.02);
  });

  it('normalises negative zero', () => {
    expect(Object.is(pub(-0.001), 0)).toBe(true);
    expect(Object.is(pub(-0), 0)).toBe(true);
    expect(fmt2(pub(-0.001))).toBe('0.00');
  });

  it('reproduces the smoothed value the demo month turns on', () => {
    // ebar for computer_math 2026-04 is the mean of -0.90, -0.40 and -0.50.
    // (-0.90 + -0.40 + -0.50) / 3 = -1.80 / 3 = -0.60 exactly.
    expect(pub((-0.9 + -0.4 + -0.5) / 3)).toBe(-0.6);
  });
});

describe('fmt2', () => {
  it('prints two decimals with no negative zero and null for absent', () => {
    expect(fmt2(-0.6)).toBe('-0.60');
    expect(fmt2(2)).toBe('2.00');
    expect(fmt2(0)).toBe('0.00');
    expect(fmt2(-0)).toBe('0.00');
    expect(fmt2(null)).toBe('null');
    expect(fmt2(12.25)).toBe('12.25');
    expect(fmt2(-1.325)).toBe('-1.33');
  });
});

describe('nearestHalf', () => {
  it('rounds to the nearest half rather than up', () => {
    // 3 sigma for service is 1.5788: nearest half is 1.5, rounding up gives 2.0
    // and breaks the frozen table.
    expect(nearestHalf(1.5788)).toBe(1.5);
    expect(nearestHalf(1.664)).toBe(1.5);
    expect(nearestHalf(2.6437)).toBe(2.5);
    expect(nearestHalf(2.8639)).toBe(3.0);
    expect(nearestHalf(5.4006)).toBe(5.5);
    // floor(2x + 0.5) / 2 rounds a tie up: 1.25 -> floor(3.0)/2 -> 1.5.
    expect(nearestHalf(1.25)).toBe(1.5);
  });
});

describe('toScaledInt', () => {
  it('parses the decimal string rather than multiplying a number', () => {
    // 0.29 * 10000 is 2899.9999999999995 in binary floating point.
    expect(toScaledInt('0.29')).toBe(2900n);
    expect(toScaledInt('-0.60')).toBe(-6000n);
    expect(toScaledInt('2.00')).toBe(20000n);
    expect(toScaledInt('12.25')).toBe(122500n);
    expect(toScaledInt('0.0001')).toBe(1n);
    expect(toScaledInt('0.00')).toBe(0n);
    expect(toScaledInt('-0.00')).toBe(0n);
  });

  it('refuses anything that is not a decimal at four places or fewer', () => {
    expect(() => toScaledInt('0.00001')).toThrow();
    expect(() => toScaledInt('null')).toThrow();
    expect(() => toScaledInt('1e3')).toThrow();
  });
});

describe('statistics', () => {
  it('divides by n for the population standard deviation', () => {
    // values 1, 2, 3, 4: mean 2.5, squared deviations 2.25 + 0.25 + 0.25 + 2.25
    // = 5. Population variance 5 / 4 = 1.25, sample variance 5 / 3.
    expect(mean([1, 2, 3, 4])).toBe(2.5);
    expect(populationStdDev([1, 2, 3, 4])).toBeCloseTo(Math.sqrt(1.25), 12);
    expect(sampleStdDev([1, 2, 3, 4])).toBeCloseTo(Math.sqrt(5 / 3), 12);
  });

  it('takes the lower order statistic and not an interpolated quantile', () => {
    // n = 120: floor(0.95 * 119) = 113, so the 114th smallest value.
    const values = Array.from({ length: 120 }, (_, i) => i);
    expect(orderStatistic(values, 0.95)).toBe(113);
    expect(orderStatistic(values, 0.5)).toBe(59);
  });
});
