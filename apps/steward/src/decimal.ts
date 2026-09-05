/// Comparing published index values without going through a float.
///
/// The index endpoint returns every value as a decimal string, deliberately:
/// docs/DECISIONS.md keeps index values off JSON numbers because a float round
/// trip can publish a number that is not the number the contract compared. The
/// decision rule compares three of them, so it compares them as decimals.

const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/;

/** -1, 0 or 1, on the exact decimal values. Throws on anything else. */
export function compareDecimals(left: string, right: string): number {
  const a = parseDecimal(left);
  const b = parseDecimal(right);
  const places = Math.max(a.places, b.places);
  const scaled = (value: { sign: bigint; digits: bigint; places: number }): bigint =>
    value.sign * value.digits * 10n ** BigInt(places - value.places);
  const difference = scaled(a) - scaled(b);
  return difference === 0n ? 0 : difference < 0n ? -1 : 1;
}

function parseDecimal(value: string): { sign: bigint; digits: bigint; places: number } {
  const match = DECIMAL.exec(value.trim());
  if (!match) {
    throw new Error(`expected a decimal value, got ${value}`);
  }
  const [, sign = '', whole = '0', fraction = ''] = match;
  return {
    sign: sign === '-' ? -1n : 1n,
    digits: BigInt(`${whole}${fraction}`),
    places: fraction.length,
  };
}
