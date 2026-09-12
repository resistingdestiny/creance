/**
 * The one place a number, a date or an address is turned into a string.
 *
 * Nothing else in the web app may format a figure. Two rules make this
 * necessary rather than tidy:
 *
 * 1. Every date the API sends is a date-only string ("2026-10-04") or a period
 *    ("2026-04"). `new Date("2026-10-04")` parses as UTC midnight, and a
 *    browser west of Greenwich then formats it as 3 October, so the screen
 *    would say the premium is due a day before the contract does. Every date
 *    here is built with Date.UTC and formatted with an explicit UTC timeZone.
 * 2. The locale is en-GB everywhere, hard-coded, never the browser's. The copy
 *    deck is British English ("4 October", not "October 4") and the product is
 *    one language.
 *
 * The worker flow also has no currency symbol, no percent glyph, and uses the
 * ASCII hyphen-minus U+002D for negatives.
 */

const LOCALE = 'en-GB';

/** ASCII hyphen-minus. Some locales format a negative with U+2212. */
const MINUS = '-';

/** Horizontal ellipsis, the character the sheet uses to shorten an address. */
const ELLIPSIS = '…';

/** Intl can emit U+2212 for a negative; the sheet asks for U+002D. */
function asciiMinus(value: string): string {
  return value.replace(/−/g, MINUS);
}

function utcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

function parseIsoDay(iso: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) throw new RangeError(`Not a date-only string: ${iso}`);
  return utcDate(Number(match[1]), Number(match[2]), Number(match[3]));
}

function parseIsoPeriod(period: string): Date {
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (!match) throw new RangeError(`Not a period: ${period}`);
  return utcDate(Number(match[1]), Number(match[2]), 1);
}

/** "2026-10-04" to "4 October". Day and month, for the next twelve months. */
export function formatDay(iso: string): string {
  return new Intl.DateTimeFormat(LOCALE, {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(parseIsoDay(iso));
}

/** "2027-09-04" to "4 September 2027". Used for maturity and term end. */
export function formatDayWithYear(iso: string): string {
  return new Intl.DateTimeFormat(LOCALE, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(parseIsoDay(iso));
}

/** "2026-04" to "April 2026". An index period, in prose. */
export function formatPeriod(period: string): string {
  return new Intl.DateTimeFormat(LOCALE, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(parseIsoPeriod(period));
}

/** "2024-09" to "Sep 2024". Chart axis labels only. */
export function formatPeriodShort(period: string): string {
  return new Intl.DateTimeFormat(LOCALE, {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(parseIsoPeriod(period));
}

function parseInstant(iso: string): Date {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) throw new RangeError(`Not an instant: ${iso}`);
  return at;
}

/**
 * An instant to "12 September, 08:36". UTC, like every other date here.
 *
 * The two date helpers above take a date-only string and refuse anything else,
 * because everything the API sends is a day or a month. A consensus timestamp is
 * neither: it is a moment, and on a page whose whole subject is what happened a
 * moment ago, the clock time is the figure. The year is left off because the
 * only page that prints these prints them beside how long ago they were.
 */
export function formatInstant(iso: string): string {
  return new Intl.DateTimeFormat(LOCALE, {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'UTC',
  })
    .format(parseInstant(iso))
    .replace(' at ', ', ');
}

/**
 * The span two instants cover: "12 September, 09:14 to 09:15", or both dates in
 * full when the span crosses midnight.
 *
 * It is what a line standing for several records says instead of a single
 * moment. Two things are left out because they carry no information and cost
 * the row its width: the day is not repeated inside one day, and a span whose
 * two ends land in the same minute is written as that one minute rather than as
 * "09:28 to 09:28", which reads like a rendering fault.
 */
export function formatSpan(from: string, to: string): string {
  const start = parseInstant(from);
  const end = parseInstant(to);
  const started = formatInstant(from);
  if (started === formatInstant(to)) return started;
  const sameDay = start.toISOString().slice(0, 10) === end.toISOString().slice(0, 10);
  return `${started} to ${sameDay ? clockOf(end) : formatInstant(to)}`;
}

function clockOf(at: Date): string {
  return new Intl.DateTimeFormat(LOCALE, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'UTC',
  }).format(at);
}

/** Whole UTC calendar days from one instant's date to another's. */
function utcDaysBetween(from: Date, to: Date): number {
  const midnight = (at: Date): number =>
    Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate());
  return Math.max(0, Math.round((midnight(to) - midnight(from)) / 86_400_000));
}

/**
 * How long ago an instant was: "just now", "4 minutes ago", "3 hours ago",
 * "yesterday", "6 days ago".
 *
 * The moment it is measured against is passed in rather than read from the
 * clock, so the server renders one consistent age for every line on a page and
 * a test can state what it expects. Anything under a minute is "just now": a
 * count of seconds on a page that is not going to update itself would be wrong
 * by the time it is read.
 *
 * Past today the count is calendar days and not elapsed hours divided by
 * twenty four, which is the whole of the difference between this and what it
 * used to do. Flooring the hours made the age depend on the clock time inside
 * the day, so on 12 September a record from 10 September at 22:50 read "1 day
 * ago" and one from 10 September at 08:32 read "2 days ago", one above the
 * other, both captioned with the same date. Every arithmetic step of that was
 * right and the column was unreadable. A day is the day it happened on, so two
 * records from one day are the same age however far apart in it they fell.
 *
 * Hours are kept for today alone, where they are what a reader wants and where
 * there is no day boundary for them to disagree across. The day before today is
 * "yesterday" rather than "1 day ago" for the same reason the rest of this
 * changed: a record from 23:55 read half an hour later is not a day old, and
 * saying so would be the old fault the other way round.
 */
export function formatAge(iso: string, now: number): string {
  const at = parseInstant(iso);
  const seconds = Math.max(0, Math.round((now - at.getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes)} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
  const days = utcDaysBetween(at, new Date(now));
  if (days === 0) {
    const hours = Math.floor(minutes / 60);
    return `${String(hours)} ${hours === 1 ? 'hour' : 'hours'} ago`;
  }
  if (days === 1) return 'yesterday';
  return `${String(days)} days ago`;
}

/**
 * Minor units to a money string: two decimals, thousands separators, no
 * currency symbol. The settlement asset has 6 decimals, so 28.00 is 28000000
 * minor units. Accepts a bigint because a balance does not fit a safe integer
 * once the principal is in the hundreds of thousands.
 */
export function formatMoney(minorUnits: bigint | number, decimals = 6): string {
  const minor = typeof minorUnits === 'bigint' ? minorUnits : BigInt(Math.round(minorUnits));
  const negative = minor < 0n;
  const magnitude = negative ? -minor : minor;
  const scale = 10n ** BigInt(decimals);
  const whole = magnitude / scale;
  const fraction = magnitude % scale;

  // Round half up to two decimals without going through a float.
  const hundredths = decimals <= 2
    ? fraction * 10n ** BigInt(2 - decimals)
    : (fraction * 100n + scale / 2n) / scale;
  const carried = hundredths >= 100n;
  const units = carried ? whole + 1n : whole;
  const cents = carried ? hundredths - 100n : hundredths;

  const grouped = new Intl.NumberFormat(LOCALE, { useGrouping: true }).format(units);
  return `${negative ? MINUS : ''}${grouped}.${cents.toString().padStart(2, '0')}`;
}

/**
 * The same money at the settlement asset's own precision, so a column of these
 * adds up to the total printed over it: "328.767123", "1,994.520546", "3,000.00".
 *
 * `formatMoney` rounds to two decimals, and a coupon is not a two decimal
 * number. A month's coupon on this note is 328.767123, because it is a year's
 * interest cut by the days in the month, and rounding it for display while
 * totalling the minor units is what made the investor screen disagree with
 * itself: six settled rows read 328.77 and 339.73 and summed to 1,994.54 under
 * a headline that said 1,994.52. Both figures were right, which is worse than
 * one of them being wrong, on the one page whose argument is that its figures
 * reconcile to the chain.
 *
 * Allocating the rounding so the rows add to the total was the other way out
 * and is not taken. It would print 339.72 against a row whose HashScan receipt
 * says 339.726027, and the receipt is beside it on the same line. So the rows
 * say what actually moved, the total says the sum of what actually moved, and
 * the column adds up because there is nothing left over to lose.
 *
 * Trailing zeros past the second decimal are dropped, so money that is whole
 * cents is written as whole cents and the precision appears only where there is
 * something in it. Never fewer than two decimals: money is written with cents
 * even when the cents are nought.
 */
export function formatExactMoney(minorUnits: bigint | number, decimals = 6): string {
  const minor = typeof minorUnits === 'bigint' ? minorUnits : BigInt(Math.round(minorUnits));
  const negative = minor < 0n;
  const magnitude = negative ? -minor : minor;
  const scale = 10n ** BigInt(decimals);

  let fraction = (magnitude % scale).toString().padStart(Math.max(0, decimals), '0');
  while (fraction.length > 2 && fraction.endsWith('0')) fraction = fraction.slice(0, -1);
  fraction = fraction.padEnd(2, '0');

  const grouped = new Intl.NumberFormat(LOCALE, { useGrouping: true }).format(magnitude / scale);
  return `${negative ? MINUS : ''}${grouped}.${fraction}`;
}

/**
 * The same money, written the way the investor copy deck writes a principal:
 * "100,000" rather than "100,000.00". The decimals come back the moment there
 * is a fraction to show, so a part payment of 92,500.25 is never rounded away
 * into a figure that looks whole. Coupon amounts stay on formatMoney, because
 * a coupon is money at the money scale and is two decimals by the sheet's own
 * rule.
 */
export function formatWholeMoney(minorUnits: bigint | number, decimals = 6): string {
  const minor = typeof minorUnits === 'bigint' ? minorUnits : BigInt(Math.round(minorUnits));
  const scale = 10n ** BigInt(decimals);
  if (minor % scale !== 0n) return formatMoney(minor, decimals);
  const negative = minor < 0n;
  const units = (negative ? -minor : minor) / scale;
  const grouped = new Intl.NumberFormat(LOCALE, { useGrouping: true }).format(units);
  return `${negative ? MINUS : ''}${grouped}`;
}

/**
 * A whole cover amount: thousands separators, no decimals. The slider's 1,000
 * to 10,000 range and the "5,000" in the copy deck.
 */
export function formatAmount(value: number): string {
  return asciiMinus(
    new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 }).format(value),
  );
}

/**
 * An index value: two decimals always, including trailing zeros, and U+002D
 * for a negative. "0.30", never "0.3"; "-0.68", never "-.68". The API sends
 * these already at two decimals as strings; this normalises either form.
 */
export function formatIndexValue(value: number | string): string {
  const numeric = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(numeric)) throw new RangeError(`Not an index value: ${String(value)}`);
  const negative = numeric < 0 || Object.is(numeric, -0);
  const body = Math.abs(numeric).toFixed(2);
  return `${negative && Number(body) !== 0 ? MINUS : ''}${body}`;
}

/**
 * A percentage as a word. The worker flow never renders the % glyph and the
 * investor copy deck spells it out too.
 */
export function formatPercent(value: number): string {
  const rounded = Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
  return `${asciiMinus(rounded)} percent`;
}

/**
 * An address shortened to the first 4 and the last 4, joined with U+2026:
 * "0x7A3F…D21B". The leading 0x is not one of the four.
 */
export function shortenAddress(address: string): string {
  const prefix = address.startsWith('0x') || address.startsWith('0X') ? address.slice(0, 2) : '';
  const body = address.slice(prefix.length);
  if (body.length <= 8) return address;
  return `${prefix}${body.slice(0, 4)}${ELLIPSIS}${body.slice(-4)}`;
}

export { ELLIPSIS, MINUS };
