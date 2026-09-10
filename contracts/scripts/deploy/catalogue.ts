import { loadCalibration, type FrozenCalibrationEntry } from '@creance/index-model';

import { EXHAUSTION_MULTIPLE, GROUP_LABEL, SERIES_LABEL, toScaledPoints } from './config.js';

/// The series catalogue: one Displacement Bond Note series per occupation
/// group, which is the capacity rule in DESIGN.md 3.2.
///
/// Nothing here is a new model. The shock attachment and the level line come
/// from packages/index-model/src/calibration.json, the frozen per group
/// calibration, and are scaled to the chain's signed 1e4 integers by
/// `toScaledPoints`. The only per series values invented here are the label,
/// the note symbol and the size of the note, and each of those is a naming
/// decision rather than a modelling one.
///
/// The order is the order the runner works in, and it is the order the ticket
/// asks for: the demo series first, because it is already on chain and the API
/// takes the head of the list as its default, then office and administrative
/// support because it is the copy deck's worked example, then transportation
/// and material moving, production and sales and related, then the rest. A run
/// that stops half way leaves a correct prefix.

export interface CatalogueEntry {
  /// The occupation group key, the same string the index model, the API and
  /// the picker use.
  groupKey: string;
  /// The series label, which is also the bytes32 key once right padded.
  label: string;
  /// The note's ticker. `CDBN01` is the demo note and is already deployed, so
  /// the numbering is fixed per group rather than derived from a position.
  noteSymbol: string;
  /// Units of the note at 1,000 nominal each, so units times 1,000 is the
  /// principal. The demo note is 100 units, 100,000 principal; every later
  /// series is 25 units, 25,000 principal, which is the capacity the operator
  /// funds it with, so the note and the vault agree on the size of the series.
  noteUnits: bigint;
}

/// The four character code inside the label, per group. Codes are fixed here
/// rather than derived from the label, because a derived code would change if
/// anybody ever edited a group's on-screen wording and the series id is frozen
/// at registration.
const CODES: Record<string, string> = {
  computer_math: 'COMP',
  office_admin_support: 'OFFC',
  transportation_material_moving: 'TRAN',
  production: 'PROD',
  sales_related: 'SALE',
  management_business_financial: 'MGMT',
  professional_related: 'PROF',
  service: 'SERV',
  construction_extraction: 'CNST',
  installation_maintenance_repair: 'INMR',
  farming_fishing_forestry: 'FARM',
  business_financial_ops: 'BUSF',
  education_training_library: 'EDUC',
  legal: 'LEGL',
  arts_design_ent_media: 'ARTS',
};

/// The order the runner issues in. Every key here is a key in CODES and the
/// two lists are checked against each other at load.
const ORDER: readonly string[] = [
  'computer_math',
  'office_admin_support',
  'transportation_material_moving',
  'production',
  'sales_related',
  'management_business_financial',
  'professional_related',
  'service',
  'construction_extraction',
  'installation_maintenance_repair',
  'farming_fishing_forestry',
  'business_financial_ops',
  'education_training_library',
  'legal',
  'arts_design_ent_media',
];

/// The note number, two digits, in catalogue order. The demo note is 01 and
/// that is what is on chain, so the sequence starts there.
function noteSymbolFor(groupKey: string): string {
  const position = ORDER.indexOf(groupKey) + 1;
  return `CDBN${String(position).padStart(2, '0')}`;
}

/// The label a group's series carries. The demo series keeps the exact string
/// that is registered on chain.
export function labelFor(groupKey: string): string {
  if (groupKey === GROUP_LABEL) return SERIES_LABEL;
  const code = CODES[groupKey];
  if (code === undefined) throw new Error(`no series code for the group "${groupKey}"`);
  return `ODI-${code}-2026-01`;
}

/// The size of a group's note in units of 1,000 nominal.
const DEMO_UNITS = 100n;
const SERIES_UNITS = 25n;

export function catalogue(): CatalogueEntry[] {
  return ORDER.map((groupKey) => ({
    groupKey,
    label: labelFor(groupKey),
    noteSymbol: noteSymbolFor(groupKey),
    noteUnits: groupKey === GROUP_LABEL ? DEMO_UNITS : SERIES_UNITS,
  }));
}

export interface SeriesThresholds {
  attachmentShock: bigint;
  levelLine: bigint;
  exhaustionShock: bigint;
}

/// The frozen calibration for a group, at the chain's scale.
///
/// Exhaustion is not calibrated: DESIGN.md 3.3 says it matters only to the
/// optional indexed payout mode, and every series here is full payout. It is
/// registered as a fixed multiple of the attachment so the field carries a
/// sane value rather than a zero, which is what the demo series already has on
/// chain at 4.0 points against a 2.0 attachment.
export function thresholdsFor(groupKey: string, entries = loadCalibration().series): SeriesThresholds {
  const entry: FrozenCalibrationEntry | undefined = entries.find((e) => e.group_key === groupKey);
  if (entry === undefined) throw new Error(`no frozen calibration for the group "${groupKey}"`);
  const attachmentShock = toScaledPoints(entry.attachment_shock);
  return {
    attachmentShock,
    levelLine: toScaledPoints(entry.level_line),
    exhaustionShock: attachmentShock * EXHAUSTION_MULTIPLE,
  };
}

/// The catalogue entry for a group or a label, however the caller spells it.
export function entryFor(id: string): CatalogueEntry {
  const wanted = id.trim().toLowerCase();
  const entry = catalogue().find(
    (candidate) =>
      candidate.groupKey.toLowerCase() === wanted || candidate.label.toLowerCase() === wanted,
  );
  if (entry === undefined) {
    throw new Error(`no series in the catalogue for "${id}". One of: ${ORDER.join(', ')}`);
  }
  return entry;
}
