import { describe, expect, it } from 'vitest';

import {
  creatable,
  deferred,
  premiumPlan,
  MAX_SCHEDULE_WINDOW_SECONDS,
  WINDOW_MARGIN_SECONDS,
} from '../src/premiums.js';

const createdAt = new Date('2026-09-05T12:00:00Z');
const firstDueAt = new Date('2026-10-05T12:00:00Z');

const base = {
  policyId: 'pol_01M1',
  paidThrough: 202609,
  firstDueAt,
  count: 3,
  createdAt,
};

describe('premiumPlan, monthly', () => {
  const plan = premiumPlan({ ...base, cadence: { kind: 'monthly' } });

  it('covers the three months after the one the bind paid', () => {
    expect(plan.map((premium) => premium.slot.period)).toEqual([202610, 202611, 202612]);
  });

  it('names the month in the memo, because the execution timestamp cannot', () => {
    expect(plan[0]?.slot.memo).toBe('creance premium pol_01M1 202610');
  });

  it('due dates are one calendar month apart', () => {
    expect(plan.map((premium) => premium.slot.executeAt.toISOString())).toEqual([
      '2026-10-05T12:00:00.000Z',
      '2026-11-05T12:00:00.000Z',
      '2026-12-05T12:00:00.000Z',
    ]);
  });

  it('creates the two that fit inside the 62 day cap and defers the third', () => {
    expect(creatable(plan).map((premium) => premium.slot.period)).toEqual([202610, 202611]);
    expect(deferred(plan).map((premium) => premium.slot.period)).toEqual([202612]);
  });

  it('the deferred premium is past the cap, not near it', () => {
    expect(deferred(plan)[0]?.secondsOut).toBeGreaterThan(MAX_SCHEDULE_WINDOW_SECONDS);
  });

  it('anchors the chain on the due day, so a short month does not move it', () => {
    const monthEnd = premiumPlan({
      ...base,
      firstDueAt: new Date('2026-12-31T12:00:00Z'),
      paidThrough: 202611,
      cadence: { kind: 'monthly' },
    });
    expect(monthEnd.map((premium) => premium.slot.executeAt.toISOString().slice(0, 10))).toEqual([
      '2026-12-31',
      '2027-01-31',
      '2027-02-28',
    ]);
    expect(monthEnd[2]?.slot.dueDay).toBe(31);
  });

  it('leaves a margin, because the cap is measured from the consensus timestamp', () => {
    const edge = premiumPlan({
      ...base,
      count: 1,
      firstDueAt: new Date(
        createdAt.getTime() + (MAX_SCHEDULE_WINDOW_SECONDS - WINDOW_MARGIN_SECONDS + 1) * 1000,
      ),
      cadence: { kind: 'monthly' },
    });
    expect(edge[0]?.withinWindow).toBe(false);
  });
});

describe('premiumPlan, the compressed demo cadence', () => {
  const plan = premiumPlan({
    ...base,
    cadence: { kind: 'demo', intervalSeconds: 90 },
  });

  it('steps the accounting months exactly as the monthly cadence does', () => {
    expect(plan.map((premium) => premium.slot.period)).toEqual([202610, 202611, 202612]);
  });

  it('puts every due date seconds out, so all three fit inside the cap', () => {
    expect(plan.map((premium) => premium.secondsOut)).toEqual([90, 180, 270]);
    expect(creatable(plan)).toHaveLength(3);
    expect(deferred(plan)).toHaveLength(0);
  });
});

describe('premiumPlan, refusals', () => {
  it('refuses a due date that has already passed', () => {
    expect(() =>
      premiumPlan({
        ...base,
        firstDueAt: new Date('2026-09-04T12:00:00Z'),
        cadence: { kind: 'monthly' },
      }),
    ).toThrow(/not after the create/);
  });

  it('refuses a plan of no premiums', () => {
    expect(() => premiumPlan({ ...base, count: 0, cadence: { kind: 'monthly' } })).toThrow(
      /at least one premium/,
    );
  });
});
