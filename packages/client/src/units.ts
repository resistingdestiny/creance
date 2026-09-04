/// Amounts, in one place.
///
/// Every monetary value that crosses the wire is an integer string in the
/// settlement asset's smallest unit, and the asset and its decimals travel with
/// it. No float ever touches an amount: 28.00 TUSD is `28000000` at six
/// decimals, and a JSON number would round it the first time somebody widened
/// the scale.

/** `28.00` at six decimals becomes `28000000`. Both ends are strings. */
export function toSmallest(display: string, decimals: number): string {
  assertDecimals(decimals);
  const trimmed = display.trim();
  const match = /^(-?)(\d*)(?:\.(\d*))?$/.exec(trimmed);
  if (!match || (match[2] === '' && (match[3] ?? '') === '')) {
    throw new Error(`expected a decimal amount, got ${display}`);
  }
  const [, sign = '', whole = '', fraction = ''] = match;
  if (fraction.length > decimals) {
    throw new Error(`${display} has more than ${decimals} decimal places`);
  }
  const padded = fraction.padEnd(decimals, '0');
  const value = BigInt(`${whole === '' ? '0' : whole}${padded}`);
  return `${sign}${value}`;
}

/** `28000000` at six decimals becomes `28.00`, with at least two places. */
export function toDisplay(amount: string | bigint, decimals: number, minimumFraction = 2): string {
  assertDecimals(decimals);
  const value = typeof amount === 'bigint' ? amount : BigInt(amount.trim());
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const scale = 10n ** BigInt(decimals);
  const whole = magnitude / scale;
  const fraction = (magnitude % scale).toString().padStart(decimals, '0');
  const places = Math.max(minimumFraction, trimmedLength(fraction));
  const shown = places === 0 ? '' : `.${fraction.slice(0, places).padEnd(places, '0')}`;
  return `${negative ? '-' : ''}${whole}${shown}`;
}

/** The money envelope every API response carries. `display` is never parsed. */
export interface Money {
  amount: string;
  asset: string;
  decimals: number;
  display: string;
}

export function money(amount: string | bigint, asset: string, decimals: number): Money {
  const value = typeof amount === 'bigint' ? amount.toString() : amount.trim();
  return { amount: value, asset, decimals, display: toDisplay(value, decimals) };
}

function assertDecimals(decimals: number): void {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    throw new Error(`decimals must be an integer of 0 to 18, got ${decimals}`);
  }
}

/** How many fraction digits are left once the trailing zeros are dropped. */
function trimmedLength(fraction: string): number {
  return fraction.replace(/0+$/, '').length;
}
