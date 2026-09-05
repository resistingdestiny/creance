import { describe, expect, it } from 'vitest';

import { readInteger, readPeriod, readSource, readString } from '../src/cli/args.js';
import { parseArgs as parseOnce } from '../src/cli/once.js';
import { DEFAULT_FROM, DEFAULT_INTERVAL_MS, parseArgs as parseReplay } from '../src/cli/replay.js';

describe('argument reading', () => {
  it('names the flag when a value is wrong', () => {
    expect(() => readPeriod('2026-4', '--from')).toThrow(/--from needs a period/);
    expect(() => readPeriod(undefined, '--to')).toThrow(/--to needs a period/);
    expect(() => readSource('postgres')).toThrow(/archive, cache or api/);
    expect(() => readInteger('-1', '--interval-ms')).toThrow(/--interval-ms/);
    expect(() => readInteger('1.5', '--interval-ms')).toThrow(/whole number/);
    expect(() => readString(undefined, '--series')).toThrow(/--series needs a value/);
  });

  it('accepts what it should', () => {
    expect(readPeriod('2026-04', '--from')).toBe('2026-04');
    expect(readSource('api')).toBe('api');
    expect(readInteger('0', '--interval-ms')).toBe(0);
  });
});

describe('pnpm oracle:once', () => {
  it('defaults to the live source, the newest period and a chain call', () => {
    expect(parseOnce([])).toEqual({
      period: null,
      source: 'api',
      series: null,
      publish: true,
      submit: true,
      dryRun: false,
      statePath: null,
    });
  });

  it('takes a period, a source, a series and the two off switches', () => {
    expect(
      parseOnce(['--period', '2026-07', '--source', 'archive', '--series', 'ODI-COMP-2026-01', '--no-submit', '--dry-run']),
    ).toMatchObject({
      period: '2026-07',
      source: 'archive',
      series: 'ODI-COMP-2026-01',
      submit: false,
      dryRun: true,
    });
  });

  it('refuses an argument it does not know', () => {
    expect(() => parseOnce(['--publish-everything'])).toThrow(/unknown argument/);
  });
});

describe('pnpm oracle:replay', () => {
  it('defaults to January 2025 from the archive at ten seconds a month', () => {
    expect(parseReplay([])).toEqual({
      from: DEFAULT_FROM,
      to: null,
      source: 'archive',
      series: null,
      intervalMs: DEFAULT_INTERVAL_MS,
      submit: true,
      dryRun: false,
      scenario: null,
      statePath: null,
    });
    expect(DEFAULT_FROM).toBe('2025-01');
    expect(DEFAULT_INTERVAL_MS).toBe(10_000);
  });

  it('takes the window the acceptance names', () => {
    expect(parseReplay(['--from', '2019-01'])).toMatchObject({ from: '2019-01', to: null });
  });

  it('lets a test run the clock fast', () => {
    expect(parseReplay(['--interval-ms', '0']).intervalMs).toBe(0);
  });

  it('takes a scenario by name', () => {
    expect(parseReplay(['--scenario', 'comp-shock-2026']).scenario).toBe('comp-shock-2026');
  });
});
