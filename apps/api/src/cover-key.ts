import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/// The cover key: a bearer key to one cover, and nothing else.
///
/// It exists because the World check is not always available. No World App to
/// hand, a simulator that cannot produce the configured credential, a judge
/// with neither: the key is the way back into a dashboard for all three, and it
/// is the only way that can be exercised today.
///
/// Three properties decide the shape.
///
/// It is guessed or it is not. Twelve random bytes is ninety six bits, so a
/// caller guessing against this API is not going to find one.
///
/// It says nothing about the person. There is no policy id in it, no wallet, no
/// nullifier and no timestamp: it is random bytes and the database holds the
/// mapping. A key that carried its policy id would be a longer key that also
/// told a reader which cover it opened before it was used.
///
/// It is typed by a person, off a screen, so the alphabet is Crockford's base
/// 32: no U, and I, L and O read back as 1, 1 and 0. Twelve bytes is twenty
/// characters, printed in groups of four and accepted with or without them.
///
/// https://www.crockford.com/base32.html

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Twelve bytes, which is twenty characters of base 32. */
const KEY_BYTES = 12;
export const COVER_KEY_LENGTH = 20;

/** A fresh key and the digest the database stores for it. */
export interface NewCoverKey {
  /** Shown to the person once. Never stored anywhere in this process. */
  readonly key: string;
  readonly hash: string;
}

export function newCoverKey(): NewCoverKey {
  const key = encode(randomBytes(KEY_BYTES));
  return { key, hash: coverKeyHash(key) };
}

/**
 * The digest the `cover_keys` table is keyed by.
 *
 * The key itself is never written down: a table of live bearer keys is a table
 * worth stealing, and a digest of one is not. This is the same reasoning the
 * API already applies to an admin token, and the lookup is a primary key read
 * either way.
 */
export function coverKeyHash(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

/** Constant time equality over two digests, for a comparison that is not a lookup. */
export function sameCoverKey(a: string, b: string): boolean {
  const left = Buffer.from(coverKeyHash(a), 'hex');
  const right = Buffer.from(coverKeyHash(b), 'hex');
  return timingSafeEqual(left, right);
}

/**
 * The canonical form of something a person typed, or null when it is not a key.
 *
 * Spaces, hyphens and underscores are separators and go. Case does not matter.
 * I and L are 1 and O is 0, because that is what a reader meant. Anything else
 * outside the alphabet makes it not a key, rather than being dropped: silently
 * ignoring a character is how a typo becomes a lookup for somebody else's key.
 */
export function normaliseCoverKey(input: string): string | null {
  const stripped = input.replace(/[\s\-_]/g, '').toUpperCase();
  let out = '';
  for (const character of stripped) {
    const mapped = character === 'O' ? '0' : character === 'I' || character === 'L' ? '1' : character;
    if (!ALPHABET.includes(mapped)) return null;
    out += mapped;
  }
  return out.length === COVER_KEY_LENGTH ? out : null;
}

/** The key in groups of four, which is how a screen prints it. */
export function groupCoverKey(key: string): string {
  return (key.match(/.{1,4}/g) ?? []).join(' ');
}

/** Big endian base 32 over the whole buffer, left padded to the fixed length. */
function encode(bytes: Buffer): string {
  let value = BigInt(`0x${bytes.toString('hex')}`);
  let out = '';
  for (let position = 0; position < COVER_KEY_LENGTH; position += 1) {
    out = ALPHABET[Number(value % 32n)] + out;
    value /= 32n;
  }
  return out;
}
