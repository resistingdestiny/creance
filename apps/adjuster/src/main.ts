import { parseArgs } from 'node:util';

import { AdjusterApi } from './api.js';
import { adjusterClient, NoPublisher, TopicDecisionPublisher } from './chain.js';
import { loadAdjusterConfig, requireAdminToken } from './config.js';
import { ModelExtractor, UnavailableExtractor } from './extract.js';
import { runPass, type PassResult } from './run.js';

/// `pnpm adjuster:run`, one pass over the claims waiting for a decision.
///
///     --limit N       how many claims to take in one pass, default 20
///     --watch         run the same pass on a timer, for the demo
///     --interval S    the timer's spacing in seconds, default 5
///     --dry-run       decide and print, publish nothing and write nothing
///
/// A pass ends. `--watch` runs the same pass again on a timer rather than
/// looping back over what it already decided, because a driver that loops back
/// re-runs economic actions.

const usage = `usage: pnpm adjuster:run [--limit N] [--watch] [--interval SECONDS] [--dry-run]`;

const { values } = parseArgs({
  options: {
    limit: { type: 'string', default: '20' },
    watch: { type: 'boolean', default: false },
    interval: { type: 'string', default: '5' },
    'dry-run': { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
  allowPositionals: false,
});

if (values.help === true) {
  console.log(usage);
  process.exit(0);
}

const limit = Number(values.limit);
if (!Number.isInteger(limit) || limit < 1) {
  console.error(`--limit takes a whole number of claims, got ${String(values.limit)}`);
  process.exit(2);
}
const intervalSeconds = Number(values.interval);
if (!Number.isInteger(intervalSeconds) || intervalSeconds < 1) {
  console.error(`--interval takes whole seconds, got ${String(values.interval)}`);
  process.exit(2);
}
const dryRun = values['dry-run'] === true;

const config = loadAdjusterConfig();
const api = new AdjusterApi(config.apiUrl, requireAdminToken(config));

// Without a model key the Adjuster still runs: every document fails to be read,
// every claim that needs one is referred to the queue, and the claims a cheap
// rule already answers are still decided. That is the honest behaviour and it
// is said on the way in rather than discovered on a claim.
const extractor =
  config.model.apiKey === undefined
    ? new UnavailableExtractor()
    : new ModelExtractor({
        apiKey: config.model.apiKey,
        model: config.model.id,
        effort: config.model.effort,
      });
if (config.model.apiKey === undefined) {
  console.log(
    'no ANTHROPIC_API_KEY is set, so no document will be read and every claim that needs one refers',
  );
}

const client = dryRun
  ? null
  : adjusterClient(config.adjuster.accountId, config.adjuster.privateKey, config.network);
const publisher =
  client === null ? new NoPublisher() : new TopicDecisionPublisher(client, config.claimsTopicId);

if (dryRun) console.log('dry run: nothing is published and nothing is written');

async function once(): Promise<void> {
  const results = await runPass({
    api,
    extractor,
    publisher,
    asset: { id: config.settlementToken.tokenId, decimals: config.settlementToken.decimals },
    model: config.model.apiKey === undefined ? null : config.model.id,
    effort: config.model.apiKey === undefined ? null : config.model.effort,
    limit,
    log: (line) => console.log(line),
  });
  for (const result of results) report(result);
}

function report(result: PassResult): void {
  const parts = [result.claimId, result.decision];
  if (result.confidence !== null) parts.push(`confidence ${result.confidence}`);
  if (result.reasons.length > 0) parts.push(result.reasons.join(', '));
  if (result.hcsSequenceNumber !== null) parts.push(`seq ${result.hcsSequenceNumber}`);
  if (result.note !== undefined) parts.push(result.note);
  console.log(`  ${parts.join('  ')}`);
}

try {
  await once();
  if (values.watch === true) {
    console.log(`watching, one pass every ${intervalSeconds} seconds`);
    setInterval(() => {
      void once().catch((error: unknown) => {
        console.error(`the pass stopped: ${(error as Error).message}`);
      });
    }, intervalSeconds * 1000);
  } else {
    client?.close();
  }
} catch (error) {
  console.error(`\nthe pass stopped: ${(error as Error).message}`);
  client?.close();
  process.exitCode = 1;
}
