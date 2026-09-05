import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { AppError } from '../errors.js';

/// Evidence at rest.
///
/// DESIGN.md 3.9: "Files are encrypted at rest in the API's store. Only the
/// SHA-256 of each file goes to the claims topic." This is that store, and it
/// is here rather than in the route that writes it because T13 writes with it
/// and the admin read path reads with it, and two implementations of an
/// envelope are two implementations of a mistake.
///
/// Envelope encryption, which is what the columns of `claim_evidence` already
/// describe. Each file gets a fresh 256 bit data key. The file is encrypted
/// with AES-256-GCM under that key, giving `enc_iv` and `enc_tag`. The data key
/// is then itself encrypted under a key encryption key held only in the
/// environment, and the wrapped result is `enc_dek`; `enc_kek_id` names which
/// KEK wrapped it, so a rotation is a new id beside the old one rather than a
/// migration of every file.
///
/// The wrapped data key carries its own nonce and tag inside its bytes, in the
/// order iv || tag || ciphertext, because the row has one `enc_iv` and one
/// `enc_tag` column and those belong to the file.
///
/// The plaintext SHA-256 is what the claimant can recompute from the file on
/// their own machine, so that is what is stored and what reaches the topic.
/// Never the ciphertext's.

export const ENVELOPE_ALGORITHM = 'AES-256-GCM';
const CIPHER = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export interface EvidenceKeys {
  /** The active key encryption key, and every key an old row might name. */
  keks: Map<string, Buffer>;
  activeKekId: string;
}

export interface EncryptedEvidence {
  /** `sha256:<hex>` over the plaintext. */
  sha256: string;
  objectKey: string;
  encIv: Buffer;
  encTag: Buffer;
  encDek: Buffer;
  encKekId: string;
  sizeBytes: number;
  ciphertext: Buffer;
}

/**
 * Read the key encryption keys from the environment.
 *
 * `EVIDENCE_KEK` is the active key, base64 of 32 bytes, named by
 * `EVIDENCE_KEK_ID`. `EVIDENCE_KEK_RETIRED` optionally carries older keys as
 * `id:base64` pairs, comma separated, so a rotation can still read what the
 * previous key wrapped.
 *
 * Returns null when no key is configured, which is a deployment that can serve
 * every read and refuses to accept or hand back a document. That is the honest
 * failure: a store with no key is not a store.
 */
export function loadEvidenceKeys(env: NodeJS.ProcessEnv = process.env): EvidenceKeys | null {
  const active = env['EVIDENCE_KEK'];
  if (active === undefined || active.trim() === '') return null;
  const activeKekId = env['EVIDENCE_KEK_ID']?.trim() ?? 'kek-1';
  const keks = new Map<string, Buffer>([[activeKekId, decodeKey(active, activeKekId)]]);
  for (const pair of (env['EVIDENCE_KEK_RETIRED'] ?? '').split(',')) {
    const trimmed = pair.trim();
    if (trimmed === '') continue;
    const at = trimmed.indexOf(':');
    if (at < 1) throw new Error('EVIDENCE_KEK_RETIRED takes id:base64 pairs, comma separated');
    const id = trimmed.slice(0, at);
    keks.set(id, decodeKey(trimmed.slice(at + 1), id));
  }
  return { keks, activeKekId };
}

function decodeKey(value: string, id: string): Buffer {
  const key = Buffer.from(value.trim(), 'base64');
  if (key.byteLength !== KEY_BYTES) {
    throw new Error(`the evidence key ${id} must be ${KEY_BYTES} bytes of base64`);
  }
  return key;
}

/** The store root. Under var/ by default, which is not committed. */
export function evidenceRoot(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(env['EVIDENCE_STORE'] ?? 'var/evidence');
}

/** Where one file lives, relative to the root. One directory per claim. */
export function objectKeyFor(claimId: string, evidenceId: string): string {
  return `${claimId}/${evidenceId}.bin`;
}

/** Encrypt one file and return everything the row and the object store need. */
export function sealEvidence(
  keys: EvidenceKeys,
  claimId: string,
  evidenceId: string,
  plaintext: Buffer,
): EncryptedEvidence {
  const kek = keys.keks.get(keys.activeKekId);
  if (kek === undefined) throw new Error('the active evidence key is not loaded');

  const dek = randomBytes(KEY_BYTES);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(CIPHER, dek, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);

  const wrapIv = randomBytes(IV_BYTES);
  const wrap = createCipheriv(CIPHER, kek, wrapIv);
  const wrapped = Buffer.concat([wrap.update(dek), wrap.final()]);

  return {
    sha256: `sha256:${createHash('sha256').update(plaintext).digest('hex')}`,
    objectKey: objectKeyFor(claimId, evidenceId),
    encIv: iv,
    encTag: cipher.getAuthTag(),
    encDek: Buffer.concat([wrapIv, wrap.getAuthTag(), wrapped]),
    encKekId: keys.activeKekId,
    sizeBytes: plaintext.byteLength,
    ciphertext,
  };
}

export interface SealedRow {
  objectKey: string;
  encIv: Buffer;
  encTag: Buffer;
  encDek: Buffer;
  encKekId: string;
}

/** Decrypt one file, given its row and its bytes. */
export function openEvidence(keys: EvidenceKeys, row: SealedRow, ciphertext: Buffer): Buffer {
  const kek = keys.keks.get(row.encKekId);
  if (kek === undefined) {
    throw new AppError(
      503,
      'evidence_key_missing',
      'Evidence key missing',
      `This deployment holds no key named ${row.encKekId}, so it cannot open that file.`,
    );
  }
  const wrapIv = row.encDek.subarray(0, IV_BYTES);
  const wrapTag = row.encDek.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const wrapped = row.encDek.subarray(IV_BYTES + TAG_BYTES);
  const unwrap = createDecipheriv(CIPHER, kek, wrapIv);
  unwrap.setAuthTag(wrapTag);
  const dek = Buffer.concat([unwrap.update(wrapped), unwrap.final()]);

  const decipher = createDecipheriv(CIPHER, dek, row.encIv);
  decipher.setAuthTag(row.encTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/// A single attestation field, sealed under the key encryption key directly.
///
/// The claim row has one bytea per field and no room for a nonce column, so the
/// blob is self describing: a one byte key id length, the key id, the nonce,
/// the tag, then the ciphertext. That makes a rotation a new id beside the old
/// one, exactly as it is for a file.

export function sealField(keys: EvidenceKeys, plaintext: string): Buffer {
  const kek = keys.keks.get(keys.activeKekId);
  if (kek === undefined) throw new Error('the active evidence key is not loaded');
  const id = Buffer.from(keys.activeKekId, 'utf8');
  if (id.byteLength > 255) throw new Error('an evidence key id is at most 255 bytes');
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(CIPHER, kek, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([Buffer.from([id.byteLength]), id, iv, cipher.getAuthTag(), ciphertext]);
}

export function openField(keys: EvidenceKeys, blob: Buffer): string {
  const idLength = blob[0] ?? 0;
  const id = blob.subarray(1, 1 + idLength).toString('utf8');
  const kek = keys.keks.get(id);
  if (kek === undefined) {
    throw new AppError(
      503,
      'evidence_key_missing',
      'Evidence key missing',
      `This deployment holds no key named ${id}, so it cannot open that field.`,
    );
  }
  const at = 1 + idLength;
  const iv = blob.subarray(at, at + IV_BYTES);
  const tag = blob.subarray(at + IV_BYTES, at + IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(CIPHER, kek, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(blob.subarray(at + IV_BYTES + TAG_BYTES)),
    decipher.final(),
  ]).toString('utf8');
}

/// The object half of the store: the local filesystem under `var/`. It is
/// behind an interface so that a deployment with a bucket swaps one class and
/// the routes do not change.

export interface ObjectStore {
  put(objectKey: string, bytes: Buffer): Promise<void>;
  get(objectKey: string): Promise<Buffer>;
}

export class FileObjectStore implements ObjectStore {
  constructor(private readonly root: string = evidenceRoot()) {}

  async put(objectKey: string, bytes: Buffer): Promise<void> {
    const path = this.pathOf(objectKey);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes);
  }

  async get(objectKey: string): Promise<Buffer> {
    try {
      return readFileSync(this.pathOf(objectKey));
    } catch {
      throw new AppError(
        404,
        'evidence_not_found',
        'Evidence not found',
        'That file is recorded on the claim but is not in the store.',
      );
    }
  }

  /** A key can never escape the root, whatever a row happens to contain. */
  private pathOf(objectKey: string): string {
    const path = resolve(join(this.root, objectKey));
    if (path !== this.root && !path.startsWith(`${this.root}/`)) {
      throw new Error(`the object key ${objectKey} points outside the evidence store`);
    }
    return path;
  }
}

/** The in-process store the unit tests drive. Nothing reaches a disk. */
export class MemoryObjectStore implements ObjectStore {
  private readonly objects = new Map<string, Buffer>();

  async put(objectKey: string, bytes: Buffer): Promise<void> {
    this.objects.set(objectKey, bytes);
  }

  async get(objectKey: string): Promise<Buffer> {
    const found = this.objects.get(objectKey);
    if (found === undefined) {
      throw new AppError(
        404,
        'evidence_not_found',
        'Evidence not found',
        'That file is recorded on the claim but is not in the store.',
      );
    }
    return found;
  }
}
