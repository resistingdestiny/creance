import { loadCalibration, type Dataset, type Period } from '@creance/index-model';

import { seriesForGroup, type OracleConfig, type OracleSeries } from '../config.js';
import { addressOfKey } from '../message.js';
import { DryRunPublisher, HcsPublisher, type Publisher } from '../publisher.js';
import type { RunSummary } from '../run.js';
import { JsonObservationWriter, MemoryObservationWriter, type ObservationWriter } from '../store.js';
import { CoverPoolSubmitter, DryRunSubmitter, type Submitter } from '../submitter.js';

/**
 * The wiring both commands share: which publisher, which submitter, which
 * store, and the header a run prints before it does anything.
 *
 * A dry run swaps all three for the in memory pair. Everything else, the
 * compute, the QA gates, the message, the signature and the call encoding, is
 * the same code on both paths, which is the point of running `--dry-run` first.
 */

export interface Wiring {
  publisher: Publisher;
  submitter: Submitter | null;
  writer: ObservationWriter;
  topicId: string | null;
}

export interface WiringOptions {
  config: OracleConfig;
  keyHex: string;
  dryRun: boolean;
  submit: boolean;
}

export function wire(options: WiringOptions): Wiring {
  if (options.dryRun) {
    return {
      publisher: new DryRunPublisher(options.config.topicId),
      submitter: options.submit ? new DryRunSubmitter() : null,
      writer: new MemoryObservationWriter(),
      topicId: null,
    };
  }
  return {
    publisher: new HcsPublisher(
      options.config.topicId,
      options.config.accountId,
      options.keyHex,
    ),
    submitter: options.submit
      ? new CoverPoolSubmitter(
          options.config.rpcUrl,
          options.keyHex,
          options.config.coverPoolAddress,
          options.config.vaultAddress,
          options.config.submitGasLimit,
        )
      : null,
    writer: new JsonObservationWriter(options.config.observationsPath),
    topicId: options.config.topicId,
  };
}

export interface HeaderOptions {
  mode: string;
  config: OracleConfig;
  dataset: Dataset;
  keyHex: string;
  from: Period;
  to: Period;
  groups: readonly string[] | null;
  series: OracleSeries | null;
  dryRun: boolean;
  submit: boolean;
  scenarioLabel?: string | null;
}

/** Everything a reader needs to check a run before it starts. No secrets. */
export function printHeader(options: HeaderOptions, log: (line: string) => void): void {
  const calibration = loadCalibration();
  log(`mode       ${options.mode}${options.dryRun ? ' (dry run, nothing is sent)' : ''}`);
  if (options.scenarioLabel != null) log(`scenario   ${options.scenarioLabel}`);
  log(`source     ${options.dataset.source.description}`);
  for (const file of options.dataset.source.files) {
    log(`  ${file.sha256}  ${String(file.bytes).padStart(9)}  ${file.label}`);
  }
  log(`model      ${calibration.model_version}, frozen ${calibration.frozen_on}`);
  log(`window     ${options.from} to ${options.to}`);
  log(`groups     ${options.groups === null ? 'every bindable group' : options.groups.join(', ')}`);
  log(`topic      ${options.dryRun ? 'none' : options.config.topicId}`);
  log(`signer     ${addressOfKey(options.keyHex)} (${options.config.accountId})`);
  if (options.series !== null) {
    log(`series     ${options.series.label}  ${options.series.seriesId}`);
    log(`pool       ${options.config.coverPoolAddress}`);
  }
  log(`submit     ${options.submit ? `on, gas limit ${options.config.submitGasLimit}` : 'off'}`);
  log('');
}

/** The tail of a run: what landed, and the links to check it with. */
export function printSummary(summary: RunSummary, log: (line: string) => void): void {
  log('');
  log(`published  ${summary.publishedCount} messages`);
  log(`submitted  ${summary.submittedCount} observations on chain`);
  log(`skipped    ${summary.skippedCount} already published in ${summary.mode} mode`);

  const rows = summary.periods.flatMap((period) => period.published);
  const opened = rows.filter((row) => row.open);
  if (opened.length > 0) {
    log('');
    log(`open       ${opened.map((row) => `${row.period} ${row.openReason}`).join(', ')}`);
  }
  const links = rows.filter((row) => row.hcsUrl !== null || row.submitUrl !== null);
  if (links.length > 0) {
    log('');
    log('links');
    for (const row of links) {
      if (row.mirrorUrl !== null) log(`  ${row.period}  message  ${row.mirrorUrl}`);
      if (row.submitUrl !== null) log(`  ${row.period}  submit   ${row.submitUrl}`);
    }
  }
}

/** The group a command means when it names a cover series. */
export function groupsFor(config: OracleConfig, series: OracleSeries | null): string[] | null {
  return series === null ? null : [series.groupKey];
}

export function seriesOfGroup(config: OracleConfig, groupKey: string): OracleSeries | null {
  return seriesForGroup(config, groupKey) ?? null;
}
