/**
 * Runs the resolution procedure over the committed catalogue and writes
 * src/series-map.json. Run once; the mapping is then frozen and the test suite
 * asserts the file still matches the catalogue.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadArchive } from '../src/archive.js';
import { archiveRoot } from '../src/paths.js';
import { resolveSeriesMap } from '../src/series.js';

const archive = loadArchive(archiveRoot());
const map = resolveSeriesMap(archive.catalogue, archive.catalogueSha256, '2026-09-04');
const target = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'series-map.json');
writeFileSync(target, `${JSON.stringify(map, null, 2)}\n`);
console.log(`wrote ${map.series.length} rows to ${target}`);
for (const entry of map.series) console.log(`  ${entry.bls_series_id}  ${entry.group_key}`);
