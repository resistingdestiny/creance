import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

/// One error envelope: RFC 9457 `application/problem+json`, for every non-2xx
/// response this API produces, including validation failures and 404s.
///
/// `code` is the contract a client switches on. `title` and `detail` are for a
/// human reading a terminal, and `detail` never carries a nullifier, a stack, a
/// SQL fragment or a file path (RFC 9457 section 5). `request_id` is how a
/// failure seen in a demo is found in the log a minute later, and `retryable`
/// is the boolean an agent's retry loop reads so that it neither gives up on a
/// transient failure nor hammers a permanent one.
///
/// https://www.rfc-editor.org/rfc/rfc9457.html

/** Codes that are worth retrying. Everything else is the caller's to fix. */
const RETRYABLE = new Set([
  'rate_limited',
  'request_in_flight',
  'chain_write_failed',
  'upstream_unavailable',
  'internal_error',
]);

export interface ProblemBody {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  code: string;
  request_id: string;
  retryable: boolean;
  errors?: { path: string; message: string }[];
}

/** An error a route means to return. Anything else becomes a 500. */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly title: string;
  readonly issues: { path: string; message: string }[] | undefined;

  constructor(
    status: number,
    code: string,
    title: string,
    detail: string,
    issues?: { path: string; message: string }[],
  ) {
    super(detail);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.title = title;
    this.issues = issues;
  }
}

export function problemBody(
  request: FastifyRequest,
  status: number,
  code: string,
  title: string,
  detail: string,
  issues?: { path: string; message: string }[],
): ProblemBody {
  return {
    type: `https://creance.co/errors/${code.replace(/_/g, '-')}`,
    title,
    status,
    detail,
    instance: request.url,
    code,
    request_id: request.id,
    retryable: RETRYABLE.has(code),
    ...(issues === undefined ? {} : { errors: issues }),
  };
}

export function sendProblem(
  reply: FastifyReply,
  status: number,
  code: string,
  title: string,
  detail: string,
  issues?: { path: string; message: string }[],
): FastifyReply {
  return reply
    .status(status)
    .type('application/problem+json')
    .send(problemBody(reply.request, status, code, title, detail, issues));
}

/// Fastify's own codes, with the status each already carries. Mapping them by
/// name rather than by status keeps a caller's vocabulary the same whether the
/// refusal came from a route or from the framework under it.
const FASTIFY_CODES: Record<string, { status: number; code: string; title: string }> = {
  FST_ERR_VALIDATION: { status: 400, code: 'validation_failed', title: 'Validation failed' },
  FST_ERR_CTP_INVALID_MEDIA_TYPE: {
    status: 415,
    code: 'unsupported_media_type',
    title: 'Unsupported media type',
  },
  FST_ERR_CTP_EMPTY_JSON_BODY: { status: 400, code: 'body_required', title: 'Body required' },
  FST_ERR_CTP_INVALID_JSON_BODY: { status: 400, code: 'body_malformed', title: 'Body malformed' },
  FST_ERR_CTP_BODY_TOO_LARGE: { status: 413, code: 'body_too_large', title: 'Body too large' },
  FST_ERR_ROUTE_MISSING_CONTENT_TYPE: {
    status: 415,
    code: 'content_type_required',
    title: 'Content type required',
  },
};

/** Install the envelope on the root instance. Called once, at build time. */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setNotFoundHandler((request, reply) =>
    sendProblem(
      reply,
      404,
      'route_not_found',
      'Not found',
      'There is no route at that path on this API.',
    ),
  );

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return sendProblem(
        reply,
        error.status,
        error.code,
        error.title,
        error.message,
        error.issues,
      );
    }
    const raw = error as { code?: unknown; message?: unknown };
    const fastify = typeof raw.code === 'string' ? FASTIFY_CODES[raw.code] : undefined;
    if (fastify !== undefined) {
      return sendProblem(reply, fastify.status, fastify.code, fastify.title, describe(raw));
    }
    // Anything unrecognised is ours. Log the real error against the request id
    // and tell the caller nothing beyond that it was not their fault.
    request.log.error({ err: error, request_id: request.id }, 'unhandled error');
    return sendProblem(
      reply,
      500,
      'internal_error',
      'Something went wrong',
      'The request failed inside the API. Quote the request id when you report it.',
    );
  });
}

/** Fastify's own messages are safe to pass on; they name a field, not a secret. */
function describe(error: { message?: unknown }): string {
  return typeof error.message === 'string' && error.message !== ''
    ? error.message
    : 'The request could not be read.';
}
