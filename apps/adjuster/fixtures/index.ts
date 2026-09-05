import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { AdminClaim } from '../src/api.js';
import type { ExtractionResult } from '../src/extraction.js';

/// The two committed packets, loaded as the admin payload the Adjuster reads
/// live and the extraction a model returned for the document beside it.
///
/// The extraction is recorded rather than produced, so `pnpm test` needs no
/// model key and no network. `pnpm --filter @creance/adjuster extract` runs the
/// real call against the same PDF and prints what it got back, which is how a
/// recording is refreshed.

export interface Packet {
  name: string;
  claim: AdminClaim;
  extractions: Record<string, ExtractionResult>;
  /** The evidence file itself, for the live extraction path. */
  document: Buffer;
  documentPath: string;
}

function load(name: string): Packet {
  const dir = new URL(`./${name}/`, import.meta.url);
  const documentPath = fileURLToPath(new URL('letter.pdf', dir));
  return {
    name,
    claim: JSON.parse(readFileSync(fileURLToPath(new URL('claim.json', dir)), 'utf8')) as AdminClaim,
    extractions: JSON.parse(
      readFileSync(fileURLToPath(new URL('extraction.json', dir)), 'utf8'),
    ) as Record<string, ExtractionResult>,
    document: readFileSync(documentPath),
    documentPath,
  };
}

/** The clean redundancy that auto-approves. */
export const packetA = (): Packet => load('packet-a');

/** The resignation that declines before any document is read. */
export const packetB = (): Packet => load('packet-b');

/**
 * The clock both packets are measured against.
 *
 * The rule engine never reads a clock, so the fixtures name the instant that
 * makes them mean what they mean: the replay has published through July 2026
 * and the April observation landed today.
 */
export const FIXTURE_NOW = '2026-09-05T12:10:00Z';
