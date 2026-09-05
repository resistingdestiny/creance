import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  datasetFrom,
  isPeriod,
  seriesIdFor,
  type Dataset,
  type Period,
  type SourceObservation,
} from '@creance/index-model';

/**
 * Scenario mode: a labelled synthetic trigger, for the case DESIGN.md 3.3
 * allows where no real historical window opens for the demo group.
 *
 * A scenario is an overlay on the real archive, not a file of made up rows. It
 * names one group and replaces that group's published rate in a handful of
 * months; everything else, the other fifteen series, the aggregate, the
 * smoothing window and the base period, stays the real source. Two things
 * follow, and both matter.
 *
 * The QA gates still bite. docs/INDEX-SPEC.md section 5 says replay and
 * scenario bypass fetch and still pass qa, and a one-group file could not:
 * completeness needs all sixteen series and consistency needs the aggregate.
 * An overlay passes or fails the same gates a live run does, which is what
 * makes a scenario a demonstration of the pipeline rather than a bypass of it.
 *
 * The provenance stays honest. The source hash is taken over the rows the
 * computation actually used, so a scenario's hash does not match the archive's
 * and no reader can mistake one for the other.
 *
 * A scenario never touches the demo series on testnet: see `scenario.ts` in the
 * replay command, which refuses the chain call and defaults the topic off.
 */

export interface ScenarioOverride {
  period: Period;
  /** The synthetic rate for the group, in published percentage points. */
  u_g: number;
}

export interface Scenario {
  /** What a screen says while this is running. */
  label: string;
  group: string;
  note: string;
  overrides: ScenarioOverride[];
}

export function scenariosRoot(): string {
  return fileURLToPath(new URL('../scenarios/', import.meta.url));
}

/** Resolve a bare name against apps/oracle/scenarios, or take a path. */
export function scenarioPath(nameOrPath: string): string {
  if (isAbsolute(nameOrPath) || nameOrPath.includes('/')) return nameOrPath;
  const name = nameOrPath.endsWith('.json') ? nameOrPath : `${nameOrPath}.json`;
  return join(scenariosRoot(), name);
}

export function parseScenario(text: string): Scenario {
  const raw = JSON.parse(text) as Partial<Scenario>;
  if (typeof raw.label !== 'string' || raw.label.length === 0) {
    throw new Error('a scenario needs a label: it is what the screen says while it runs');
  }
  if (typeof raw.group !== 'string' || raw.group.length === 0) {
    throw new Error('a scenario needs a group');
  }
  if (!Array.isArray(raw.overrides) || raw.overrides.length === 0) {
    throw new Error('a scenario needs at least one override');
  }
  for (const override of raw.overrides) {
    if (!isPeriod(override.period)) {
      throw new Error(`${String(override.period)} is not a period like 2026-04`);
    }
    if (typeof override.u_g !== 'number' || !Number.isFinite(override.u_g)) {
      throw new Error(`the override for ${override.period} has no rate`);
    }
  }
  return {
    label: raw.label,
    group: raw.group,
    note: raw.note ?? '',
    overrides: raw.overrides,
  };
}

export function loadScenario(nameOrPath: string): Scenario {
  return parseScenario(readFileSync(scenarioPath(nameOrPath), 'utf8'));
}

/**
 * Apply a scenario to a dataset. Overriding a month the source never published
 * is refused: a scenario perturbs history, it does not invent months, and a
 * fabricated row would sail through the completeness gate that exists to catch
 * exactly that.
 */
export function applyScenario(dataset: Dataset, scenario: Scenario): Dataset {
  const seriesId = seriesIdFor(scenario.group, dataset.map);
  const existing = dataset.allSeries.get(seriesId);
  if (existing === undefined) throw new Error(`the source has no ${seriesId}`);

  const wanted = new Map(scenario.overrides.map((override) => [override.period, override.u_g]));
  const rows: SourceObservation[] = existing.map((row) => {
    const value = wanted.get(row.period);
    if (value === undefined) return row;
    wanted.delete(row.period);
    return { ...row, value, raw: value.toFixed(1), footnoteCodes: [...row.footnoteCodes] };
  });
  if (wanted.size > 0) {
    throw new Error(
      `the source has no ${scenario.group} row for ${[...wanted.keys()].join(', ')}: a scenario overrides published months, it does not add them`,
    );
  }

  const allSeries = new Map(dataset.allSeries);
  allSeries.set(seriesId, rows);
  return datasetFrom(
    allSeries,
    {
      ...dataset.source,
      kind: dataset.source.kind,
      description: `${dataset.source.description}, with the ${scenario.label} scenario applied to ${scenario.group}`,
    },
    dataset.archive,
    dataset.map,
  );
}
