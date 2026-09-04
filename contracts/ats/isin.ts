import { createHash } from 'node:crypto';

/// The ISIN is validated on chain. isinValidator.sol checks the length is
/// exactly twelve bytes and that the last character is the ISO 6166 mod 10
/// check digit, and reverts WrongISIN or WrongISINChecksum otherwise. The SDK
/// does not run the check digit, so a wrong one passes client validation and
/// fails on chain with nothing to read. Every ISIN this build uses comes from
/// here.

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/// ISO 6166 expands each letter to its ordinal with A as 10 and Z as 35, which
/// turns an eleven character body into thirteen or more digits, then runs the
/// Luhn rule over those digits.
function expand(body: string): string {
  let digits = '';
  for (const character of body) {
    const value = ALPHABET.indexOf(character);
    if (value < 0) throw new Error(`ISIN body must be alphanumeric and uppercase, got "${body}"`);
    digits += String(value);
  }
  return digits;
}

/// The Luhn check digit over the expanded body. Doubling starts at the
/// rightmost expanded digit, which is the one the check digit will sit next to,
/// not at the rightmost character of the body.
export function isinCheckDigit(body: string): number {
  const digits = expand(body);
  let sum = 0;
  for (let index = 0; index < digits.length; index += 1) {
    const digit = Number(digits[digits.length - 1 - index]);
    const doubled = index % 2 === 0 ? digit * 2 : digit;
    sum += doubled > 9 ? doubled - 9 : doubled;
  }
  return (10 - (sum % 10)) % 10;
}

export function isValidIsin(isin: string): boolean {
  if (!/^[A-Z]{2}[0-9A-Z]{9}[0-9]$/.test(isin)) return false;
  return isinCheckDigit(isin.slice(0, 11)) === Number(isin[11]);
}

/// A structurally valid test identifier, not a registered one. ZZ is
/// user assigned in ISO 3166, so no national numbering agency can ever issue a
/// real ISIN under it; the rest is the four leading alphanumerics of the series
/// label followed by five characters of the base36 SHA-256 of the same label,
/// so the value is reproducible from the series id alone.
export function testIsinFor(seriesLabel: string): string {
  const alphanumeric = seriesLabel.toUpperCase().replace(/[^0-9A-Z]/g, '');
  const head = alphanumeric.slice(0, 4).padEnd(4, '0');
  const hash = createHash('sha256').update(seriesLabel).digest('hex');
  const tail = BigInt(`0x${hash}`).toString(36).toUpperCase().slice(0, 5).padEnd(5, '0');
  const body = `ZZ${head}${tail}`;
  return `${body}${isinCheckDigit(body)}`;
}
