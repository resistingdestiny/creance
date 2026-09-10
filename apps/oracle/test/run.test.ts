import {
  addMonths,
  datasetFrom,
  evaluateDataset,
  frozenParameters,
  loadDataset,
  periodRange,
  seriesIdFor,
  type Dataset,
  type Period,
  type SourceObservation,
} from '@creance/index-model';
import { describe, expect, it } from 'vitest';

import { loadOracleConfig } from '../src/config.js';
import { addressOfKey, verifyMessage } from '../src/message.js';
import { DryRunPublisher } from '../src/publisher.js';
import { QaFailed, periodsUsed, precheckWindow, runPipeline } from '../src/run.js';
import { MemoryObservationWriter, recordKey } from '../src/store.js';
import { DryRunSubmitter, NULL_ODI } from '../src/submitter.js';

/// The pipeline is exercised against the committed archive with the chain
/// adapters swapped for the dry run pair, so the compute, QA, message, source
/// hash and encoding paths are all real and only the two network calls are not.
/// `pnpm test` stays chain-free; the testnet run has its own command.

const RECORD = new URL('../../../contracts/deployments/testnet.json', import.meta.url).pathname;
const CONFIG = loadOracleConfig({
  recordPath: RECORD,
  environment: { HEDERA_TOPIC_INDEX: '0.0.10366470', HEDERA_ORACLE_ID: '0.0.10366447' },
});
const KEY = 'b2'.repeat(32);
const DATASET = loadDataset();

/// The replay window of DESIGN.md 3.4, and the two months it opens on.
const REPLAY: Period[] = periodRange('2025-01', '2026-07');

function base(overrides: Record<string, unknown> = {}) {
  return {
    mode: 'replay' as const,
    dataset: DATASET,
    periods: REPLAY,
    groups: ['computer_math'],
    config: CONFIG,
    publisher: new DryRunPublisher(),
    submitter: new DryRunSubmitter(),
    writer: new MemoryObservationWriter(),
    keyHex: KEY,
    now: () => new Date('2026-09-05T12:00:00Z'),
    ...overrides,
  };
}

/// The demo group months a topic already carries, as the pipeline takes them.
function onTopic(periods: readonly string[]) {
  return new Map(
    periods.map((period, index) => [
      recordKey({ group_key: 'computer_math', period: period as Period, mode: 'replay' }),
      {
        sequenceNumber: index + 1,
        message: { status: 'final', odi: 0.3, ebar: -0.6, source_hash: 'ab'.repeat(32) },
      },
    ]),
  );
}

describe('the source hash window', () => {
  it('commits to the six calendar months a period is computed from', () => {
    expect(periodsUsed('2026-04')).toEqual([
      '2026-04',
      '2026-03',
      '2026-02',
      '2025-04',
      '2025-03',
      '2025-02',
    ]);
  });
});

describe('the replay of real history for the demo series', () => {
  // "publishes sixteen" until the count was checked against the body of the
  // test: nineteen months are published, sixteen of them with a final status.
  // Sixteen and thirteen are the testnet proof run's numbers, not this test's.
  it('walks nineteen months, publishes all nineteen and opens in April and May 2026', async () => {
    const summary = await runPipeline(base());
    expect(summary.periods).toHaveLength(19);
    expect(summary.publishedCount).toBe(19);

    const rows = summary.periods.flatMap((period) => period.published);
    const statuses = rows.filter((row) => row.status === 'final');
    expect(statuses).toHaveLength(16);
    expect(rows.filter((row) => row.status === 'no_source').map((row) => row.period)).toEqual([
      '2025-10',
    ]);
    expect(
      rows.filter((row) => row.status === 'insufficient_history').map((row) => row.period),
    ).toEqual(['2025-11', '2025-12']);

    const open = rows.filter((row) => row.open);
    expect(open.map((row) => row.period)).toEqual(['2026-04', '2026-05']);
    expect(open.map((row) => row.openReason)).toEqual(['level', 'level']);
  });

  it('reproduces the published numbers the demo turns on', async () => {
    const summary = await runPipeline(base());
    const april = summary.periods
      .flatMap((period) => period.published)
      .find((row) => row.period === '2026-04');
    expect(april?.message).toMatchObject({
      series: 'ODI-COMP-2026-01',
      group: 'computer_math',
      u_g: 3.5,
      u_all: 4,
      e: -0.5,
      ebar: -0.6,
      odi: 0.3,
      level_line: -0.68,
      attachment_shock: 2,
      open: true,
      open_reason: 'level',
      status: 'final',
    });
  });

  it('keeps every message signed, canonical and under a kilobyte', async () => {
    const summary = await runPipeline(base());
    for (const row of summary.periods.flatMap((period) => period.published)) {
      expect(row.bytes).toBeLessThan(1024);
      expect(verifyMessage(row.message, addressOfKey(KEY))).toBe(true);
    }
  });

  it('submits only the sixteen final months, in ascending order', async () => {
    const submitter = new DryRunSubmitter();
    const summary = await runPipeline(base({ submitter }));
    expect(summary.submittedCount).toBe(16);
    expect(submitter.calls.map((call) => call.period)).toEqual([
      202501, 202502, 202503, 202504, 202505, 202506, 202507, 202508, 202509, 202601, 202602,
      202603, 202604, 202605, 202606, 202607,
    ]);
    // The gap months are published and never settled.
    expect(submitter.calls.some((call) => call.period === 202510)).toBe(false);

    const april = submitter.calls.find((call) => call.period === 202604);
    expect(april).toMatchObject({ odi: 3000n, ebar: -6000n });
    expect(april?.hcsSequence).toBeGreaterThan(0n);
  });

  it('names why each unsettled month stayed off chain', async () => {
    const summary = await runPipeline(base());
    const reasons = summary.periods
      .flatMap((period) => period.published)
      .filter((row) => row.submit === null)
      .map((row) => row.submitSkipped);
    expect(reasons).toEqual([
      'status is no_source, only final months settle',
      'status is insufficient_history, only final months settle',
      'status is insufficient_history, only final months settle',
    ]);
  });

  it('is idempotent: a second run publishes nothing and submits nothing', async () => {
    const writer = new MemoryObservationWriter();
    await runPipeline(base({ writer }));
    const submitter = new DryRunSubmitter();
    const second = await runPipeline(base({ writer, submitter }));
    expect(second.publishedCount).toBe(0);
    expect(second.skippedCount).toBe(19);
    expect(submitter.calls).toHaveLength(0);
  });

  it('publishes nothing the topic already carries, even with an empty store', async () => {
    // The clean clone case. The store is a file under var/ that a clone does
    // not have, so on a fresh machine every month of the demo window looks
    // unpublished and the replay would put a second message on the shared
    // index topic for each one. What settled is what the topic says.
    const publisher = new DryRunPublisher();
    const submitter = new DryRunSubmitter();
    const summary = await runPipeline(
      base({
        writer: new MemoryObservationWriter(),
        publisher,
        submitter,
        publishedOnTopic: onTopic(['2026-05', '2026-06', '2026-07']),
        periods: ['2026-05', '2026-06', '2026-07'] as Period[],
      }),
    );
    expect(summary.publishedCount).toBe(0);
    expect(summary.skippedCount).toBe(3);
    expect(publisher.published).toHaveLength(0);

    // The contract call still happens, from the message the topic carries. A
    // month can reach the topic and not the chain, and skipping the publish
    // must not also skip the settlement.
    expect(summary.submittedCount).toBe(3);
    expect(submitter.calls.map((call) => call.period)).toEqual([202605, 202606, 202607]);
    expect(submitter.calls.map((call) => call.hcsSequence)).toEqual([1n, 2n, 3n]);
  });

  it('still publishes the months the topic does not carry', async () => {
    const publisher = new DryRunPublisher();
    const summary = await runPipeline(
      base({
        writer: new MemoryObservationWriter(),
        publisher,
        publishedOnTopic: onTopic(['2026-05']),
        periods: ['2026-05', '2026-06'] as Period[],
      }),
    );
    expect(summary.publishedCount).toBe(1);
    expect(summary.skippedCount).toBe(1);
    const periods = publisher.published.map(
      (bytes) => (JSON.parse(bytes.toString('utf8')) as { period: string }).period,
    );
    expect(periods).toEqual(['2026-06']);
  });

  it('does not publish a month again in live mode that the replay already put on the topic', async () => {
    // The demo clock and the live path write the same index topic, and their
    // defaults meet: a replay runs to the newest month the source carries and
    // `oracle:once` defaults to that same month. Keying the guard by mode put
    // two messages for it on the topic, both with revises_seq null, and the two
    // commands read different sources by default, so the pair need not even
    // agree. One period, one message, whichever mode published it.
    const writer = new MemoryObservationWriter();
    const replayPublisher = new DryRunPublisher();
    const replay = await runPipeline(
      base({ writer, publisher: replayPublisher, periods: ['2026-07'] }),
    );
    expect(replay.publishedCount).toBe(1);
    expect(replayPublisher.published).toHaveLength(1);

    const livePublisher = new DryRunPublisher();
    const liveSubmitter = new DryRunSubmitter();
    const live = await runPipeline(
      base({
        writer,
        mode: 'live' as const,
        publisher: livePublisher,
        submitter: liveSubmitter,
        periods: ['2026-07'],
      }),
    );
    expect(livePublisher.published).toHaveLength(0);
    expect(live.publishedCount).toBe(0);
    expect(live.skippedCount).toBe(1);
    expect(liveSubmitter.calls).toHaveLength(0);

    // One row, and it still says which mode published it, which is what the
    // public query filters the demo clock out by.
    const rows = await writer.all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.mode).toBe('replay');
    expect(rows[0]?.replay).toBe(true);
  });

  it('keeps a scenario apart from the months a real run published', async () => {
    // The other direction: a scenario writes no index message, so its rows must
    // never stand in the way of a live or replay publish of the same month.
    const writer = new MemoryObservationWriter();
    await runPipeline(
      base({ writer, mode: 'scenario' as const, submitter: null, periods: ['2026-07'] }),
    );
    const publisher = new DryRunPublisher();
    const live = await runPipeline(
      base({ writer, mode: 'live' as const, publisher, periods: ['2026-07'] }),
    );
    expect(publisher.published).toHaveLength(1);
    expect(live.publishedCount).toBe(1);
    expect(live.skippedCount).toBe(0);
  });

  it('does not republish a period whose contract call threw on an earlier run', async () => {
    // The partial failure that matters: the message is on the topic and cannot
    // be retracted, and then the chain call fails. A retry must not put a
    // second message for that period on the settlement topic.
    const writer = new MemoryObservationWriter();
    const firstPublisher = new DryRunPublisher();
    const failing = new DryRunSubmitter();
    failing.submit = async () => {
      throw new Error('the relay timed out');
    };
    await expect(
      runPipeline(base({ writer, publisher: firstPublisher, submitter: failing, periods: ['2025-01'] })),
    ).rejects.toThrow(/the relay timed out/);

    // The message went out, and the store knows about it even though the run
    // threw after the receipt.
    expect(firstPublisher.published).toHaveLength(1);
    const orphan = await writer.get('computer_math', '2025-01', 'replay');
    expect(orphan?.hcs_seq).toBe(1);
    expect(orphan?.submit_tx).toBeNull();

    const secondPublisher = new DryRunPublisher();
    const working = new DryRunSubmitter();
    const second = await runPipeline(
      base({ writer, publisher: secondPublisher, submitter: working, periods: ['2025-01'] }),
    );
    expect(secondPublisher.published).toHaveLength(0);
    expect(second.publishedCount).toBe(0);
    expect(second.skippedCount).toBe(1);
  });

  it('finishes the contract call for a period that was published but never settled', async () => {
    const writer = new MemoryObservationWriter();
    const failing = new DryRunSubmitter();
    failing.submit = async () => {
      throw new Error('the relay timed out');
    };
    await expect(
      runPipeline(base({ writer, submitter: failing, periods: ['2025-01'] })),
    ).rejects.toThrow(/the relay timed out/);

    const working = new DryRunSubmitter();
    const second = await runPipeline(
      base({ writer, publisher: new DryRunPublisher(), submitter: working, periods: ['2025-01'] }),
    );
    expect(second.submittedCount).toBe(1);
    expect(working.calls).toHaveLength(1);
    // It resubmits the message that is on the topic, not a recomputed one: the
    // sequence number and the source hash are the stored message's.
    expect(working.calls[0]?.period).toBe(202501);
    expect(working.calls[0]?.hcsSequence).toBe(1n);
    const settled = await writer.get('computer_math', '2025-01', 'replay');
    expect(settled?.submit_tx).toBe('dry-run-202501');
    expect(`0x${settled?.message.source_hash}`).toBe(working.calls[0]?.sourceHash);

    // And a third run has nothing left to do at all.
    const third = await runPipeline(
      base({ writer, publisher: new DryRunPublisher(), submitter: new DryRunSubmitter(), periods: ['2025-01'] }),
    );
    expect(third.publishedCount).toBe(0);
    expect(third.submittedCount).toBe(0);
  });

  it('does not resubmit a period the contract already holds', async () => {
    const submitter = new DryRunSubmitter();
    submitter.hasObservation = async () => true;
    const summary = await runPipeline(base({ submitter }));
    expect(summary.submittedCount).toBe(0);
    expect(
      summary.periods
        .flatMap((period) => period.published)
        .some((row) => row.submitSkipped?.includes('already on chain')),
    ).toBe(true);
  });

  it('refuses to submit behind the last month the series observed', async () => {
    // 2026-04 is month index 24315, so a series that has already observed it
    // must decline every month up to and including it.
    const submitter = new DryRunSubmitter({ lastObservedMonth: 24315 });
    const summary = await runPipeline(base({ submitter }));
    expect(submitter.calls.map((call) => call.period)).toEqual([202605, 202606, 202607]);
    expect(summary.submittedCount).toBe(3);
  });

  it('publishes and never submits for a series that is not Active', async () => {
    const submitter = new DryRunSubmitter({ status: 4, statusName: 'Matured', acceptsObservations: false });
    const summary = await runPipeline(base({ submitter }));
    expect(summary.publishedCount).toBe(19);
    expect(summary.submittedCount).toBe(0);
  });

  it('publishes without a chain call at all when the submitter is off', async () => {
    const summary = await runPipeline(base({ submitter: null }));
    expect(summary.publishedCount).toBe(19);
    expect(summary.submittedCount).toBe(0);
    expect(summary.periods[0]?.published[0]?.submitSkipped).toBe(
      'chain submission is off for this run',
    );
  });
});

describe('the live path over every bindable group', () => {
  it('publishes one message per group and settles every registered series', async () => {
    const submitter = new DryRunSubmitter();
    const summary = await runPipeline(
      base({ mode: 'live', periods: ['2026-07'], groups: null, submitter }),
    );
    expect(summary.publishedCount).toBe(15);
    // Every group has a series behind it since T39, so every published
    // observation settles rather than skipping for want of one.
    expect(summary.submittedCount).toBe(15);
    expect(submitter.calls).toHaveLength(15);
    const unsettled = summary.periods[0]?.published.filter((row) => row.submit === null) ?? [];
    expect(unsettled).toHaveLength(0);
    expect(summary.periods[0]?.published.filter((row) => row.seriesLabel !== null)).toHaveLength(
      15,
    );
  });

  it('refuses to settle a month that has not happened yet', async () => {
    const submitter = new DryRunSubmitter();
    const summary = await runPipeline(
      base({ periods: ['2026-07'], submitter, now: () => new Date('2026-06-15T00:00:00Z') }),
    );
    expect(summary.submittedCount).toBe(0);
    expect(summary.periods[0]?.published[0]?.submitSkipped).toMatch(/has not started yet/);
  });
});

describe('the QA gates stop a run before anything is published', () => {
  it('publishes nothing and submits nothing when a rate is corrupted', async () => {
    const computer = seriesIdFor('computer_math');
    const rows: SourceObservation[] = (DATASET.allSeries.get(computer) ?? []).map((row) =>
      row.period === '2026-04' ? { ...row, value: 55, raw: '55.0' } : row,
    );
    const series = new Map(DATASET.allSeries);
    series.set(computer, rows);
    const corrupted: Dataset = datasetFrom(series, DATASET.source, DATASET.archive, DATASET.map);

    const publisher = new DryRunPublisher();
    const submitter = new DryRunSubmitter();
    const writer = new MemoryObservationWriter();
    await expect(
      runPipeline(base({ dataset: corrupted, periods: ['2026-04'], publisher, submitter, writer })),
    ).rejects.toBeInstanceOf(QaFailed);

    expect(publisher.published).toHaveLength(0);
    expect(submitter.calls).toHaveLength(0);
    expect(await writer.all()).toHaveLength(0);
  });

  it('stops the walk at the first bad period, keeping what came before', async () => {
    const computer = seriesIdFor('computer_math');
    const series = new Map(DATASET.allSeries);
    series.set(
      computer,
      (DATASET.allSeries.get(computer) ?? []).filter((row) => row.period !== '2026-03'),
    );
    const corrupted = datasetFrom(series, DATASET.source, DATASET.archive, DATASET.map);

    // The failure is at 2026-03, in the middle of the window. Nothing at all is
    // published, including the two months before it that pass their own gates:
    // an HCS message cannot be retracted, so a window that cannot finish must
    // not put its first half on the settlement topic.
    const publisher = new DryRunPublisher();
    await expect(
      runPipeline(
        base({ dataset: corrupted, periods: periodRange('2026-01', '2026-04'), publisher }),
      ),
    ).rejects.toThrow(/completeness/);
    expect(publisher.published).toHaveLength(0);
  });
});

/** Await a pipeline run that must fail its gates, and hand back the failure. */
async function catchQaFailure(run: Promise<unknown>): Promise<QaFailed> {
  try {
    await run;
  } catch (error) {
    if (error instanceof QaFailed) return error;
    throw error;
  }
  throw new Error('the run was expected to fail its QA gates and did not');
}

describe('the whole window is gated before anything is published', () => {
  /// pnpm oracle:replay --from 2019-01 is the command acceptance item 2 names.
  /// April 2020 moves every white collar group past five standard deviations,
  /// so the jump gate stops the run, which is what INDEX-SPEC section 8 asks
  /// for. What matters is that it stops before the topic, not after fifteen
  /// months of it.
  const PANDEMIC = periodRange('2019-01', '2020-06');

  it('publishes nothing when a later period in the window fails', async () => {
    const publisher = new DryRunPublisher();
    const submitter = new DryRunSubmitter();
    const writer = new MemoryObservationWriter();
    await expect(
      runPipeline(base({ periods: PANDEMIC, publisher, submitter, writer })),
    ).rejects.toBeInstanceOf(QaFailed);
    expect(publisher.published).toHaveLength(0);
    expect(submitter.calls).toHaveLength(0);
    expect(await writer.all()).toHaveLength(0);
  });

  it('names the failing period and the longest window that would run', async () => {
    const error = await catchQaFailure(runPipeline(base({ periods: PANDEMIC })));
    expect(error.report.period).toBe('2020-04');
    expect(error.report.failures.map((gate) => gate.gate)).toEqual(['jump']);
    expect(error.lastPassing).toBe('2020-03');
  });

  it('runs the window it suggests', async () => {
    const summary = await runPipeline(base({ periods: periodRange('2019-01', '2020-03') }));
    expect(summary.publishedCount).toBe(15);
    expect(summary.periods.every((period) => period.qa.passed)).toBe(true);
  });

  it('reports no usable prefix when the first period fails', async () => {
    const computer = seriesIdFor('computer_math');
    const series = new Map(DATASET.allSeries);
    series.set(
      computer,
      (DATASET.allSeries.get(computer) ?? []).map((row) =>
        row.period === '2026-04' ? { ...row, value: 55, raw: '55.0' } : row,
      ),
    );
    const corrupted = datasetFrom(series, DATASET.source, DATASET.archive, DATASET.map);
    const error = await catchQaFailure(
      runPipeline(base({ dataset: corrupted, periods: periodRange('2026-04', '2026-05') })),
    );
    expect(error.report.period).toBe('2026-04');
    expect(error.lastPassing).toBeNull();
  });

  it('gates every period exactly once and hands the reports back', async () => {
    const observations = evaluateDataset(
      DATASET,
      frozenParameters(),
      addMonths('2019-01', -25),
      '2020-06',
    );
    const { reports, failure } = precheckWindow(DATASET, observations, PANDEMIC);
    expect(reports.size).toBe(PANDEMIC.length);
    expect(failure?.report.period).toBe('2020-04');
    expect(failure?.lastPassing).toBe('2020-03');
    // Every period is gated, including the ones after the failure, so an
    // operator sees the whole picture rather than one month at a time.
    expect([...reports.keys()]).toEqual(PANDEMIC);
    expect([...reports].filter(([, report]) => !report.passed).map(([period]) => period)).toEqual([
      '2020-04',
    ]);
  });
});

describe('a month with no evaluable ODI', () => {
  it('publishes odi null and sends the smallest int64 on chain', async () => {
    // The archive starts in 2000-01, so the smoothed excess starts in 2000-03
    // and the base period twelve months behind 2001-01 has none. The month is
    // final, carries an ebar, and the shock form cannot be evaluated at all.
    // The same shape returns in 2026-10, twelve months after the collection gap.
    const noBase: Period = '2001-01';
    const submitter = new DryRunSubmitter();
    const summary = await runPipeline(base({ periods: [noBase], submitter }));
    const row = summary.periods[0]?.published[0];
    expect(row?.status).toBe('final');
    expect(row?.message.odi).toBeNull();
    expect(row?.message.ebar).not.toBeNull();
    expect(submitter.calls[0]?.odi).toBe(NULL_ODI);
  });
});

describe('the demo clock cadence', () => {
  it('dwells the remainder of the interval and never between the last two', async () => {
    const waits: number[] = [];
    await runPipeline(
      base({
        periods: periodRange('2025-01', '2025-04'),
        intervalMs: 10_000,
        sleep: async (ms: number) => {
          waits.push(ms);
        },
      }),
    );
    expect(waits).toHaveLength(3);
    for (const wait of waits) expect(wait).toBeLessThanOrEqual(10_000);
  });
});
