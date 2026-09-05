/// Normalisation, in code, before any comparison.
///
/// The model returns what the document says. The rules compare normalised
/// forms. Both halves are needed: normalising inside the prompt would make the
/// model's answer untestable against the document in front of it.

/** Legal suffixes stripped before two employer names are compared. */
const LEGAL_SUFFIXES = new Set([
  'ltd',
  'limited',
  'llc',
  'llp',
  'inc',
  'incorporated',
  'plc',
  'gmbh',
  'sa',
  'srl',
  'bv',
  'pty',
  'co',
  'corp',
  'corporation',
  'company',
]);

/**
 * Lowercase, trim, collapse whitespace, drop punctuation, then drop a trailing
 * legal suffix and a leading "the".
 *
 * `employer_hash` in the packet manifest is sha256 of the lowercased trimmed
 * attestation value and is deliberately not this: one definition, one place.
 * This form exists only to compare two strings written by two people.
 */
export function normaliseEmployer(value: string | null): string {
  const tokens = tokenise(value);
  while (tokens.length > 1 && LEGAL_SUFFIXES.has(tokens[tokens.length - 1] as string)) {
    tokens.pop();
  }
  if (tokens.length > 1 && tokens[0] === 'the') tokens.shift();
  return tokens.join(' ');
}

/** The same treatment for a person's name, without the company suffixes. */
export function normaliseName(value: string | null): string {
  return tokenise(value).join(' ');
}

function tokenise(value: string | null): string[] {
  if (value === null) return [];
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((token) => token !== '');
}

export type MatchKind = 'match' | 'near_match' | 'mismatch' | 'absent';

/** How much of the two token sets is shared, as the Sorensen-Dice coefficient. */
export const NEAR_MATCH_RATIO = 0.9;

export function tokenSetRatio(left: string, right: string): number {
  const a = new Set(left.split(' ').filter((token) => token !== ''));
  const b = new Set(right.split(' ').filter((token) => token !== ''));
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return (2 * shared) / (a.size + b.size);
}

/** True when every token of the shorter name also appears in the longer one. */
export function oneContainsTheOther(left: string, right: string): boolean {
  const a = new Set(left.split(' ').filter((token) => token !== ''));
  const b = new Set(right.split(' ').filter((token) => token !== ''));
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  // One shared word is a coincidence. Two is a name with a qualifier on it.
  if (small.size < 2) return false;
  for (const token of small) if (!large.has(token)) return false;
  return true;
}

/**
 * Two employer names, compared.
 *
 * A near match refers, it does not decline. "Northgate Systems (UK) Ltd"
 * against "Northgate Systems Ltd" is a real person's real uncertainty about
 * their own employer's legal name, and it is not fraud. The Dice coefficient
 * alone puts that pair at 0.80, because one extra token in a short name moves
 * it a long way, so a containment test sits beside it: a name that is the other
 * name plus a qualifier is a near match whatever the ratio says.
 */
export function compareEmployer(documentValue: string | null, attested: string): MatchKind {
  if (documentValue === null) return 'absent';
  const left = normaliseEmployer(documentValue);
  const right = normaliseEmployer(attested);
  if (left === '' || right === '') return 'absent';
  if (left === right) return 'match';
  return tokenSetRatio(left, right) >= NEAR_MATCH_RATIO || oneContainsTheOther(left, right)
    ? 'near_match'
    : 'mismatch';
}

/**
 * Names compare the same way, except that one name of two, or an initial
 * against a full first name, is a partial rather than a mismatch: "A. Mercer"
 * on a letter and "Alex Mercer" on the statement is the same person.
 */
export function compareName(documentValue: string | null, attested: string | null): MatchKind {
  if (documentValue === null || attested === null) return 'absent';
  const left = normaliseName(documentValue);
  const right = normaliseName(attested);
  if (left === '' || right === '') return 'absent';
  if (left === right) return 'match';
  const leftTokens = left.split(' ');
  const rightTokens = right.split(' ');
  const surnameShared =
    leftTokens[leftTokens.length - 1] === rightTokens[rightTokens.length - 1];
  if (surnameShared && initialsAgree(leftTokens, rightTokens)) return 'near_match';
  return tokenSetRatio(left, right) >= NEAR_MATCH_RATIO ? 'near_match' : 'mismatch';
}

function initialsAgree(left: string[], right: string[]): boolean {
  const a = left[0] ?? '';
  const b = right[0] ?? '';
  if (a === '' || b === '') return false;
  return a === b || a.startsWith(b) || b.startsWith(a);
}

/** Whole days between two ISO dates, absolute. Both are UTC midnights. */
export function daysApart(left: string, right: string): number {
  const a = Date.parse(`${left}T00:00:00Z`);
  const b = Date.parse(`${right}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.POSITIVE_INFINITY;
  return Math.abs(a - b) / 86_400_000;
}

/**
 * The instant a separation happened, as everything downstream reads it: UTC
 * midnight at the start of the last day of work.
 *
 * Stated once and used everywhere, because the EIP-712 authorisation signs
 * `separationAt` as a uint64 and the contract derives the month from it. A
 * midday-local convention would push a separation on the last day of a month
 * into the next month for some timezones, which costs a payout.
 */
export function separationAt(lastDayOfWork: string): Date {
  return new Date(`${lastDayOfWork}T00:00:00Z`);
}

/** The month a date falls in, as the period string the window rules compare. */
export function periodOf(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** `2026-04` plus two months is `2026-06`. Months, not days: no day arithmetic. */
export function addMonths(period: string, months: number): string {
  const [year, month] = period.split('-').map(Number) as [number, number];
  const index = year * 12 + (month - 1) + months;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** Month order without parsing a date: the period strings sort lexically. */
export function comparePeriods(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** The YYYYMM integer the contracts speak, from a YYYY-MM period string. */
export function toYyyymm(period: string): number {
  return Number(period.replace('-', ''));
}

/** The inverse, for reading `openMonths` back off the chain. */
export function fromYyyymm(period: number): string {
  const text = String(period).padStart(6, '0');
  return `${text.slice(0, 4)}-${text.slice(4)}`;
}
