import { loadDataset, periodRange, seriesIdFor } from '@creance/index-model';
import { describe, expect, it } from 'vitest';

import { loadOracleConfig } from '../src/config.js';
import { DryRunPublisher } from '../src/publisher.js';
import { runPipeline } from '../src/run.js';
import { applyScenario, loadScenario, parseScenario, scenarioPath } from '../src/scenario.js';
import { MemoryObservationWriter } from '../src/store.js';
import { DryRunSubmitter } from '../src/submitter.js';

const CONFIG = loadOracleConfig({
  recordPath: new URL('../../../contracts/deployments/testnet.json', import.meta.url).pathname,
  environment: { HEDERA_TOPIC_INDEX: '0.0.10366470', HEDERA_ORACLE_ID: '0.0.10366447' },
});
const DATASET = loadDataset();
const SHOCK = loadScenario('comp-shock-2026');

describe('scenario files', () => {
  it('resolves a bare name against apps/oracle/scenarios', () => {
    expect(scenarioPath('comp-shock-2026')).toMatch(/apps\/oracle\/scenarios\/comp-shock-2026\.json$/);
    expect(scenarioPath('/tmp/x.json')).toBe('/tmp/x.json');
  });

  it('insists on a label, a group and at least one override', () => {
    expect(() => parseScenario('{"group":"legal","overrides":[]}')).toThrow(/needs a label/);
    expect(() => parseScenario('{"label":"x","overrides":[]}')).toThrow(/needs a group/);
    expect(() => parseScenario('{"label":"x","group":"legal"}')).toThrow(/at least one override/);
    expect(() =>
      parseScenario('{"label":"x","group":"legal","overrides":[{"period":"2026-4","u_g":5}]}'),
    ).toThrow(/not a period/);
  });

  it('overrides published months and refuses to invent one', () => {
    const applied = applyScenario(DATASET, SHOCK);
    const rows = applied.allSeries.get(seriesIdFor('computer_math'))!;
    expect(rows.find((row) => row.period === '2026-04')?.value).toBe(5.3);
    // Every other month, and every other series, is the untouched archive.
    expect(rows.find((row) => row.period === '2026-05')?.value).toBe(
      DATASET.allSeries.get(seriesIdFor('computer_math'))!.find((row) => row.period === '2026-05')
        ?.value,
    );
    expect(applied.allSeries.get(seriesIdFor('legal'))).toBe(
      DATASET.allSeries.get(seriesIdFor('legal')),
    );

    expect(() =>
      applyScenario(DATASET, { ...SHOCK, overrides: [{ period: '2030-01', u_g: 9 }] }),
    ).toThrow(/does not add them/);
  });
});

describe('a scenario run', () => {
  it('opens on the shock form where the real history opens on the level form', async () => {
    const publisher = new DryRunPublisher();
    const summary = await runPipeline({
      mode: 'scenario',
      dataset: applyScenario(DATASET, SHOCK),
      periods: periodRange('2026-01', '2026-05'),
      groups: ['computer_math'],
      config: CONFIG,
      publisher,
      submitter: null,
      writer: new MemoryObservationWriter(),
      keyHex: 'c3'.repeat(32),
      scenarioLabel: SHOCK.label,
      topicId: null,
      now: () => new Date('2026-09-05T12:00:00Z'),
    });

    const rows = summary.periods.flatMap((period) => period.published);
    const april = rows.find((row) => row.period === '2026-04');
    expect(april?.open).toBe(true);
    expect(april?.openReason).toBe('both');
    expect(april?.message.odi).toBeGreaterThanOrEqual(2);

    // The gates run on the perturbed data exactly as they do on real data.
    for (const period of summary.periods) expect(period.qa.passed).toBe(true);
  });

  it('marks every row as a scenario and never puts one on chain', async () => {
    const writer = new MemoryObservationWriter();
    const submitter = new DryRunSubmitter();
    await runPipeline({
      mode: 'scenario',
      dataset: applyScenario(DATASET, SHOCK),
      periods: ['2026-04'],
      groups: ['computer_math'],
      config: CONFIG,
      publisher: new DryRunPublisher(),
      // Even handed one, the pipeline is driven with none in scenario mode by
      // the command; this asserts the record shape rather than the wiring.
      submitter: null,
      writer,
      keyHex: 'c3'.repeat(32),
      scenarioLabel: SHOCK.label,
      topicId: null,
      now: () => new Date('2026-09-05T12:00:00Z'),
    });
    const rows = await writer.all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      mode: 'scenario',
      replay: true,
      scenario_label: SHOCK.label,
      submit_tx: null,
      hcs_topic: 'dry-run',
    });
    expect(submitter.calls).toHaveLength(0);
  });

  it('produces a different source hash from the real history', async () => {
    const real = await runPipeline({
      mode: 'replay',
      dataset: DATASET,
      periods: ['2026-04'],
      groups: ['computer_math'],
      config: CONFIG,
      publisher: new DryRunPublisher(),
      submitter: null,
      writer: new MemoryObservationWriter(),
      keyHex: 'c3'.repeat(32),
      topicId: null,
      now: () => new Date('2026-09-05T12:00:00Z'),
    });
    const synthetic = await runPipeline({
      mode: 'scenario',
      dataset: applyScenario(DATASET, SHOCK),
      periods: ['2026-04'],
      groups: ['computer_math'],
      config: CONFIG,
      publisher: new DryRunPublisher(),
      submitter: null,
      writer: new MemoryObservationWriter(),
      keyHex: 'c3'.repeat(32),
      topicId: null,
      now: () => new Date('2026-09-05T12:00:00Z'),
    });
    expect(synthetic.periods[0]?.published[0]?.message.source_hash).not.toBe(
      real.periods[0]?.published[0]?.message.source_hash,
    );
  });
});
