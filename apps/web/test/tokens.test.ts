import { describe, expect, it } from 'vitest';

import {
  CANVAS,
  COLOUR_TOKENS,
  SURFACE,
  contrastRatio,
  formatRatio,
  passesTextFloor,
} from '../src/lib/tokens.js';

function ratio(name: string, ground: string): number {
  const token = COLOUR_TOKENS.find((candidate) => candidate.name === name);
  if (!token) throw new Error(`No token named ${name}`);
  return contrastRatio(token.hex, ground);
}

describe('contrast maths', () => {
  it('gives 21:1 for black on white', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
  });

  it('gives 1:1 for a colour against itself', () => {
    expect(contrastRatio('#D13B3B', '#D13B3B')).toBeCloseTo(1, 10);
  });

  it('is symmetric', () => {
    expect(contrastRatio('#6B6F76', CANVAS)).toBeCloseTo(contrastRatio(CANVAS, '#6B6F76'), 10);
  });

  it('rejects anything that is not a six digit hex', () => {
    expect(() => contrastRatio('#fff', CANVAS)).toThrow(RangeError);
  });
});

describe('the three tokens that fail the sheet own floor', () => {
  it('covered fails 4.5:1 on both grounds', () => {
    expect(ratio('covered', CANVAS)).toBeLessThan(4.5);
    expect(ratio('covered', SURFACE)).toBeLessThan(4.5);
  });

  it('watch fails badly on both grounds', () => {
    expect(ratio('watch', CANVAS)).toBeLessThan(3.5);
    expect(ratio('watch', SURFACE)).toBeLessThan(3.5);
  });

  it('triggered passes on canvas and fails on surface', () => {
    expect(passesTextFloor(ratio('triggered', CANVAS))).toBe(true);
    expect(passesTextFloor(ratio('triggered', SURFACE))).toBe(false);
  });

  it('triggered clears the large text floor on canvas, which is the one allowed exception', () => {
    expect(passesTextFloor(ratio('triggered', CANVAS), true)).toBe(true);
  });

  it('ink-3 fails everywhere, so it carries no information', () => {
    expect(ratio('ink-3', CANVAS)).toBeLessThan(3);
    expect(ratio('ink-3', SURFACE)).toBeLessThan(3);
  });
});

describe('the greys the design leans on', () => {
  it('ink-2 clears 4.5:1 on canvas and on surface', () => {
    expect(passesTextFloor(ratio('ink-2', CANVAS))).toBe(true);
    expect(passesTextFloor(ratio('ink-2', SURFACE))).toBe(true);
  });

  it('ink is the maximum on canvas', () => {
    expect(ratio('ink', CANVAS)).toBeCloseTo(21, 5);
  });

  it('every state colour clears 3:1 as a dot on the near-white pill', () => {
    for (const name of ['covered', 'watch', 'triggered']) {
      expect(passesTextFloor(ratio(name, CANVAS), true)).toBe(true);
    }
  });

  it('prints a ratio to two decimals', () => {
    expect(formatRatio(4.5)).toBe('4.50:1');
  });
});
