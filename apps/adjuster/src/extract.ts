import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import * as z from 'zod';

import {
  BENEFIT_OUTCOMES,
  DOCUMENT_TYPES,
  FINAL_PAY_INDICATORS,
  INITIATED_BY,
  SEPARATION_LANGUAGE,
  normaliseExtraction,
  type Extraction,
  type ExtractionResult,
} from './extraction.js';
import { RETRY_SUFFIX, SYSTEM_PROMPT, userInstruction } from './prompt.js';

/// Reading one document with a vision-capable model.
///
/// One call per evidence file, never one call for the packet. A document that
/// is unreadable, hostile or irrelevant cannot then contaminate the reading of
/// the one beside it, the rule engine can say "the letter agrees, the payslip
/// does not" instead of one blurred answer, and a retry re-bills one file.
///
/// The attestation is never sent. The model reads the document cold and returns
/// what is on it; the comparison happens in TypeScript afterwards. That is the
/// cheapest and strongest defence against a document that carries an
/// instruction: it cannot make the extraction agree with a statement it has
/// never seen.
///
/// The document block comes before the instruction text, which is what the
/// vision guidance asks for. The response is constrained by
/// `output_config.format` built from the Zod schema below, so there is no free
/// text for an injected instruction to land in.
///
/// https://platform.claude.com/docs/en/build-with-claude/structured-outputs
/// https://platform.claude.com/docs/en/build-with-claude/pdf-support
/// https://platform.claude.com/docs/en/build-with-claude/vision

/** The four image types the model reads. Anything else refers, never declines. */
export const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;

export const EXTRACTION_MODEL = 'claude-opus-5';

const nullableString = z.string().nullable();

/**
 * The schema, as the structured-outputs validator sees it.
 *
 * Every field is required and nullable rather than optional, because a missing
 * key and a null value are different failures and only one of them is
 * recoverable. Ranges are not expressed here: the structured-outputs schema
 * subset supports neither `minimum` nor `maximum`, so every confidence is
 * clamped in `normaliseExtraction` instead.
 */
export const ExtractionSchema = z.object({
  document_type: z.enum(DOCUMENT_TYPES),
  document_type_confidence: z.number(),
  employer_name: nullableString,
  employer_name_confidence: z.number(),
  employer_address_present: z.boolean(),
  letterhead_present: z.boolean(),
  employee_name: nullableString,
  employee_name_confidence: z.number(),
  job_title: nullableString,
  job_title_confidence: z.number(),
  last_day_of_work: nullableString,
  last_day_of_work_confidence: z.number(),
  notice_or_letter_date: nullableString,
  employment_start_date: nullableString,
  separation_language: z.enum(SEPARATION_LANGUAGE),
  separation_language_confidence: z.number(),
  separation_initiated_by: z.enum(INITIATED_BY),
  separation_initiated_by_confidence: z.number(),
  separation_quote: nullableString,
  state_or_agency: nullableString,
  benefit_determination_outcome: z.enum(BENEFIT_OUTCOMES).nullable(),
  pay_period_end: nullableString,
  final_pay_indicator: z.enum(FINAL_PAY_INDICATORS).nullable(),
  tax_office_reference: nullableString,
  leaving_date_field: nullableString,
  roe_reason_code: nullableString,
  legibility: z.number(),
  document_complete: z.boolean(),
  dates_internally_consistent: z.boolean(),
  contains_instruction_like_text: z.boolean(),
  instruction_like_excerpt: nullableString,
  notes: nullableString,
});

export interface EvidenceFile {
  evidenceId: string;
  /** The claimant's own label, passed to the model as an explicitly weak prior. */
  kind: string;
  contentType: string;
  bytes: Buffer;
}

/**
 * The seam every test runs against.
 *
 * `pnpm test` is chain free and network free, so the fixtures drive a recorded
 * extraction through this interface and only `pnpm adjuster:extract` and the
 * live scripts build the model-backed one.
 */
export interface Extractor {
  extract(file: EvidenceFile): Promise<ExtractionResult>;
}

/**
 * The extractor a deployment with no model key gets.
 *
 * It reports the model as unavailable rather than the document as unreadable,
 * which matters: both refer, but "we could not read that document, send a
 * clearer photo" blames the claimant for a key we did not set.
 */
export class UnavailableExtractor implements Extractor {
  async extract(): Promise<ExtractionResult> {
    return {
      failed: true,
      reason: 'adjuster_unavailable',
      detail: 'this deployment has no model key, so no document can be read',
    };
  }
}

/** An extractor that replays a recorded extraction, keyed by evidence id. */
export class RecordedExtractor implements Extractor {
  constructor(private readonly recorded: Record<string, ExtractionResult>) {}

  async extract(file: EvidenceFile): Promise<ExtractionResult> {
    const found = this.recorded[file.evidenceId];
    if (found === undefined) {
      return { failed: true, reason: 'evidence_unreadable', detail: 'no recorded extraction' };
    }
    return found;
  }
}

export interface ModelExtractorOptions {
  apiKey: string;
  model?: string;
  effort?: 'low' | 'medium' | 'high';
  maxTokens?: number;
  /** Passed through to the SDK's own retry loop. */
  maxRetries?: number;
  timeoutMs?: number;
}

export class ModelExtractor implements Extractor {
  private readonly client: Anthropic;
  readonly model: string;
  readonly effort: 'low' | 'medium' | 'high';
  private readonly maxTokens: number;

  constructor(options: ModelExtractorOptions) {
    this.client = new Anthropic({
      apiKey: options.apiKey,
      maxRetries: options.maxRetries ?? 2,
      timeout: options.timeoutMs ?? 120_000,
    });
    this.model = options.model ?? EXTRACTION_MODEL;
    // Default effort is high. Reading six fields off a one-page letter does not
    // repay it, and a fixture check keeps it honest rather than assuming.
    this.effort = options.effort ?? 'medium';
    // The extraction record is small. The cap exists so a pathological document
    // cannot produce a five-minute response.
    this.maxTokens = options.maxTokens ?? 4000;
  }

  async extract(file: EvidenceFile): Promise<ExtractionResult> {
    const block = documentBlock(file);
    if (block === null) {
      return {
        failed: true,
        reason: 'evidence_unreadable',
        detail: `${file.contentType} is not a type the model reads`,
      };
    }
    const first = await this.call(block, userInstruction(file.kind));
    if (first.retry !== true) return first.result;
    const second = await this.call(block, `${userInstruction(file.kind)}${RETRY_SUFFIX}`);
    return second.result;
  }

  /**
   * One call.
   *
   * No model or transport failure ever declines a claim. Every row below refers
   * it to a human instead, because the tempting shortcut when a demo is running
   * late is to make a failure terminal, and a terminal failure here is a
   * wrongly refused insurance claim.
   */
  private async call(
    block: Anthropic.ContentBlockParam,
    instruction: string,
  ): Promise<{ result: ExtractionResult; retry?: boolean }> {
    try {
      const response = await this.client.messages.parse({
        model: this.model,
        max_tokens: this.maxTokens,
        thinking: { type: 'adaptive' },
        output_config: { format: zodOutputFormat(ExtractionSchema), effort: this.effort },
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: [block, { type: 'text', text: instruction }] }],
      });

      // Guarded before the content is read, because that is the documented
      // shape and it is the cheapest check in the file.
      if (response.stop_reason === 'refusal') {
        return { result: { failed: true, reason: 'adjuster_refused', detail: 'the model refused' } };
      }
      if (response.stop_reason === 'max_tokens') {
        return {
          result: { failed: true, reason: 'extraction_truncated', detail: 'the response was cut off' },
        };
      }
      const parsed = response.parsed_output;
      if (parsed === null || parsed === undefined) {
        return {
          result: { failed: true, reason: 'extraction_invalid', detail: 'no parsed output' },
          retry: true,
        };
      }
      return { result: normaliseExtraction({ ...parsed, schema_version: '' } as Extraction) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const invalid = /schema|parse|json/i.test(message);
      return {
        result: {
          failed: true,
          reason: invalid ? 'extraction_invalid' : 'adjuster_unavailable',
          detail: message.slice(0, 200),
        },
        retry: invalid,
      };
    }
  }
}

/**
 * The file as a content block, or null when the model cannot read the type.
 *
 * The magic bytes are checked rather than the declared content type: a file
 * that claims to be a PDF and is not would otherwise reach the model as a
 * document block and come back as a confident reading of nothing.
 */
export function documentBlock(file: EvidenceFile): Anthropic.ContentBlockParam | null {
  const data = file.bytes.toString('base64');
  if (file.contentType === 'application/pdf') {
    if (!file.bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) return null;
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } };
  }
  const sniffed = sniffImage(file.bytes);
  if (sniffed === null) return null;
  return { type: 'image', source: { type: 'base64', media_type: sniffed, data } };
}

/** The four image types the model accepts, recognised from their own header. */
export function sniffImage(bytes: Buffer): (typeof SUPPORTED_IMAGE_TYPES)[number] | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (bytes.subarray(0, 6).toString('latin1').startsWith('GIF8')) return 'image/gif';
  if (
    bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
    bytes.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}
