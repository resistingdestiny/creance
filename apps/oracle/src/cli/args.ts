import { isPeriod, type Period } from '@creance/index-model';

/**
 * Argument parsing shared by the two commands, in the shape
 * packages/index-model/src/cli/backfill.ts established: long flags only, a
 * value on the next argument, and a thrown error naming the flag rather than a
 * usage dump.
 */

export type SourcePreference = 'archive' | 'cache' | 'api';

export function readPeriod(value: string | undefined, flag: string): Period {
  if (value === undefined || !isPeriod(value)) {
    throw new Error(`${flag} needs a period like 2026-04, not ${String(value)}`);
  }
  return value;
}

export function readSource(value: string | undefined): SourcePreference {
  if (value !== 'archive' && value !== 'cache' && value !== 'api') {
    throw new Error(`--source must be archive, cache or api, not ${String(value)}`);
  }
  return value;
}

export function readInteger(value: string | undefined, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${flag} needs a whole number of milliseconds, not ${String(value)}`);
  }
  return parsed;
}

export function readString(value: string | undefined, flag: string): string {
  if (value === undefined || value.length === 0) {
    throw new Error(`${flag} needs a value`);
  }
  return value;
}
