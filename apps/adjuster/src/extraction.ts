/// What one evidence document says, as the model returns it.
///
/// The model extracts. The code decides. There is no `approve` field here and
/// there never will be one: the only channel from a claimant's document to the
/// money is this closed record of facts, which is then compared in TypeScript
/// against an attestation the model never saw. A document that carries an
/// instruction has nowhere to land except `contains_instruction_like_text`,
/// which refers the claim to a human and caps its confidence.
///
/// One schema for every document kind, with per-kind fields left null when they
/// do not apply. A discriminated union per kind would be tidier and is not worth
/// it: structured outputs limit `anyOf` and require `additionalProperties:
/// false`, and a flat record with nullable fields is the shape least likely to
/// be refused.
///
/// Every field is required in the schema and nullable in type, because a
/// missing key and a null value are different failures and only one of them is
/// recoverable.

export const EXTRACTION_SCHEMA_VERSION = 'adjuster-extraction-1';

/** The model's own classification. The claimant's label is a hint, never this. */
export const DOCUMENT_TYPES = [
  'termination_letter',
  'benefit_determination',
  'final_pay_statement',
  'p45',
  'record_of_employment',
  'other',
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/**
 * The word the document itself uses.
 *
 * Deliberately a different vocabulary from the eight `separation_type` values
 * the attestation offers, so the code has to map one to the other and cannot
 * accidentally let a document fill in a policy field.
 */
export const SEPARATION_LANGUAGE = [
  'layoff',
  'redundancy',
  'position_eliminated',
  'site_closure',
  'resignation',
  'dismissal',
  'contract_end',
  'retirement',
  'not_stated',
] as const;

export type SeparationLanguage = (typeof SEPARATION_LANGUAGE)[number];

export const INITIATED_BY = ['employer', 'employee', 'mutual', 'not_stated'] as const;

export type InitiatedBy = (typeof INITIATED_BY)[number];

export const BENEFIT_OUTCOMES = ['allowed', 'denied', 'pending'] as const;

export const FINAL_PAY_INDICATORS = ['final_pay', 'severance', 'pay_in_lieu', 'none'] as const;

export interface Extraction {
  schema_version: string;
  document_type: DocumentType;
  document_type_confidence: number;

  employer_name: string | null;
  employer_name_confidence: number;
  employer_address_present: boolean;
  letterhead_present: boolean;

  employee_name: string | null;
  employee_name_confidence: number;
  job_title: string | null;
  job_title_confidence: number;

  /** ISO YYYY-MM-DD, or null when the document's date could be read two ways. */
  last_day_of_work: string | null;
  last_day_of_work_confidence: number;
  notice_or_letter_date: string | null;
  employment_start_date: string | null;

  separation_language: SeparationLanguage;
  separation_language_confidence: number;
  separation_initiated_by: InitiatedBy;
  separation_initiated_by_confidence: number;
  /** Up to 200 characters copied verbatim. Stored, shown to a reviewer, never published. */
  separation_quote: string | null;

  state_or_agency: string | null;
  benefit_determination_outcome: (typeof BENEFIT_OUTCOMES)[number] | null;
  pay_period_end: string | null;
  final_pay_indicator: (typeof FINAL_PAY_INDICATORS)[number] | null;
  tax_office_reference: string | null;
  leaving_date_field: string | null;
  /**
   * Canada's Record of Employment reason code, extracted as an opaque string.
   * No rule branches on it: the official code list could not be read from the
   * Service Canada guide, so an "involuntary" mapping would be a guess.
   */
  roe_reason_code: string | null;

  legibility: number;
  document_complete: boolean;
  dates_internally_consistent: boolean;
  contains_instruction_like_text: boolean;
  instruction_like_excerpt: string | null;
  notes: string | null;
}

/** Why a document produced no extraction. Every one of these refers, never declines. */
export type ExtractionFailureReason =
  | 'adjuster_unavailable'
  | 'adjuster_refused'
  | 'extraction_truncated'
  | 'extraction_invalid'
  | 'evidence_unreadable';

export interface ExtractionFailure {
  failed: true;
  reason: ExtractionFailureReason;
  /** For the log and the review screen. Never published. */
  detail: string;
}

export type ExtractionResult = Extraction | ExtractionFailure;

export function isFailure(result: ExtractionResult): result is ExtractionFailure {
  return (result as ExtractionFailure).failed === true;
}

/**
 * Structured outputs support neither `minimum` nor `maximum`, so every
 * confidence the model returns is clamped here rather than assumed to be in
 * range. One place, at the boundary.
 */
export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/** Every numeric field clamped and every empty string normalised to null. */
export function normaliseExtraction(raw: Extraction): Extraction {
  return {
    ...raw,
    schema_version: EXTRACTION_SCHEMA_VERSION,
    document_type_confidence: clamp01(raw.document_type_confidence),
    employer_name: blankToNull(raw.employer_name),
    employer_name_confidence: clamp01(raw.employer_name_confidence),
    employee_name: blankToNull(raw.employee_name),
    employee_name_confidence: clamp01(raw.employee_name_confidence),
    job_title: blankToNull(raw.job_title),
    job_title_confidence: clamp01(raw.job_title_confidence),
    last_day_of_work: isoDateOrNull(raw.last_day_of_work),
    last_day_of_work_confidence: clamp01(raw.last_day_of_work_confidence),
    notice_or_letter_date: isoDateOrNull(raw.notice_or_letter_date),
    employment_start_date: isoDateOrNull(raw.employment_start_date),
    separation_language_confidence: clamp01(raw.separation_language_confidence),
    separation_initiated_by_confidence: clamp01(raw.separation_initiated_by_confidence),
    separation_quote: trimTo(raw.separation_quote, 200),
    instruction_like_excerpt: trimTo(raw.instruction_like_excerpt, 200),
    notes: trimTo(raw.notes, 500),
    legibility: clamp01(raw.legibility),
  };
}

function blankToNull(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function trimTo(value: string | null, length: number): string | null {
  const text = blankToNull(value);
  return text === null ? null : text.slice(0, length);
}

/**
 * A date the model returned, or null.
 *
 * No locale default is ever applied. A packet may hold a UK P45 beside a US
 * benefit letter, and a silent DD/MM guess that moves a separation from 3 April
 * to 4 March moves it across a month boundary and therefore across the loss
 * window. A null is a refer and a human reads the raw string in `notes`.
 */
function isoDateOrNull(value: string | null): string | null {
  const text = blankToNull(value);
  if (text === null) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}
