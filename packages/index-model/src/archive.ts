import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

import { parseCatalogue, type CatalogueEntry } from './catalogue.js';
import { sha256Hex } from './hash.js';
import { mergeSeries, parseBlsResponse, type SourceObservation } from './bls-response.js';
import type { Period } from './period.js';

/**
 * The committed archive under data/bls is the primary fixture. It is verified
 * against its own PROVENANCE.txt before it is used, because a backfill from a
 * modified archive is a fabricated history and would be indistinguishable from a
 * correct one at every later step.
 */

export interface ProvenanceFile {
  url: string;
  path: string;
  sha256: string;
  bytes: number;
  /** Set for the catalogue, which records the hash of the decompressed file too. */
  sha256Plain?: string;
  bytesPlain?: number;
}

export interface Provenance {
  files: ProvenanceFile[];
  text: string;
}

export interface VerifiedFile extends ProvenanceFile {
  actualSha256: string;
  actualBytes: number;
}

export interface Archive {
  root: string;
  provenance: Provenance;
  verified: VerifiedFile[];
  /** Series id to its ascending monthly observations, merged across the files. */
  series: Map<string, SourceObservation[]>;
  catalogue: CatalogueEntry[];
  /** sha256 of the decompressed ln.series, which is what the mapping records. */
  catalogueSha256: string;
  apiFiles: string[];
}

const SHA256_RE = /\bsha256=([0-9a-f]{64})\b/;
const SHA256_GZ_RE = /\bsha256_gz=([0-9a-f]{64})\b/;
const SHA256_PLAIN_RE = /\bsha256_plain=([0-9a-f]{64})\b/;
const BYTES_RE = /\bbytes=(\d+)\b/;
const BYTES_PLAIN_RE = /\bbytes_plain=(\d+)\b/;
const FILE_RE = /\bfile=(\S+)/;

export function parseProvenance(text: string): Provenance {
  const files: ProvenanceFile[] = [];
  for (const line of text.split('\n')) {
    const url = line.split(/\s\s+/)[0]?.trim() ?? '';
    const gz = SHA256_GZ_RE.exec(line);
    if (gz) {
      const plain = SHA256_PLAIN_RE.exec(line);
      const bytesPlain = BYTES_PLAIN_RE.exec(line);
      files.push({
        url,
        path: 'raw/ln.series.gz',
        sha256: gz[1] as string,
        bytes: 0,
        ...(plain ? { sha256Plain: plain[1] as string } : {}),
        ...(bytesPlain ? { bytesPlain: Number(bytesPlain[1]) } : {}),
      });
      continue;
    }
    const file = FILE_RE.exec(line);
    const sha = SHA256_RE.exec(line);
    const bytes = BYTES_RE.exec(line);
    if (file && sha && bytes) {
      files.push({
        url,
        path: `api/${file[1] as string}`,
        sha256: sha[1] as string,
        bytes: Number(bytes[1]),
      });
    }
  }
  if (files.length === 0) throw new Error('PROVENANCE.txt records no files');
  return { files, text };
}

/**
 * Verify every file the provenance records, and refuse to leave a file in the
 * archive unrecorded. Throws on the first mismatch with both hashes in the
 * message, so a failure says what changed rather than only that something did.
 */
export function verifyArchive(root: string): { provenance: Provenance; verified: VerifiedFile[] } {
  const provenance = parseProvenance(readFileSync(join(root, 'PROVENANCE.txt'), 'utf8'));
  const verified: VerifiedFile[] = [];
  for (const file of provenance.files) {
    const bytes = readFileSync(join(root, file.path));
    const actualSha256 = sha256Hex(bytes);
    if (actualSha256 !== file.sha256) {
      throw new Error(
        `archive ${file.path}: PROVENANCE.txt records sha256 ${file.sha256} ` +
          `but the file on disk hashes to ${actualSha256}`,
      );
    }
    if (file.bytes > 0 && bytes.byteLength !== file.bytes) {
      throw new Error(
        `archive ${file.path}: PROVENANCE.txt records ${file.bytes} bytes ` +
          `but the file on disk is ${bytes.byteLength}`,
      );
    }
    if (file.sha256Plain !== undefined) {
      const plain = gunzipSync(bytes);
      const plainSha = sha256Hex(plain);
      if (plainSha !== file.sha256Plain) {
        throw new Error(
          `archive ${file.path}: PROVENANCE.txt records a decompressed sha256 of ` +
            `${file.sha256Plain} but the decompressed file hashes to ${plainSha}`,
        );
      }
      if (file.bytesPlain !== undefined && plain.byteLength !== file.bytesPlain) {
        throw new Error(
          `archive ${file.path}: decompressed to ${plain.byteLength} bytes, ` +
            `PROVENANCE.txt records ${file.bytesPlain}`,
        );
      }
    }
    verified.push({ ...file, actualSha256, actualBytes: bytes.byteLength });
  }
  const recorded = new Set(provenance.files.map((f) => f.path));
  for (const name of readdirSync(join(root, 'api'))) {
    if (name.endsWith('.json') && !recorded.has(`api/${name}`)) {
      throw new Error(`archive api/${name} is not recorded in PROVENANCE.txt`);
    }
  }
  return { provenance, verified };
}

export function loadArchive(root: string): Archive {
  const { provenance, verified } = verifyArchive(root);
  const apiFiles = provenance.files
    .filter((file) => file.path.startsWith('api/'))
    .map((file) => file.path)
    .sort();
  const parts = apiFiles.flatMap((path) =>
    parseBlsResponse(JSON.parse(readFileSync(join(root, path), 'utf8')), path),
  );
  const series = mergeSeries(parts);
  const catalogueBytes = readFileSync(join(root, 'raw/ln.series.gz'));
  return {
    root,
    provenance,
    verified,
    series,
    catalogue: parseCatalogue(catalogueBytes),
    catalogueSha256: sha256Hex(gunzipSync(catalogueBytes)),
    apiFiles,
  };
}

/** The newest month any series in the archive carries a numeric value for. */
export function latestPeriod(series: Map<string, SourceObservation[]>): Period {
  let latest: Period | null = null;
  for (const rows of series.values()) {
    for (const row of rows) {
      if (row.value === null) continue;
      if (latest === null || row.period > latest) latest = row.period;
    }
  }
  if (latest === null) throw new Error('no numeric observations in the source');
  return latest;
}
