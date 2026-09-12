import { ulid } from 'ulid';
import { decodeBytes32String, encodeBytes32String } from 'ethers';

/// Identifiers, in one place.
///
/// Three forms have to agree: the JSON id a caller sees, the Postgres primary
/// key and the `bytes32` the contracts take. They agree because the JSON id is
/// the on-chain value: `encodeBytes32String` right pads an ASCII string of at
/// most 31 bytes into 32, so `pol_` plus a 26 character ULID is 30 bytes and
/// every `bytes32` in a HashScan event log decodes back to something a person
/// can read.
///
/// ULIDs rather than UUIDs: a UUID in text form is 36 characters, which with a
/// prefix does not fit, and its hex form reads as noise on chain. A ULID also
/// sorts by creation time, so a listing's default order is free.

export const ID_PREFIXES = {
  policy: 'pol',
  quote: 'qte',
  payment: 'pay',
  credential: 'elg',
  claim: 'clm',
  evidence: 'evd',
  /** One commitment of capital to one experience band of one series. */
  bandSubscription: 'bsb',
} as const;

export type IdKind = keyof typeof ID_PREFIXES;

/** The longest identifier this encoding can carry, in bytes. */
export const MAX_BYTES32_STRING = 31;

/** A fresh prefixed id, for example `pol_01K4YB9X3M8Q0RZ7T2VD6C5H9E`. */
export function newId(kind: IdKind, at: number = Date.now()): string {
  return `${ID_PREFIXES[kind]}_${ulid(at)}`;
}

/** True when the id carries the prefix this route wanted. */
export function hasPrefix(id: string, kind: IdKind): boolean {
  return id.startsWith(`${ID_PREFIXES[kind]}_`);
}

/**
 * The `bytes32` form of an identifier or a series label.
 *
 * Throws rather than truncating. A silently truncated identifier is two
 * different policies that share one on-chain key.
 */
export function toBytes32(value: string): string {
  if (Buffer.byteLength(value, 'utf8') > MAX_BYTES32_STRING) {
    throw new Error(`${value} is longer than ${MAX_BYTES32_STRING} bytes and cannot be a bytes32`);
  }
  return encodeBytes32String(value);
}

/** The inverse, for reading an event log or a contract view back. */
export function fromBytes32(value: string): string {
  return decodeBytes32String(value);
}

/**
 * The nullifier as the contracts take it.
 *
 * World's nullifier is a decimal integer string, and that is what the database
 * stores, because two rows differing only in hex casing are two identities to a
 * text index. On chain it is a `bytes32`, so it is the big-endian 32 byte form
 * of the same integer rather than an ASCII encoding.
 */
export function nullifierToBytes32(nullifier: string): string {
  const value = BigInt(nullifier);
  if (value < 0n) throw new Error('a nullifier is a non-negative integer');
  return `0x${value.toString(16).padStart(64, '0')}`;
}
