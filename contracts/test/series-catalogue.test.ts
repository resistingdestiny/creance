import { loadCalibration, GROUP_DEFINITIONS, AGGREGATE_KEY } from '@creance/index-model';
import { describe, expect, it } from 'vitest';

import { catalogue, entryFor, labelFor, thresholdsFor } from '../scripts/deploy/catalogue.js';
import {
  ATTACHMENT_SHOCK,
  EXHAUSTION_SHOCK,
  GROUP_LABEL,
  LEVEL_LINE,
  SERIES_LABEL,
  toScaledPoints,
} from '../scripts/deploy/config.js';

/// The catalogue is the only place a series label, a note ticker and a group
/// meet, and every value in it has to agree with something that is already
/// frozen: the calibration, the picker's fifteen groups, and the demo series
/// that is on chain and cannot move.

describe('the series catalogue', () => {
  it('covers exactly the fifteen bindable groups', () => {
    const bindable = GROUP_DEFINITIONS.filter((group) => group.groupKey !== AGGREGATE_KEY);
    expect(bindable).toHaveLength(15);
    expect(catalogue().map((entry) => entry.groupKey).sort()).toEqual(
      bindable.map((group) => group.groupKey).sort(),
    );
  });

  it('puts the demo series first and the copy deck example second', () => {
    const order = catalogue().map((entry) => entry.groupKey);
    expect(order[0]).toBe(GROUP_LABEL);
    expect(order[1]).toBe('office_admin_support');
    expect(order.slice(2, 5)).toEqual([
      'transportation_material_moving',
      'production',
      'sales_related',
    ]);
  });

  it('keeps the demo series exactly as it is registered on chain', () => {
    const demo = catalogue()[0]!;
    expect(demo.label).toBe(SERIES_LABEL);
    expect(demo.noteSymbol).toBe('CDBN01');
    expect(demo.noteUnits).toBe(100n);
    const thresholds = thresholdsFor(GROUP_LABEL);
    expect(thresholds.attachmentShock).toBe(ATTACHMENT_SHOCK);
    expect(thresholds.levelLine).toBe(LEVEL_LINE);
    expect(thresholds.exhaustionShock).toBe(EXHAUSTION_SHOCK);
  });

  it('gives every series a distinct label, ticker and sixteen byte id', () => {
    const entries = catalogue();
    expect(new Set(entries.map((entry) => entry.label)).size).toBe(entries.length);
    expect(new Set(entries.map((entry) => entry.noteSymbol)).size).toBe(entries.length);
    for (const entry of entries) {
      expect(entry.label).toMatch(/^ODI-[A-Z]{4}-2026-01$/);
      expect(Buffer.from(entry.label, 'ascii').length).toBeLessThanOrEqual(32);
      expect(entry.noteSymbol).toMatch(/^CDBN\d{2}$/);
    }
  });

  it('reads every threshold from the frozen calibration', () => {
    for (const entry of loadCalibration().series) {
      const thresholds = thresholdsFor(entry.group_key);
      expect(thresholds.attachmentShock).toBe(toScaledPoints(entry.attachment_shock));
      expect(thresholds.levelLine).toBe(toScaledPoints(entry.level_line));
      expect(thresholds.exhaustionShock).toBe(thresholds.attachmentShock * 2n);
    }
  });

  it('rounds a scaled point rather than truncating it', () => {
    expect(toScaledPoints(-0.68)).toBe(-6_800n);
    expect(toScaledPoints(2)).toBe(20_000n);
    expect(toScaledPoints(12.78)).toBe(127_800n);
  });

  it('refuses a group it has no calibration or code for', () => {
    expect(() => thresholdsFor('armed_forces')).toThrow(/no frozen calibration/);
    expect(() => labelFor('armed_forces')).toThrow(/no series code/);
    expect(() => entryFor('armed_forces')).toThrow(/no series in the catalogue/);
  });

  it('finds an entry by group key or by label', () => {
    expect(entryFor('office_admin_support').label).toBe('ODI-OFFC-2026-01');
    expect(entryFor('ODI-OFFC-2026-01').groupKey).toBe('office_admin_support');
    expect(entryFor('odi-comp-2026-01').groupKey).toBe(GROUP_LABEL);
  });
});
