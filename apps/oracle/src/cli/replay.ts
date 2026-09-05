import { periodRange, resolveDataset, type Period } from '@creance/index-model';

import { findSeries, loadOracleConfig, type OracleConfig, type OracleSeries } from '../config.js';
import { oracleKeyHex } from '../keys.js';
import { DryRunPublisher, HcsPublisher, type Publisher } from '../publisher.js';
import { publishedOnTopic, type TopicObservation } from '../published.js';
import { QaFailed, runPipeline } from '../run.js';
import { applyScenario, loadScenario } from '../scenario.js';
import { StateFile, type OracleMode } from '../state.js';
import { JsonObservationWriter, MemoryObservationWriter, type ObservationWriter } from '../store.js';
import { CoverPoolSubmitter, DryRunSubmitter, type Submitter } from '../submitter.js';
import { readInteger, readPeriod, readSource, readString, type SourcePreference } from './args.js';
import { printHeader, printSummary } from './common.js';
import { reportQaFailure } from './failure.js';

/**
 * `pnpm oracle:replay`. The demo clock.
 *
 * Walks real historical months at one month per ten seconds, publishing the
 * same signed v2 messages the live path publishes and making the same contract
 * calls, and writes the run state the API serves so the web app can show the
 * REPLAY badge. The default window is DESIGN.md 3.4's: January 2025 forward for
 * the demo series, on official data, with no scenario file.
 *
 * The interval is a flag so the tests and a pre-roll can run fast. A tick
 * dwells the remainder of the interval after doing its work rather than firing
 * on a timer, so a period never appears on screen before it is on the topic.
 *
 * Scenario mode is the fallback DESIGN.md 3.3 allows when no real window
 * triggers. It is deliberately the more restricted path: see `scenarioPublisher`.
 */

interface Options {
  from: Period;
  to: Period | null;
  source: SourcePreference;
  series: string | null;
  intervalMs: number;
  submit: boolean;
  dryRun: boolean;
  scenario: string | null;
  statePath: string | null;
}

/** DESIGN.md 3.4: the replay runs real history from January 2025. */
export const DEFAULT_FROM: Period = '2025-01';

/** DESIGN.md 3.3: one month per ten seconds. */
export const DEFAULT_INTERVAL_MS = 10_000;

const USAGE = `usage: pnpm oracle:replay [options]

  --from YYYY-MM          first month to replay; defaults to ${DEFAULT_FROM}
  --to YYYY-MM            last month; defaults to the newest the source carries
  --series LABEL          the cover series to replay; defaults to the demo series
  --interval-ms N         milliseconds per tick; defaults to ${DEFAULT_INTERVAL_MS}
  --source archive|cache|api
                          where the rows come from; defaults to archive
  --scenario NAME         run a labelled scenario from apps/oracle/scenarios
  --no-submit             publish to the topic and make no contract call
  --dry-run               compute, gate, sign and encode everything, send nothing
  --state PATH            where to write the run state; defaults to ORACLE_STATE_PATH
  -h, --help              this text`;

export function parseArgs(argv: readonly string[]): Options {
  const options: Options = {
    from: DEFAULT_FROM,
    to: null,
    source: 'archive',
    series: null,
    intervalMs: DEFAULT_INTERVAL_MS,
    submit: true,
    dryRun: false,
    scenario: null,
    statePath: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--from') options.from = readPeriod(argv[++i], '--from');
    else if (arg === '--to') options.to = readPeriod(argv[++i], '--to');
    else if (arg === '--source') options.source = readSource(argv[++i]);
    else if (arg === '--series') options.series = readString(argv[++i], '--series');
    else if (arg === '--interval-ms') options.intervalMs = readInteger(argv[++i], '--interval-ms');
    else if (arg === '--scenario') options.scenario = readString(argv[++i], '--scenario');
    else if (arg === '--no-submit') options.submit = false;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--state') options.statePath = readString(argv[++i], '--state');
    else if (arg === '--help' || arg === '-h') {
      console.log(USAGE);
      process.exit(0);
    } else if (arg !== undefined) throw new Error(`unknown argument ${arg}`);
  }
  return options;
}

/**
 * Scenario mode's wiring, which is not the replay's.
 *
 * A scenario carries synthetic rates. Two rules follow and neither is a flag.
 *
 * It never calls the contract. Submitting a synthetic observation to the demo
 * series would move `lastObservedMonth`, could open a month, could take a
 * reserve, and would sit in the settlement history of a real series forever.
 * There is no argument that turns this on.
 *
 * It never writes the index topic. The index topic is the settlement record and
 * a first published value settles forever; a synthetic message on it could not
 * be told from a real one by a reader with only the topic. A scenario publishes
 * to `HEDERA_TOPIC_SCENARIO` when one is configured, and otherwise to the local
 * observation store alone, which is enough for the screen: the state file
 * carries the label and the web app says "scenario" on it.
 */
function scenarioPublisher(
  topicId: string | undefined,
  accountId: string,
  keyHex: string,
  dryRun: boolean,
): { publisher: Publisher; topicId: string | null } {
  if (dryRun || topicId === undefined || topicId.trim().length === 0) {
    return { publisher: new DryRunPublisher('scenario'), topicId: null };
  }
  return { publisher: new HcsPublisher(topicId, accountId, keyHex), topicId };
}

interface Wiring {
  publisher: Publisher;
  submitter: Submitter | null;
  writer: ObservationWriter;
  topicId: string | null;
}

/** The replay publishes real history, so it writes the real index topic. */
function replayPublisher(
  config: OracleConfig,
  keyHex: string,
  dryRun: boolean,
): { publisher: Publisher; topicId: string | null } {
  return dryRun
    ? { publisher: new DryRunPublisher(config.topicId), topicId: null }
    : {
        publisher: new HcsPublisher(config.topicId, config.accountId, keyHex),
        topicId: config.topicId,
      };
}

function submitterFor(
  config: OracleConfig,
  keyHex: string,
  submit: boolean,
  dryRun: boolean,
): Submitter | null {
  if (!submit) return null;
  return dryRun
    ? new DryRunSubmitter()
    : new CoverPoolSubmitter(
        config.rpcUrl,
        keyHex,
        config.coverPoolAddress,
        config.vaultAddress,
        config.submitGasLimit,
      );
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(argv);
  const config = loadOracleConfig();
  const keyHex = oracleKeyHex();
  const log = (line: string): void => console.log(line);

  const scenario = options.scenario === null ? null : loadScenario(options.scenario);
  const mode: OracleMode = scenario === null ? 'replay' : 'scenario';

  let series: OracleSeries | null = null;
  if (scenario === null) {
    const wanted = options.series ?? config.series[0]?.label;
    if (wanted === undefined) {
      throw new Error('no cover series in the deployment record: name one with --series');
    }
    series = findSeries(config, wanted) ?? null;
    if (series === null) throw new Error(`no cover series called ${wanted}`);
  } else if (options.series !== null) {
    throw new Error('a scenario names its own group; --series is not accepted with --scenario');
  }

  const base = await resolveDataset({ prefer: options.source, from: '2000-01' });
  const dataset = scenario === null ? base : applyScenario(base, scenario);
  const to = options.to ?? dataset.latest;
  const periods = periodRange(options.from, to);
  if (periods.length === 0) throw new Error(`${options.from} is after ${to}`);
  const groups = scenario === null ? [series!.groupKey] : [scenario.group];

  // A scenario submits nothing, ever, and publishes only where it is told to.
  const submit = scenario === null && options.submit;
  const writer = options.dryRun
    ? new MemoryObservationWriter()
    : new JsonObservationWriter(config.observationsPath);
  const wiring: Wiring =
    scenario === null
      ? { ...replayPublisher(config, keyHex, options.dryRun), submitter: submitterFor(config, keyHex, submit, options.dryRun), writer }
      : {
          ...scenarioPublisher(
            process.env.HEDERA_TOPIC_SCENARIO,
            config.accountId,
            keyHex,
            options.dryRun,
          ),
          submitter: null,
          writer,
        };

  printHeader(
    {
      mode,
      config,
      dataset,
      keyHex,
      from: options.from,
      to,
      groups,
      series,
      dryRun: options.dryRun,
      submit,
      scenarioLabel: scenario?.label ?? null,
    },
    log,
  );
  if (scenario !== null) {
    log(`  a scenario never submits on chain and never writes the index topic`);
    if (wiring.topicId === null) log(`  publishing to the local store only`);
    log('');
  }
  log(`cadence    ${options.intervalMs} ms per month, ${periods.length} months`);
  log('');

  // What the topic already carries. The store under var/ is this machine's
  // memory and a clone has none, so without this a clean clone republishes
  // every month of the window the shared topic already settled.
  const alreadyPublished =
    wiring.topicId === null
      ? new Map<string, TopicObservation>()
      : await publishedOnTopic({ mirrorUrl: config.mirrorUrl, topicId: wiring.topicId, mode });
  if (alreadyPublished.size > 0) {
    log(
      `topic      ${alreadyPublished.size} group months already on the topic, not published again`,
    );
    log('');
  }

  const state = new StateFile(options.statePath ?? config.statePath, {
    mode,
    series: series?.label ?? null,
    from: options.from,
    to,
    scenario_label: scenario?.label ?? null,
  });
  state.start();

  try {
    const summary = await runPipeline({
      mode,
      dataset,
      periods,
      groups,
      config,
      publisher: wiring.publisher,
      submitter: wiring.submitter,
      writer: wiring.writer,
      publishedOnTopic: alreadyPublished,
      topicId: wiring.topicId,
      keyHex,
      state,
      intervalMs: options.intervalMs,
      scenarioLabel: scenario?.label ?? null,
      log,
    });
    printSummary(summary, log);
  } finally {
    state.finish();
    await wiring.publisher.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    if (error instanceof QaFailed) {
      // Echo the window the operator actually asked for, so the suggested
      // command can be pasted rather than filled in.
      let from: Period = DEFAULT_FROM;
      try {
        from = parseArgs(process.argv.slice(2)).from;
      } catch {
        // Unparseable arguments cannot have reached a QA failure, but the
        // reporter must not be the thing that throws.
      }
      reportQaFailure(error, `pnpm oracle:replay --from ${from}`);
    } else {
      console.error(error instanceof Error ? error.message : String(error));
    }
    process.exitCode = 1;
  });
}
