/**
 * Publication arithmetic. Every number the index publishes is a two-decimal
 * value produced by pub(), and every comparison the trigger makes is on those
 * published values, so that a reader recomputing from a message reaches the same
 * boolean as the oracle did.
 */

/**
 * Round half away from zero to two decimals. This is the function a reader with
 * a calculator applies. It is deliberately not toFixed and not Math.round on the
 * signed value: both round half to even on the binary representation, which is a
 * different function and disagrees on exactly the hand-written fixtures a
 * reviewer is most likely to write.
 */
export function pub(x: number): number {
  if (!Number.isFinite(x)) throw new Error(`cannot publish ${x}`);
  const rounded = Math.sign(x) * Math.floor(Math.abs(x) * 100 + 0.5) / 100;
  // Negative zero is normalised here rather than at serialisation time, so no
  // caller can print "-0.00".
  return rounded === 0 ? 0 : rounded;
}

/** The two-decimal string form of a published number; null becomes "null". */
export function fmt2(x: number | null | undefined): string {
  if (x === null || x === undefined) return 'null';
  const cents = Math.round(pub(x) * 100);
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Round to the nearest half, not up. floor(2x + 0.5) / 2. */
export function nearestHalf(x: number): number {
  const rounded = Math.floor(2 * x + 0.5) / 2;
  return rounded === 0 ? 0 : rounded;
}

const DECIMAL_RE = /^([+-]?)(\d+)(?:\.(\d{1,4}))?$/;

/**
 * The only permitted conversion from a published decimal to the on-chain int64,
 * scaled by 10,000. It parses the decimal string rather than multiplying a
 * JavaScript number by 10000, because the number path loses the value the
 * message actually carries: 0.29 * 10000 is 2899.9999999999995.
 */
export function toScaledInt(decimal: string): bigint {
  const match = DECIMAL_RE.exec(decimal.trim());
  if (!match) throw new Error(`not a scalable decimal: ${decimal}`);
  const [, sign, intPart, fracPart] = match;
  const frac = (fracPart ?? '').padEnd(4, '0');
  const magnitude = BigInt(intPart as string) * 10000n + BigInt(frac);
  return sign === '-' ? -magnitude : magnitude;
}

/** Population standard deviation: divide by n, not by n - 1. */
export function populationStdDev(values: readonly number[]): number {
  if (values.length === 0) throw new Error('no values');
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export function sampleStdDev(values: readonly number[]): number {
  if (values.length < 2) throw new Error('need at least two values');
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) throw new Error('no values');
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * The lower order statistic, sorted[floor(q * (n - 1))]. Linear interpolation
 * between neighbours, which is the numpy default, gives a different p95 for
 * three of the calibrated series and so a different level line.
 */
export function orderStatistic(values: readonly number[], q: number): number {
  if (values.length === 0) throw new Error('no values');
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.floor(q * (sorted.length - 1));
  return sorted[index] as number;
}
