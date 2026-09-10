import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { findSeries, loadOracleConfig, seriesForGroup } from '../src/config.js';

/// The real deployment record is the fixture: if it stops carrying the demo
/// series, every command in this workspace stops working and the test says so
/// before a run does.
const RECORD = new URL('../../../contracts/deployments/testnet.json', import.meta.url).pathname;
const RESOURCES = new URL('../../../docs/hedera.testnet.json', import.meta.url).pathname;

const MINIMAL = {
  HEDERA_TOPIC_INDEX: '0.0.10366470',
  HEDERA_ORACLE_ID: '0.0.10366447',
};

describe('oracle configuration', () => {
  it('reads every registered series and the contracts out of the deployment record', () => {
    const config = loadOracleConfig({ recordPath: RECORD, environment: MINIMAL });
    expect(config.network).toBe('testnet');
    expect(config.coverPoolAddress).toBe('0x6358ddd5AA2e1797ddA949D7d82eA86C9F89ff09');
    expect(config.vaultAddress).toBe('0xD0473d355ECB299F2ECc0d92124bc8CF63554e60');
    expect(config.submitGasLimit).toBe(1_000_000);
    // The demo series stays the head, and every group registered beside it
    // is a series the oracle may submit an on-chain observation for.
    expect(config.series[0]).toEqual({
      label: 'ODI-COMP-2026-01',
      seriesId: '0x4f44492d434f4d502d323032362d303100000000000000000000000000000000',
      groupKey: 'computer_math',
    });
    expect(new Set(config.series.map((series) => series.groupKey)).size).toBe(
      config.series.length,
    );
  });

  it('finds a series by label, by key and by group', () => {
    const config = loadOracleConfig({ recordPath: RECORD, environment: MINIMAL });
    expect(findSeries(config, 'odi-comp-2026-01')?.groupKey).toBe('computer_math');
    expect(findSeries(config, config.series[0]!.seriesId)?.label).toBe('ODI-COMP-2026-01');
    expect(findSeries(config, 'ODI-NOPE')).toBeUndefined();
    expect(seriesForGroup(config, 'computer_math')?.label).toBe('ODI-COMP-2026-01');
    expect(seriesForGroup(config, 'legal')?.label).toBe('ODI-LEGL-2026-01');
    // A group that is not an occupation the index covers has no series.
    expect(seriesForGroup(config, 'armed_forces')).toBeUndefined();
  });

  it('falls back to the day 0 resources for the topic and the oracle account', () => {
    const config = loadOracleConfig({
      recordPath: RECORD,
      resourcesPath: RESOURCES,
      environment: {},
    });
    expect(config.topicId).toBe('0.0.10366470');
    expect(config.accountId).toBe('0.0.10366447');
  });

  it('lets the environment win over the resources file', () => {
    const config = loadOracleConfig({
      recordPath: RECORD,
      resourcesPath: RESOURCES,
      environment: { HEDERA_TOPIC_INDEX: '0.0.999' },
    });
    expect(config.topicId).toBe('0.0.999');
  });

  it('names the variable that is missing rather than failing later', () => {
    expect(() =>
      loadOracleConfig({ recordPath: RECORD, resourcesPath: '/nope.json', environment: {} }),
    ).toThrow(/HEDERA_TOPIC_INDEX/);
  });

  it('reads a copied example environment, where every line it documents is blank', () => {
    // README Setup says to copy the example and fill in the few lines it names.
    // Every other line then arrives as `NAME=`, which is the empty string and
    // not absence, and it must not erase the resources file or a default.
    const example = new URL('../../../.env.example', import.meta.url).pathname;
    const environment: Record<string, string> = {};
    for (const line of readFileSync(example, 'utf8').split('\n')) {
      const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
      if (match !== null) environment[match[1]!] = match[2]!;
    }
    const config = loadOracleConfig({ recordPath: RECORD, resourcesPath: RESOURCES, environment });
    expect(config.topicId).toBe('0.0.10366470');
    expect(config.accountId).toBe('0.0.10366447');
    expect(config.coverPoolAddress).toBe('0x6358ddd5AA2e1797ddA949D7d82eA86C9F89ff09');
    expect(config.submitGasLimit).toBe(1_000_000);
    expect(config.statePath).toMatch(/replay-state\.json$/);
  });

  it('refuses a record for any network but testnet', () => {
    const other = new URL('./fixtures/previewnet-record.json', import.meta.url).pathname;
    expect(() => loadOracleConfig({ recordPath: other, environment: MINIMAL })).toThrow(
      /testnet only/,
    );
  });
});
