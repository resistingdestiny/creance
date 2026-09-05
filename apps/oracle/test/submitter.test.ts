import { Interface } from 'ethers';
import { describe, expect, it } from 'vitest';

import { COVER_POOL_ABI, canAcceptObservation, openReasonName, seriesStatusName } from '../src/abi.js';
import { NULL_ODI, encodeObservation, toMonthIndex, toYyyymm } from '../src/submitter.js';

const SERIES = '0x4f44492d434f4d502d323032362d303100000000000000000000000000000000';
const HASH = 'ab'.repeat(32);

describe('the contract boundary', () => {
  it('speaks YYYYMM outside and the month index inside', () => {
    expect(toYyyymm('2026-04')).toBe(202604);
    expect(toYyyymm('2025-01')).toBe(202501);
    // docs/HEDERA.md: 2026-04 is month index 24315.
    expect(toMonthIndex('2026-04')).toBe(24315);
  });

  it('scales an index value by 1e4 through the decimal string', () => {
    const call = encodeObservation({
      seriesId: SERIES,
      period: '2026-04',
      odi: 0.3,
      ebar: -0.6,
      hcsSequence: 16,
      sourceHash: HASH,
    });
    expect(call).toEqual({
      seriesId: SERIES,
      period: 202604,
      odi: 3000n,
      ebar: -6000n,
      hcsSequence: 16n,
      sourceHash: `0x${HASH}`,
    });
  });

  it('never lets a float rounding artefact reach the boundary', () => {
    // 0.29 * 10000 is 2899.9999999999995 in a double.
    expect(
      encodeObservation({ seriesId: SERIES, period: '2026-04', odi: 0.29, ebar: -0.68, hcsSequence: 1, sourceHash: HASH }).odi,
    ).toBe(2900n);
    expect(
      encodeObservation({ seriesId: SERIES, period: '2026-04', odi: 0, ebar: -0.68, hcsSequence: 1, sourceHash: HASH }).ebar,
    ).toBe(-6800n);
  });

  it('sends the smallest int64 for a month with no evaluable ODI', () => {
    const call = encodeObservation({
      seriesId: SERIES,
      period: '2026-10',
      odi: null,
      ebar: -0.5,
      hcsSequence: 20,
      sourceHash: HASH,
    });
    expect(call.odi).toBe(NULL_ODI);
    expect(NULL_ODI).toBe(-9223372036854775808n);
    // It cannot open the shock form against any attachment the calibration
    // produces; the floor is 1.5 points.
    expect(NULL_ODI >= 15000n).toBe(false);
  });

  it('refuses a source hash that is not 32 bytes', () => {
    expect(() =>
      encodeObservation({ seriesId: SERIES, period: '2026-04', odi: 0, ebar: 0, hcsSequence: 1, sourceHash: 'abcd' }),
    ).toThrow(/not 32 bytes/);
  });

  it('encodes against the real function selector', () => {
    const iface = new Interface([...COVER_POOL_ABI]);
    const call = encodeObservation({
      seriesId: SERIES,
      period: '2026-04',
      odi: 0.3,
      ebar: -0.6,
      hcsSequence: 16,
      sourceHash: HASH,
    });
    const data = iface.encodeFunctionData('submitObservation', [call]);
    const decoded = iface.decodeFunctionData('submitObservation', data)[0];
    expect(Number(decoded.period)).toBe(202604);
    expect(BigInt(decoded.odi)).toBe(3000n);
    expect(BigInt(decoded.ebar)).toBe(-6000n);
  });

  it('names the statuses that accept an observation', () => {
    expect(['None', 'Active', 'ClaimsOpen', 'Settling', 'Matured'].map((_, i) => canAcceptObservation(i))).toEqual([
      false,
      true,
      true,
      true,
      false,
    ]);
    expect(seriesStatusName(2)).toBe('ClaimsOpen');
    expect(openReasonName(2)).toBe('level');
    expect(openReasonName(0)).toBe('none');
  });
});
