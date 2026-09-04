import { expect } from 'chai';
import { network } from 'hardhat';

import type { MonthLibHarness } from '../../types/ethers-contracts/index.js';

// The month index is year * 12 + (month - 1). Every window rule in CoverPool is
// arithmetic on it, so this suite is the one that has to be right first.
const SECONDS_PER_DAY = 86_400;

function utc(iso: string): bigint {
  return BigInt(Math.floor(Date.parse(iso) / 1000));
}

describe('MonthLib', () => {
  let month: MonthLibHarness;

  before(async () => {
    const { ethers } = await network.getOrCreate();
    month = (await ethers.deployContract('MonthLibHarness')) as unknown as MonthLibHarness;
  });

  it('round trips every month from 2000-01 to 2030-12', async () => {
    for (let year = 2000; year <= 2030; year += 1) {
      for (let m = 1; m <= 12; m += 1) {
        const yyyymm = year * 100 + m;
        const index = await month.toIndex(yyyymm);
        expect(index).to.equal(BigInt(year * 12 + (m - 1)));
        expect(await month.toYyyymm(index)).to.equal(BigInt(yyyymm));
      }
    }
  });

  it('maps the demo month 2026-04 to index 24315', async () => {
    expect(await month.toIndex(202604)).to.equal(24315n);
  });

  it('rejects month 0 and month 13', async () => {
    await expect(month.toIndex(202600)).to.be.revertedWithCustomError(month, 'BadPeriod');
    await expect(month.toIndex(202613)).to.be.revertedWithCustomError(month, 'BadPeriod');
  });

  it('rejects a year before 1970', async () => {
    await expect(month.toIndex(196912)).to.be.revertedWithCustomError(month, 'BadPeriod');
  });

  const fixtures: Array<[string, number, number]> = [
    ['1970-01-01T00:00:00Z', 1970, 1],
    ['2000-01-01T00:00:00Z', 2000, 1],
    ['2000-02-29T12:00:00Z', 2000, 2],
    ['2000-03-01T00:00:00Z', 2000, 3],
    ['2019-12-31T23:59:59Z', 2019, 12],
    ['2020-01-01T00:00:00Z', 2020, 1],
    ['2024-02-29T00:00:00Z', 2024, 2],
    ['2024-02-29T23:59:59Z', 2024, 2],
    ['2024-03-01T00:00:00Z', 2024, 3],
    ['2025-01-01T00:00:00Z', 2025, 1],
    ['2025-12-31T23:59:59Z', 2025, 12],
    ['2026-01-01T00:00:00Z', 2026, 1],
    ['2026-01-31T23:59:59Z', 2026, 1],
    ['2026-02-01T00:00:00Z', 2026, 2],
    ['2026-02-28T23:59:59Z', 2026, 2],
    ['2026-03-01T00:00:00Z', 2026, 3],
    ['2026-04-01T00:00:00Z', 2026, 4],
    ['2026-04-30T23:59:59Z', 2026, 4],
    ['2026-05-01T00:00:00Z', 2026, 5],
    ['2026-07-15T09:30:00Z', 2026, 7],
    ['2026-12-31T23:59:59Z', 2026, 12],
    ['2100-03-01T00:00:00Z', 2100, 3],
  ];

  it('maps a fixture table of timestamps to the right month', async () => {
    for (const [iso, year, m] of fixtures) {
      const index = await month.monthIndexOf(utc(iso));
      expect(index, iso).to.equal(BigInt(year * 12 + (m - 1)));
    }
  });

  it('brackets every fixture timestamp between the month start and the next', async () => {
    for (const [iso] of fixtures) {
      const at = utc(iso);
      const index = await month.monthIndexOf(at);
      expect(await month.startOfMonth(index), iso).to.be.lessThanOrEqual(at);
      expect(await month.startOfMonth(index + 1n), iso).to.be.greaterThan(at);
    }
  });

  it('startOfMonth is the exact first instant of the month', async () => {
    expect(await month.startOfMonth(await month.toIndex(202604))).to.equal(utc('2026-04-01T00:00:00Z'));
    expect(await month.startOfMonth(await month.toIndex(202603))).to.equal(utc('2026-03-01T00:00:00Z'));
    expect(await month.startOfMonth(await month.toIndex(202502))).to.equal(utc('2025-02-01T00:00:00Z'));
    expect(await month.startOfMonth(await month.toIndex(202401))).to.equal(utc('2024-01-01T00:00:00Z'));
  });

  it('startOfMonth of the month after an open month lands one day after its last day', async () => {
    const april = await month.toIndex(202604);
    const may = await month.startOfMonth(april + 1n);
    expect(may - (await month.startOfMonth(april))).to.equal(BigInt(30 * SECONDS_PER_DAY));
  });

  it('rejects a month index before 1970-01', async () => {
    await expect(month.startOfMonth(1)).to.be.revertedWithCustomError(month, 'MonthOutOfRange');
    await expect(month.toYyyymm(1)).to.be.revertedWithCustomError(month, 'MonthOutOfRange');
  });
});
