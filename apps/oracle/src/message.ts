import {
  canonicalize,
  sha256Hex,
  type JsonValue,
  type Observation,
  type OpenReason,
  type ObservationStatus,
  type Period,
} from '@creance/index-model';
import { SigningKey, computeAddress, recoverAddress } from 'ethers';

/**
 * The v2 observation message: what goes on the index topic, how it is
 * canonicalised, and how it is signed.
 *
 * docs/INDEX-SPEC.md section 7 is the schema. Two things about this
 * implementation are worth reading before consuming a message.
 *
 * The compact provenance form. The specification offers `source_files`, an
 * array of objects; DESIGN.md 3.3 offers a single `source` plus `source_hash`.
 * This build publishes the compact pair, because the archive path uses six
 * source files and the array form pushes a message past the 1 KB cap that
 * makes an HCS message a single chunk. The full file list, with a sha256 and a
 * byte count for each, is kept beside the message in the observation store and
 * is what the provenance QA gate reads. `source_hash` is not the hash of a
 * response body: it is the sha256 of the JCS form of the extracted source rows
 * the computation actually used, so two runs over the same published data
 * produce the same hash even though the two response bodies differ.
 *
 * The signature. `sig` is a secp256k1 signature by the oracle key over
 * sha256 of the canonical JSON of the message with `sig` removed. It is
 * serialised as 65 bytes, r then s then v, hex with an 0x prefix, which is the
 * form `ethers.recoverAddress` takes. A verifier therefore: drops `sig`,
 * canonicalises what is left with JCS (RFC 8785), sha256 hashes it, and
 * recovers the address, which must be the oracle account's EVM address. No
 * EIP-191 prefix and no EIP-712 domain are involved; the digest is the plain
 * hash of the bytes on the topic.
 */

/** HCS accepts more, but a message over 1 KB stops being a single chunk. */
export const MAX_MESSAGE_BYTES = 1024;

/**
 * The published statuses. `no_source` is this build's addition to the
 * specification's three: the 2025 lapse in appropriations means October 2025
 * was never collected for any LN series, and a month with no source value at
 * all is a different fact from a month whose smoothing window is incomplete.
 * Saying so is more use to a reader than flattening both into one word.
 */
export type MessageStatus = ObservationStatus | 'revision';

export interface ObservationMessage {
  v: 2;
  /** The cover series this settles, or null for a group with no series yet. */
  series: string | null;
  group: string;
  period: Period;
  u_g: number | null;
  u_all: number | null;
  e: number | null;
  ebar: number | null;
  odi: number | null;
  attachment_shock: number;
  level_line: number;
  open: boolean;
  open_reason: OpenReason;
  status: MessageStatus;
  /** The sequence number a revision record supersedes. Null on a first value. */
  revises_seq: number | null;
  model_version: string;
  /** `bls:LNU04034021`, the series the group's rate came from. */
  source: string;
  /** sha256 of the JCS form of the source rows used, hex, no prefix. */
  source_hash: string;
  computed_at: string;
  sig: string;
}

/** Everything the message carries that the observation itself does not. */
export interface MessageContext {
  seriesLabel: string | null;
  blsSeriesId: string;
  sourceHash: string;
  modelVersion: string;
  computedAt: Date;
  revisesSeq?: number | null;
  status?: MessageStatus;
}

/** An unsigned message is the same object with an empty signature. */
export type UnsignedMessage = Omit<ObservationMessage, 'sig'>;

export function buildMessage(
  observation: Observation,
  context: MessageContext,
): UnsignedMessage {
  return {
    v: 2,
    series: context.seriesLabel,
    group: observation.groupKey,
    period: observation.period,
    u_g: observation.uG,
    u_all: observation.uAll,
    e: observation.e,
    ebar: observation.ebar,
    odi: observation.odi,
    attachment_shock: observation.attachmentShock,
    level_line: observation.levelLine,
    open: observation.open,
    open_reason: observation.openReason,
    status: context.status ?? observation.status,
    revises_seq: context.revisesSeq ?? null,
    model_version: context.modelVersion,
    source: `bls:${context.blsSeriesId}`,
    source_hash: context.sourceHash,
    // Seconds, with a Z. Milliseconds would make two runs over the same data
    // differ in a field that means nothing to a reader.
    computed_at: `${context.computedAt.toISOString().slice(0, 19)}Z`,
  };
}

/** The bytes a signature covers: the message without `sig`, canonicalised. */
export function signingPayload(message: UnsignedMessage | ObservationMessage): string {
  const rest = { ...(message as ObservationMessage) } as Record<string, unknown>;
  delete rest.sig;
  return canonicalize(rest as JsonValue);
}

/** The 32 byte digest that is actually signed, hex with an 0x prefix. */
export function signingDigest(message: UnsignedMessage | ObservationMessage): string {
  return `0x${sha256Hex(signingPayload(message))}`;
}

export function signMessage(
  message: UnsignedMessage,
  privateKeyHex: string,
): ObservationMessage {
  const key = new SigningKey(`0x${privateKeyHex.replace(/^0x/i, '')}`);
  return { ...message, sig: key.sign(signingDigest(message)).serialized };
}

/** The address that signed a message, for a verifier that has one. */
export function recoverSigner(message: ObservationMessage): string {
  return recoverAddress(signingDigest(message), message.sig);
}

export function verifyMessage(message: ObservationMessage, expectedAddress: string): boolean {
  try {
    return recoverSigner(message).toLowerCase() === expectedAddress.trim().toLowerCase();
  } catch {
    return false;
  }
}

/** The EVM address of a raw signing key, for printing a run header. */
export function addressOfKey(privateKeyHex: string): string {
  return computeAddress(new SigningKey(`0x${privateKeyHex.replace(/^0x/i, '')}`));
}

/** Exactly the bytes that go on the topic: the canonical JSON, UTF-8. */
export function messageBytes(message: ObservationMessage): Buffer {
  return Buffer.from(canonicalize(message as unknown as JsonValue), 'utf8');
}

/** Fail before a submit rather than after, so nothing half lands on a topic. */
export function assertUnderCap(message: ObservationMessage): Buffer {
  const bytes = messageBytes(message);
  if (bytes.byteLength >= MAX_MESSAGE_BYTES) {
    throw new Error(
      `observation for ${message.group} ${message.period} is ${bytes.byteLength} bytes, over the ${MAX_MESSAGE_BYTES} byte cap`,
    );
  }
  return bytes;
}
