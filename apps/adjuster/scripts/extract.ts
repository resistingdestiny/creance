import { parseArgs } from 'node:util';

import { packetA, packetB } from '../fixtures/index.js';
import { loadAdjusterConfig } from '../src/config.js';
import { ModelExtractor } from '../src/extract.js';
import { isFailure } from '../src/extraction.js';

/// `pnpm --filter @creance/adjuster extract`
///
/// The live extraction, against a committed fixture. It is not part of
/// `pnpm test`: the test suite runs the recorded extractions beside each packet
/// so that it needs no key and no network, and this is how a recording is
/// refreshed and how the prompt is checked after a change.
///
///     --packet a|b    which fixture to read, default a
///     --effort LEVEL  low, medium or high, default what the environment says
///
/// It costs a few cents and prints the JSON to stdout, so refreshing a
/// recording is a redirect into fixtures/packet-a/extraction.json.

const { values } = parseArgs({
  options: {
    packet: { type: 'string', default: 'a' },
    effort: { type: 'string' },
    help: { type: 'boolean', default: false },
  },
});

if (values.help === true) {
  console.log('usage: pnpm --filter @creance/adjuster extract [--packet a|b] [--effort LEVEL]');
  process.exit(0);
}

const packet = values.packet === 'b' ? packetB() : packetA();
const config = loadAdjusterConfig();
if (config.model.apiKey === undefined) {
  console.error(
    'ANTHROPIC_API_KEY is not set, so there is no live extraction to run.\n' +
      'Set it in the local environment file. The test suite does not need it.',
  );
  process.exit(2);
}

const file = packet.claim.evidence[0];
if (file === undefined) throw new Error(`${packet.name} carries no evidence`);

const effort = (values.effort ?? config.model.effort) as 'low' | 'medium' | 'high';
const extractor = new ModelExtractor({
  apiKey: config.model.apiKey,
  model: config.model.id,
  effort,
});

console.error(`reading ${packet.documentPath} with ${config.model.id}, effort ${effort}`);
const started = Date.now();
const result = await extractor.extract({
  evidenceId: file.evidence_id,
  kind: file.kind,
  contentType: file.content_type,
  bytes: packet.document,
});
console.error(`took ${Math.round((Date.now() - started) / 100) / 10} seconds`);

if (isFailure(result)) {
  console.error(`the extraction failed: ${result.reason}, ${result.detail}`);
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ [file.evidence_id]: result }, null, 2));
}
