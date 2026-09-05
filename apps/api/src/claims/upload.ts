import { AppError } from '../errors.js';
import { newId } from '../ids.js';

/// The evidence a packet carries, on the way in.
///
/// Base64 inside the JSON body rather than multipart. The choice is worth a
/// sentence because it is a choice: every other route in this API takes JSON,
/// the Steward and the testnet scripts build their requests with `fetch` and no
/// form library, and `@fastify/multipart` would be a dependency and a second
/// body parser in front of the one endpoint where a mistake hands a stranger's
/// document to the wrong claim. Base64 costs a third more bytes on the wire for
/// files that are a page of A4.
///
/// The caps are here rather than in the route because they are part of the
/// contract: at most four files, at most 4 MB each once decoded, and the route
/// raises its own body limit to 24 MB, which is the encoded worst case with
/// room for the rest of the packet. The server's default limit is 64 KB and
/// stays that way for every other route.
///
/// The content type is sniffed from the bytes and not taken from the caller. A
/// file that says it is a PDF and is not would otherwise reach the model as a
/// document and come back as a confident reading of nothing.

export const MAX_EVIDENCE_FILES = 4;
export const MAX_EVIDENCE_BYTES = 4 * 1024 * 1024;
export const CLAIM_BODY_LIMIT = 24 * 1024 * 1024;

/// What a file may be: a PDF or one of the four image types the model reads,
/// which is the list in apps/adjuster/src/extract.ts. It is not a constant here
/// because `sniffContentType` below is the list, in the only form that matters:
/// what the bytes say, rather than what the caller claims.

/** The claimant's own label for a file. A hint to the rules, never a finding. */
export const EVIDENCE_KINDS = [
  'termination_letter',
  'benefit_determination',
  'final_pay_statement',
  'p45',
  'record_of_employment',
  'other',
] as const;

export interface UploadedEvidence {
  evidenceId: string;
  kind: string;
  filename: string;
  contentType: string;
  bytes: Buffer;
}

/** The bytes' own answer about what they are, or null when it is none of ours. */
export function sniffContentType(bytes: Buffer): string | null {
  if (bytes.length < 12) return null;
  if (bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) return 'application/pdf';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (bytes.subarray(0, 6).toString('latin1').startsWith('GIF8')) return 'image/gif';
  if (
    bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
    bytes.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

/** One file out of the body, checked and named. */
export function readEvidence(value: unknown, at: number, index: number): UploadedEvidence {
  const file = asObject(value, `evidence[${index}]`);
  const encoded = typeof file['content_base64'] === 'string' ? file['content_base64'] : '';
  if (encoded === '') throw bad(`evidence[${index}].content_base64`, 'the file, base64 encoded');
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.byteLength === 0) throw bad(`evidence[${index}].content_base64`, 'not valid base64');
  if (bytes.byteLength > MAX_EVIDENCE_BYTES) {
    throw new AppError(
      413,
      'evidence_too_large',
      'That file is too big',
      `A document may be up to ${MAX_EVIDENCE_BYTES / (1024 * 1024)} MB. Try a smaller scan.`,
    );
  }
  const sniffed = sniffContentType(bytes);
  if (sniffed === null) {
    throw new AppError(
      415,
      'evidence_type_unsupported',
      "We can't read that file",
      'Add a PDF or a photo of the document.',
    );
  }
  const kind = typeof file['kind'] === 'string' ? file['kind'] : 'other';
  return {
    // The id is minted here, not accepted, so a caller cannot choose where its
    // ciphertext lands in the store.
    evidenceId: newId('evidence', at + index),
    kind: (EVIDENCE_KINDS as readonly string[]).includes(kind) ? kind : 'other',
    filename: filenameOf(file['filename'], sniffed),
    contentType: sniffed,
    bytes,
  };
}

/**
 * A safe file name.
 *
 * The name is a person's own word for their document and is shown on the review
 * screen, so it is kept; it is also attacker-chosen text that never touches a
 * path, because the object key is the claim id and the evidence id. Trimmed to
 * its last segment, stripped of control characters, and capped.
 */
export function filenameOf(value: unknown, contentType: string): string {
  const raw = typeof value === 'string' ? value : '';
  const last = raw.split(/[\\/]/).pop() ?? '';
  const cleaned = last
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 120);
  if (cleaned !== '' && cleaned !== '.' && cleaned !== '..') return cleaned;
  return contentType === 'application/pdf' ? 'document.pdf' : 'document';
}

function asObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw bad(path, 'expected an object');
  }
  return value as Record<string, unknown>;
}

function bad(path: string, message: string): AppError {
  return new AppError(400, 'validation_failed', 'Validation failed', `${path}: ${message}`, [
    { path: `body.${path}`, message },
  ]);
}
