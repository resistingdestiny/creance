import {
  addMonths,
  datasetFrom,
  evaluateDataset,
  frozenParameters,
  loadCalibration,
  loadDataset,
  seriesIdFor,
  type Dataset,
  type Observation,
  type Period,
  type SourceObservation,
} from '@creance/index-model';
import { describe, expect, it } from 'vitest';

import { MemoryNotifier } from '../src/alerts.js';
import { loadOracleConfig } from '../src/config.js';
import { DryRunPublisher } from '../src/publisher.js';
import { detectRevisions, publishRevisions } from '../src/revision.js';
import { runPipeline } from '../src/run.js';
import { MemoryObservationWriter } from '../src/store.js';
import { DryRunSubmitter } from '../src/submitter.js';

/// The first final rule, exercised the way it will actually happen: publish a
/// month from the committed archive, change the source under it, and check that
/// what comes out is a revision record and not a second settlement.
///
/// The chain adapters are the dry run pair, so the message, the signature, the
/// source hash and the store are all real and only the two network calls are
/// not. Nothing here reaches testnet.

const RECORD = new URL('../../../contracts/deployments/testnet.json', import.meta.url).pathname;
const CONFIG = loadOracleConfig({
  recordPath: RECORD,
  environment: { HEDERA_TOPIC_INDEX: '0.0.10366470', HEDERA_ORACLE_ID: '0.0.10366447' },
});
const KEY = 'b2'.repeat(32);
const CLEAN = loadDataset();
const NOW = new Date('2026-09-05T14:10:00Z');
const COMPUTER = seriesIdFor('computer_math', CLEAN.map);

/** The archive with one month of one series moved, as a BLS correction moves it. */
function corrected(period: Period, value: number): Dataset {
  const rows = [...(CLEAN.allSeries.get(COMPUTER) ?? [])].map((row: SourceObservation) =>
    row.period === period ? { ...row, value, raw: value.toFixed(1) } : row,
  );
  const series = new Map(CLEAN.allSeries);
  series.set(COMPUTER, rows);
  return datasetFrom(series, CLEAN.source, CLEAN.archive, CLEAN.map);
}

function observations(dataset: Dataset, from: Period, to: Period): Map<string, Observation[]> {
  return evaluateDataset(dataset, frozenParameters(), addMonths(from, -25), to);
}

async function publishJuly() {
  const writer = new MemoryObservationWriter();
  const publisher = new DryRunPublisher();
  const submitter = new DryRunSubmitter();
  await runPipeline({
    mode: 'live',
    dataset: CLEAN,
    periods: ['2026-06', '2026-07'] as Period[],
    groups: ['computer_math'],
    config: CONFIG,
    publisher,
    submitter,
    writer,
    keyHex: KEY,
    now: () => NOW,
  });
  return { writer, publisher, submitter };
}

describe('a source that changed under a published period', () => {
  it('is detected by the source hash the published message committed to', async () => {
    const { writer } = await publishJuly();
    const changed = corrected('2026-07', 4.2);
    const found = detectRevisions({
      dataset: changed,
      records: await writer.all(),
      latest: '2026-07',
      mode: 'live',
    });
    expect(found.map((candidate) => candidate.period)).toEqual(['2026-07']);
    expect(found[0]?.groupKey).toBe('computer_math');
    expect(found[0]?.publishedHash).not.toBe(found[0]?.freshHash);
    // The sequence number of the message the topic already carries, which is
    // what the revision record has to reference.
    expect(found[0]?.revisesSeq).toBe(2);
  });

  it('publishes a revision record that references the original sequence', async () => {
    const { writer, submitter } = await publishJuly();
    const changed = corrected('2026-07', 4.2);
    const publisher = new DryRunPublisher();
    const notifier = new MemoryNotifier();
    const before = submitter.calls.length;

    const published = await publishRevisions({
      candidates: detectRevisions({
        dataset: changed,
        records: await writer.all(),
        latest: '2026-07',
        mode: 'live',
      }),
      dataset: changed,
      observations: observations(changed, '2026-07', '2026-07'),
      config: CONFIG,
      publisher,
      writer,
      notifier,
      keyHex: KEY,
      modelVersion: loadCalibration().model_version,
      mode: 'live',
      runId: 4,
      now: NOW,
    });

    expect(published).toHaveLength(1);
    expect(published[0]?.message.status).toBe('revision');
    expect(published[0]?.message.revises_seq).toBe(2);
    expect(published[0]?.message.u_g).toBe(4.2);
    expect(published[0]?.bytes).toBeLessThan(1024);

    // One message on the topic, and it is the revision. Nothing was resubmitted:
    // a revision is published and never settled.
    expect(publisher.published).toHaveLength(1);
    expect(submitter.calls).toHaveLength(before);

    const alerts = notifier.sent;
    expect(alerts.map((alert) => alert.event)).toEqual(['revision_detected']);
    expect(alerts[0]).toMatchObject({ group: 'computer_math', period: '2026-07', run_id: 4 });
  });

  it('leaves the settled row exactly as it was, beside the revision', async () => {
    const { writer } = await publishJuly();
    const settledBefore = await writer.get('computer_math', '2026-07', 'live');
    const changed = corrected('2026-07', 4.2);
    await publishRevisions({
      candidates: detectRevisions({
        dataset: changed,
        records: await writer.all(),
        latest: '2026-07',
        mode: 'live',
      }),
      dataset: changed,
      observations: observations(changed, '2026-07', '2026-07'),
      config: CONFIG,
      publisher: new DryRunPublisher(),
      writer,
      notifier: new MemoryNotifier(),
      keyHex: KEY,
      modelVersion: loadCalibration().model_version,
      mode: 'live',
      runId: 4,
      now: NOW,
    });

    // The lookup every later run makes is the settlement lookup, and it still
    // answers with the value that settled.
    expect(await writer.get('computer_math', '2026-07', 'live')).toEqual(settledBefore);

    const rows = (await writer.all()).filter((row) => row.period === '2026-07');
    expect(rows.map((row) => row.status).sort()).toEqual(['final', 'revised']);
    const revised = rows.find((row) => row.status === 'revised');
    expect(revised?.revises_seq).toBe(2);
    expect(revised?.submit_tx).toBeNull();
  });

  it('records one revision for two fetches of the same change', async () => {
    const { writer } = await publishJuly();
    const changed = corrected('2026-07', 4.2);
    const options = {
      dataset: changed,
      observations: observations(changed, '2026-07', '2026-07'),
      config: CONFIG,
      writer,
      notifier: new MemoryNotifier(),
      keyHex: KEY,
      modelVersion: loadCalibration().model_version,
      mode: 'live' as const,
      runId: 4,
      now: NOW,
    };
    await publishRevisions({
      ...options,
      publisher: new DryRunPublisher(),
      candidates: detectRevisions({
        dataset: changed,
        records: await writer.all(),
        latest: '2026-07',
        mode: 'live',
      }),
    });

    const second = detectRevisions({
      dataset: changed,
      records: await writer.all(),
      latest: '2026-07',
      mode: 'live',
    });
    expect(second).toEqual([]);
  });

  it('records a second revision when the source moves again', async () => {
    const { writer } = await publishJuly();
    for (const value of [4.2, 4.4]) {
      const changed = corrected('2026-07', value);
      await publishRevisions({
        candidates: detectRevisions({
          dataset: changed,
          records: await writer.all(),
          latest: '2026-07',
          mode: 'live',
        }),
        dataset: changed,
        observations: observations(changed, '2026-07', '2026-07'),
        config: CONFIG,
        publisher: new DryRunPublisher(),
        writer,
        notifier: new MemoryNotifier(),
        keyHex: KEY,
        modelVersion: loadCalibration().model_version,
        mode: 'live',
        runId: 4,
        now: NOW,
      });
    }
    const rows = (await writer.all()).filter((row) => row.status === 'revised');
    // One row, the newest restatement, which is what the unique key allows.
    expect(rows).toHaveLength(1);
    expect(rows[0]?.message.u_g).toBe(4.4);
  });
});

describe('a source that changed under a period nobody published', () => {
  it('produces no revision, because a first value has not happened yet', async () => {
    const writer = new MemoryObservationWriter();
    await runPipeline({
      mode: 'live',
      dataset: CLEAN,
      periods: ['2026-07'] as Period[],
      groups: ['computer_math'],
      config: CONFIG,
      publisher: new DryRunPublisher(),
      submitter: null,
      writer,
      keyHex: KEY,
      now: () => NOW,
    });
    // 2026-01 is inside the fifteen month window, and neither it nor the three
    // months its rows feed were ever published.
    const changed = corrected('2026-01', 4.9);
    const found = detectRevisions({
      dataset: changed,
      records: await writer.all(),
      latest: '2026-07',
      mode: 'live',
    });
    expect(found.map((candidate) => candidate.period)).toEqual([]);
  });
});
