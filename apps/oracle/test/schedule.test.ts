import {
  datasetFrom,
  loadDataset,
  periodRange,
  seriesIdFor,
  type Dataset,
  type Period,
  type SourceObservation,
} from '@creance/index-model';
import { describe, expect, it } from 'vitest';

import { HttpNotifier, type Alert } from '../src/alerts.js';
import { loadOracleConfig } from '../src/config.js';
import { DryRunPublisher } from '../src/publisher.js';
import { QaFailed, runPipeline } from '../src/run.js';
import { MemoryRunsWriter } from '../src/runs.js';
import { newestPublished, runScheduledCheck, targetsFor } from '../src/schedule.js';
import { MemoryObservationWriter, type ObservationWriter } from '../src/store.js';
import { DryRunSubmitter } from '../src/submitter.js';

/// The daily check, end to end, against the committed archive with the dry run
/// publisher and submitter in place of the two network calls. Everything else
/// is the deployed code path: the same gates, the same messages, the same
/// store, the same runs table and the same alerts.
///
/// The archive's newest period is 2026-07 and the event is on 2026-09-05, so
/// the check normally has nothing new to publish. Each test seeds the store to
/// the month it wants to start from and lets the check decide the rest.

const RECORD = new URL('../../../contracts/deployments/testnet.json', import.meta.url).pathname;
const CONFIG = loadOracleConfig({
  recordPath: RECORD,
  environment: { HEDERA_TOPIC_INDEX: '0.0.10366470', HEDERA_ORACLE_ID: '0.0.10366447' },
});
const KEY = 'b2'.repeat(32);
const CLEAN = loadDataset();
const GROUPS = ['computer_math'];
const TODAY = new Date('2026-09-05T14:10:00Z');
const COMPUTER = seriesIdFor('computer_math', CLEAN.map);

/** A NOTIFY_URL endpoint that records what was posted to it. */
function notifyUrl(): { notifier: HttpNotifier; posted: Alert[] } {
  const posted: Alert[] = [];
  const notifier = new HttpNotifier('https://alerts.example/hook', () => {}, (async (
    _url: string,
    init: { body: string },
  ) => {
    posted.push(JSON.parse(init.body) as Alert);
    return new Response('', { status: 204 });
  }) as unknown as typeof fetch);
  return { notifier, posted };
}

/** A store that already holds everything up to and including `through`. */
async function published(through: Period, from: Period = '2026-01'): Promise<ObservationWriter> {
  const writer = new MemoryObservationWriter();
  await runPipeline({
    mode: 'live',
    dataset: CLEAN,
    periods: periodRange(from, through),
    groups: GROUPS,
    config: CONFIG,
    publisher: new DryRunPublisher(),
    submitter: new DryRunSubmitter(),
    writer,
    keyHex: KEY,
    now: () => TODAY,
  });
  return writer;
}

/** The archive with one series' rows for one month replaced or removed. */
function corrupted(period: Period, value: number | null): Dataset {
  const rows = (CLEAN.allSeries.get(COMPUTER) ?? []).flatMap((row: SourceObservation) => {
    if (row.period !== period) return [row];
    return value === null ? [] : [{ ...row, value, raw: value.toFixed(1) }];
  });
  const series = new Map(CLEAN.allSeries);
  series.set(COMPUTER, rows);
  return datasetFrom(series, CLEAN.source, CLEAN.archive, CLEAN.map);
}

interface CheckOptions {
  dataset?: Dataset;
  writer: ObservationWriter;
  now?: Date;
}

async function check(options: CheckOptions) {
  const publisher = new DryRunPublisher();
  const submitter = new DryRunSubmitter();
  const runs = new MemoryRunsWriter();
  const { notifier, posted } = notifyUrl();
  const result = await runScheduledCheck({
    dataset: options.dataset ?? CLEAN,
    config: CONFIG,
    publisher,
    submitter,
    writer: options.writer,
    runs,
    notifier,
    keyHex: KEY,
    groups: GROUPS,
    now: () => options.now ?? TODAY,
  });
  return { result, publisher, submitter, runs, posted };
}

describe('deciding what a check should run', () => {
  it('takes the newest published period from the store and the topic together', async () => {
    const writer = await published('2026-03', '2026-02');
    const rows = await writer.all();
    expect(newestPublished(rows)).toBe('2026-03');

    // A clean clone has no store at all, and then the topic read back is the
    // only thing that knows what settled.
    const onTopic = new Map([
      [
        'index/computer_math/2026-05',
        { sequenceNumber: 9, message: { period: '2026-05', status: 'final' } },
      ],
    ]);
    expect(newestPublished([], onTopic as never)).toBe('2026-05');
    expect(newestPublished(rows, onTopic as never)).toBe('2026-05');
    expect(newestPublished([])).toBeNull();
  });

  it('runs every month between what is published and what the source carries', () => {
    expect(targetsFor('2026-04', '2026-07')).toEqual(['2026-05', '2026-06', '2026-07']);
  });

  it('runs nothing when the source has nothing newer', () => {
    expect(targetsFor('2026-07', '2026-07')).toEqual([]);
    expect(targetsFor('2026-08' as Period, '2026-07')).toEqual([]);
  });

  it('runs the newest month alone on a machine that has published nothing', () => {
    expect(targetsFor(null, '2026-07')).toEqual(['2026-07']);
  });
});

describe('a check with a newer period at the source', () => {
  it('publishes every month the store is behind and settles the ones that can settle', async () => {
    const writer = await published('2026-03');
    const { result, publisher, submitter } = await check({ writer });

    expect(result.targets).toEqual(['2026-04', '2026-05', '2026-06', '2026-07']);
    expect(result.summary?.publishedCount).toBe(4);
    expect(publisher.published).toHaveLength(4);
    expect(submitter.calls.map((call) => call.period)).toEqual([202604, 202605, 202606, 202607]);
    expect(result.run.state).toBe('done');
    expect(result.run.target_period).toBe('2026-07');
    expect(result.run.notes).toBe('published 4, submitted 4, skipped 0');
  });

  it('writes the gate report for every month it published into the runs row', async () => {
    const writer = await published('2026-03');
    const { result, runs } = await check({ writer });
    const rows = await runs.all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.qa_json?.map((report) => report.period)).toEqual([
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
    ]);
    expect(result.run.qa_json?.every((report) => report.passed)).toBe(true);
  });

  it('alerts on the first open month for a group, once', async () => {
    const writer = await published('2026-03');
    const { result, posted } = await check({ writer });
    const opened = posted.filter((alert) => alert.event === 'first_open_month');
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatchObject({ group: 'computer_math', period: '2026-04' });
    expect(opened[0]?.message).toMatch(/level form/);
    expect(result.alerts.map((alert) => alert.event)).toEqual(['first_open_month']);
  });

  it('does not alert again for a group that has opened before', async () => {
    // The store already carries the April opening, so May is not a first month.
    const writer = await published('2026-04');
    const { posted, result } = await check({ writer });
    expect(result.summary?.publishedCount).toBe(3);
    expect(posted.filter((alert) => alert.event === 'first_open_month')).toEqual([]);
  });
});

describe('a check with nothing new at the source', () => {
  it('is still a run, and still writes a row', async () => {
    const writer = await published('2026-07');
    const { result, publisher, submitter, runs } = await check({ writer });
    expect(result.targets).toEqual([]);
    expect(result.summary).toBeNull();
    expect(publisher.published).toEqual([]);
    expect(submitter.calls).toEqual([]);

    const rows = await runs.all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.state).toBe('done');
    expect(rows[0]?.notes).toBe('no new period at the source, newest is 2026-07');
    // The newest month is still gated, so a source that went bad between
    // releases is caught before the release that would have published it.
    expect(rows[0]?.qa_json?.map((report) => report.period)).toEqual(['2026-07']);
  });
});

describe('the QA gates, fail closed', () => {
  it('publishes nothing and submits nothing when a rate of 55 reaches the source', async () => {
    const writer = await published('2026-06');
    await expect(check({ writer, dataset: corrupted('2026-07', 55) })).rejects.toThrow(QaFailed);
  });

  it('records the failure and alerts through NOTIFY_URL', async () => {
    const writer = await published('2026-06');
    const publisher = new DryRunPublisher();
    const submitter = new DryRunSubmitter();
    const runs = new MemoryRunsWriter();
    const { notifier, posted } = notifyUrl();

    await expect(
      runScheduledCheck({
        dataset: corrupted('2026-07', 55),
        config: CONFIG,
        publisher,
        submitter,
        writer,
        runs,
        notifier,
        keyHex: KEY,
        groups: GROUPS,
        now: () => TODAY,
      }),
    ).rejects.toThrow(/bounds/);

    expect(publisher.published).toEqual([]);
    expect(submitter.calls).toEqual([]);

    const rows = await runs.all();
    expect(rows[0]?.state).toBe('failed');
    expect(rows[0]?.finished_at).not.toBeNull();
    expect(rows[0]?.notes).toMatch(/qa failed for 2026-07: bounds, .*u=55/);
    // A rate of 55 is out of bounds and it is also a jump of more than five
    // standard deviations, so both gates name it. Every gate result is in the
    // row, which is what makes a run inspectable months later.
    expect(rows[0]?.qa_json?.[0]?.failures.map((gate) => gate.gate)).toEqual(['bounds', 'jump']);
    expect(rows[0]?.qa_json?.[0]?.gates).toHaveLength(6);

    expect(posted.map((alert) => alert.event)).toEqual(['qa_failed', 'run_failed']);
    expect(posted[0]?.message).toMatch(/Nothing was published and nothing was submitted/);
    expect(posted[0]?.period).toBe('2026-07');
    expect(posted[1]?.run_id).toBe(rows[0]?.id);
  });

  it('fails closed when a group has no row for the period at all', async () => {
    const writer = await published('2026-06');
    const publisher = new DryRunPublisher();
    const runs = new MemoryRunsWriter();
    const { notifier, posted } = notifyUrl();

    await expect(
      runScheduledCheck({
        dataset: corrupted('2026-07', null),
        config: CONFIG,
        publisher,
        submitter: new DryRunSubmitter(),
        writer,
        runs,
        notifier,
        keyHex: KEY,
        groups: GROUPS,
        now: () => TODAY,
      }),
    ).rejects.toThrow(/completeness/);

    expect(publisher.published).toEqual([]);
    expect((await runs.all())[0]?.state).toBe('failed');
    expect(posted.map((alert) => alert.event)).toEqual(['qa_failed', 'run_failed']);
    expect(posted[0]?.message).toMatch(/completeness/);
  });
});

describe('a source that has stopped publishing', () => {
  it('alerts once past the 45 day line, on the injected clock', async () => {
    const writer = await published('2026-07');
    // Forty six days after the end of the newest reference month.
    const { result, posted } = await check({ writer, now: new Date('2026-09-16T00:00:00Z') });
    expect(result.source).toMatchObject({ newest_period: '2026-07', stale_days: 46, stale: true });
    expect(posted.map((alert) => alert.event)).toEqual(['source_stale']);
    expect(posted[0]?.message).toMatch(/past the 45 day line/);
    // A stale source is a notice about the data, not a failed run.
    expect(result.run.state).toBe('done');
  });

  it('says nothing on the day of the event, when the source is 35 days old', async () => {
    const writer = await published('2026-07');
    const { result, posted } = await check({ writer });
    expect(result.source.stale).toBe(false);
    expect(posted).toEqual([]);
  });
});
