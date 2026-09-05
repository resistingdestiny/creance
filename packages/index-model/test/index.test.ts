import { describe, expect, it } from 'vitest';

import {
  BlsClient,
  ENDPOINTS,
  addMonths,
  canonicalize,
  computeSeries,
  describeWorkspace,
  fmt2,
  frozenParameters,
  guideRate,
  headline,
  isPeriod,
  latestPeriod,
  loadCalibration,
  loadSeriesMap,
  marketRate,
  periodRange,
  seriesIdFor,
  sourceHash,
  summary,
  toScaledInt,
  workspaceName,
} from '../src/index.js';
import type { Observation, Period, SeriesInput } from '../src/index.js';

describe('@creance/index-model', () => {
  it('describes itself', () => {
    expect(workspaceName).toBe('@creance/index-model');
    expect(describeWorkspace()).toBe(`@creance/index-model: ${summary}`);
  });
});

/**
 * The entry point is the contract with the oracle, the API and the web app.
 * These are not restatements of the unit tests in the other files; they exist so
 * that a name disappearing from the barrel fails here rather than in a consumer.
 */
describe('the public surface', () => {
  it('canonicalises and hashes the way a message is signed', () => {
    expect(canonicalize({ b: 1, a: [true, null] })).toBe('{"a":[true,null],"b":1}');
    const rows = [{ seriesId: 'LNU04034021', period: '2026-04', value: '4.1' }];
    expect(sourceHash(rows)).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(sourceHash(rows)).toBe(sourceHash([...rows]));
  });

  it('formats and scales a published value', () => {
    expect(fmt2(-0.6)).toBe('-0.60');
    expect(fmt2(null)).toBe('-');
    expect(toScaledInt('-0.68')).toBe(-68n);
  });

  it('walks the calendar', () => {
    expect(isPeriod('2026-04')).toBe(true);
    expect(isPeriod('2026-13')).toBe(false);
    expect(addMonths('2026-01', -2)).toBe('2025-11');
    expect(periodRange('2025-12', '2026-02')).toEqual(['2025-12', '2026-01', '2026-02']);
  });

  it('reads the frozen series map and calibration', () => {
    expect(seriesIdFor('computer_math', loadSeriesMap())).toBe('LNU04032215');
    const frozen = frozenParameters(loadCalibration());
    const computerMath = frozen.get('computer_math');
    expect(computerMath?.attachmentShock).toBe(2.0);
    expect(computerMath?.levelLine).toBe(-0.68);
  });

  it('evaluates a series and prices the distance to its line', () => {
    // One hand worked month. The group sits 0.4 points under the aggregate for
    // three months, so ebar is -0.40, which is above a line of -0.68 and opens.
    const periods: Period[] = ['2026-02', '2026-03', '2026-04'];
    const input: SeriesInput = {
      groupKey: 'computer_math',
      seriesId: 'LNU04032215',
      groupRates: new Map(periods.map((period) => [period, 4.1])),
      aggregateRates: new Map(periods.map((period) => [period, 4.5])),
      parameters: { attachmentShock: 2.0, levelLine: -0.68 },
    };
    const observations = computeSeries(input, '2026-04', '2026-04');
    const april = observations[0] as Observation;
    expect(april.ebar).toBe(-0.4);
    expect(april.odi).toBeNull();
    expect(april.open).toBe(true);
    expect(april.openReason).toBe('level');

    const line = headline(april);
    expect(line?.form).toBe('level');
    // Already 0.28 points past the line, so the distance is negative.
    expect(line?.distance).toBeCloseTo(-0.28, 10);

    const guide = guideRate(line?.distance ?? 0);
    expect(guide).toBeGreaterThan(0.005);
    expect(marketRate(guide, 2)).toBe(guide * 3);
  });

  it('reaches the live client without a key and the latest archived month', () => {
    const client = new BlsClient({ apiKey: '' });
    expect(client.version).toBe('v1');
    expect(ENDPOINTS.v1.endsWith('/')).toBe(true);
    expect(
      latestPeriod(
        new Map([['LNU04032215', [{ seriesId: 'LNU04032215', period: '2026-07', value: 4.1 }]]]),
      ),
    ).toBe('2026-07');
  });
});
