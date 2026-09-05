import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveByTitle, type CatalogueEntry } from './catalogue.js';

/**
 * The trigger universe: the ten A-13 sub-groups and five detailed groups, all
 * bindable, plus the all-occupation rate that every excess is measured against.
 * Sixteen series. There is no armed forces series in the catalogue, which is why
 * the picker carries fifteen rows and not eleven.
 */

export interface GroupDefinition {
  groupKey: string;
  label: string;
  /** The exact ln.series title the resolution procedure matches on. */
  catalogueTitle: string;
  bindable: boolean;
}

const RATE = '(Unadj) Unemployment Rate';

export const AGGREGATE_KEY = 'aggregate';

export const GROUP_DEFINITIONS: readonly GroupDefinition[] = [
  {
    groupKey: 'management_business_financial',
    label: 'Management, business and financial operations',
    catalogueTitle: `${RATE} - Management, Business, and Financial Operations Occupations`,
    bindable: true,
  },
  {
    groupKey: 'professional_related',
    label: 'Professional and related',
    catalogueTitle: `${RATE} - Professional and Related Occupations`,
    bindable: true,
  },
  {
    groupKey: 'service',
    label: 'Service',
    catalogueTitle: `${RATE} - Service Occupations`,
    bindable: true,
  },
  {
    groupKey: 'sales_related',
    label: 'Sales and related',
    catalogueTitle: `${RATE} - Sales and Related Occupations`,
    bindable: true,
  },
  {
    groupKey: 'office_admin_support',
    label: 'Office and administrative support',
    catalogueTitle: `${RATE} - Office and Administrative Support Occupations`,
    bindable: true,
  },
  {
    groupKey: 'farming_fishing_forestry',
    label: 'Farming, fishing and forestry',
    catalogueTitle: `${RATE} - Farming, Fishing, and Forestry Occupations`,
    bindable: true,
  },
  {
    groupKey: 'construction_extraction',
    label: 'Construction and extraction',
    catalogueTitle: `${RATE} - Construction and Extraction Occupations`,
    bindable: true,
  },
  {
    groupKey: 'installation_maintenance_repair',
    label: 'Installation, maintenance and repair',
    catalogueTitle: `${RATE} - Installation, Maintenance, and Repair Occupations`,
    bindable: true,
  },
  {
    groupKey: 'production',
    label: 'Production',
    catalogueTitle: `${RATE} - Production Occupations`,
    bindable: true,
  },
  {
    groupKey: 'transportation_material_moving',
    label: 'Transportation and material moving',
    catalogueTitle: `${RATE} - Transportation and Material Moving Occupations`,
    bindable: true,
  },
  {
    groupKey: 'computer_math',
    label: 'Computer and mathematical',
    catalogueTitle: `${RATE} - Computer and Mathematical Occupations`,
    bindable: true,
  },
  {
    groupKey: 'legal',
    label: 'Legal',
    catalogueTitle: `${RATE} - Legal Occupations`,
    bindable: true,
  },
  {
    groupKey: 'arts_design_ent_media',
    label: 'Arts, design, entertainment, sports and media',
    catalogueTitle: `${RATE} - Arts, Design, Entertainment, Sports, and Media Occupations`,
    bindable: true,
  },
  {
    groupKey: 'business_financial_ops',
    label: 'Business and financial operations',
    catalogueTitle: `${RATE} - Business and Financial Operations Occupations`,
    bindable: true,
  },
  {
    groupKey: 'education_training_library',
    label: 'Education, training and library',
    catalogueTitle: `${RATE} - Education, Training, and Library Occupations`,
    bindable: true,
  },
  {
    groupKey: AGGREGATE_KEY,
    label: 'All occupations',
    catalogueTitle: RATE,
    bindable: false,
  },
];

export interface SeriesMapEntry {
  group_key: string;
  label: string;
  bls_series_id: string;
  source: string;
  selected_by: string;
  notes: string;
}

export interface SeriesMap {
  catalogue: {
    file: string;
    sha256: string;
    resolved_on: string;
  };
  series: SeriesMapEntry[];
}

/**
 * Run the resolution procedure against a parsed catalogue. Called once to write
 * the frozen mapping, and again by the test suite to prove the frozen file is
 * still what the catalogue says.
 */
export function resolveSeriesMap(
  catalogue: readonly CatalogueEntry[],
  catalogueSha256: string,
  resolvedOn: string,
): SeriesMap {
  const series = GROUP_DEFINITIONS.map((definition) => {
    const entry = resolveByTitle(catalogue, definition.catalogueTitle, {
      requireOccupation: definition.groupKey !== AGGREGATE_KEY,
    });
    return {
      group_key: definition.groupKey,
      label: definition.label,
      bls_series_id: entry.seriesId,
      source: 'CPS LN',
      selected_by: 'T02',
      notes:
        definition.groupKey === AGGREGATE_KEY
          ? 'All-occupation rate, the denominator of every excess. Not bindable.'
          : `${entry.title}, ${entry.beginYear} ${entry.beginPeriod} onward.`,
    };
  });
  return {
    catalogue: {
      file: 'data/bls/raw/ln.series.gz',
      sha256: catalogueSha256,
      resolved_on: resolvedOn,
    },
    series,
  };
}

const HERE = dirname(fileURLToPath(import.meta.url));

/** The frozen mapping. Changing a series id after settlement is forbidden. */
export function loadSeriesMap(): SeriesMap {
  return JSON.parse(readFileSync(join(HERE, 'series-map.json'), 'utf8')) as SeriesMap;
}

export function bindableGroups(map: SeriesMap = loadSeriesMap()): SeriesMapEntry[] {
  return map.series.filter((entry) => entry.group_key !== AGGREGATE_KEY);
}

export function aggregateSeriesId(map: SeriesMap = loadSeriesMap()): string {
  const entry = map.series.find((e) => e.group_key === AGGREGATE_KEY);
  if (!entry) throw new Error('series-map.json has no aggregate row');
  return entry.bls_series_id;
}

export function seriesIdFor(groupKey: string, map: SeriesMap = loadSeriesMap()): string {
  const entry = map.series.find((e) => e.group_key === groupKey);
  if (!entry) throw new Error(`series-map.json has no row for ${groupKey}`);
  return entry.bls_series_id;
}
