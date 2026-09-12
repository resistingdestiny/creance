import type { FastifyPluginAsync } from 'fastify';

import { AppError } from '../errors.js';
import type { Services } from '../services.js';

/// POST /v1/newsletter
///
/// Somebody asks to be written to when there is news. The address goes in a
/// row and nothing else happens.
///
/// Free and unmetered. It is outside the three patterns the x402 gate names
/// (apps/api/src/x402/gate.ts), which is where it belongs: charging a visitor
/// to leave an address would be the wrong way round.
///
/// Deliberately not in the OpenAPI document, for the reason
/// apps/api/src/routes/attribution.ts gives: that document is the gateway
/// import of the priced routes, and this is neither priced nor of any use to an
/// agent.
///
/// Three things this endpoint will not do.
///
/// It will not say whether an address is already held. The same 202 and the
/// same body come back for a first submission and a tenth, because anything
/// else turns a public write into a public read of the list: a stranger with
/// somebody's address could otherwise ask this endpoint whether that person had
/// signed up. The row is an ON CONFLICT DO NOTHING insert, so the repository
/// cannot report which happened and therefore cannot be made to.
///
/// It will not echo what it was sent. A refusal says the address was not
/// readable and stops there. Putting the submitted value back in a problem
/// document puts it in the caller's logs, in ours, and in the reflected
/// response of anything that renders `detail`, and none of the three is worth
/// the convenience of seeing what you typed.
///
/// And it will not send anything. There is no provider behind this, no key and
/// no queue. Storing the address is the whole of the job, and the page that
/// posts here says so in as many words before anybody types one.

/** What a caller gets back, whether or not the address was already held. */
export interface NewsletterAcceptedView {
  readonly status: 'accepted';
  /** What actually happens to it, so an agent reading this is told too. */
  readonly notice: string;
}

const NOTICE =
  'The address is stored and nothing is sent from it. Creance is a prototype on a test network and there is no mailing list behind this yet.';

/**
 * The longest address this will take, from RFC 5321 section 4.5.3.1: 64 octets
 * of local part, an at sign, and 255 of domain. Anything longer is not an
 * address that any mail system would carry, so it is refused here rather than
 * stored as a 300 character row nobody can write to.
 */
const MAX_LENGTH = 320;
const MAX_LOCAL = 64;

/**
 * Whether this is an address, to the only standard worth holding a sign up form
 * to: one at sign with something either side of it, a dot in the domain, and no
 * whitespace anywhere.
 *
 * A stricter grammar is a trap. The full RFC 5322 address is famously long,
 * almost nothing implements it correctly, and every regular expression that
 * tries rejects addresses that real people really have. What this has to catch
 * is somebody typing a name, a phone number or nothing much, and it does.
 */
function isAddress(value: string): boolean {
  if (value.length === 0 || value.length > MAX_LENGTH) return false;
  if (/\s/.test(value)) return false;
  const at = value.lastIndexOf('@');
  if (at <= 0 || at === value.length - 1) return false;
  if (at > MAX_LOCAL) return false;
  const domain = value.slice(at + 1);
  if (!domain.includes('.') || domain.startsWith('.') || domain.endsWith('.')) return false;
  return !domain.includes('..');
}

/**
 * The address as it is stored: the surrounding space taken off and the whole
 * of it folded to lower case.
 *
 * Case folding the local part is not what the mail standard says, strictly:
 * the part before the at sign is the receiving server's to interpret and it may
 * treat case as significant. In practice no mail provider does, and the thing
 * this table has to get right is that one person who signs up twice is one row
 * rather than two. So it folds, and the primary key does the rest.
 */
function normalise(value: string): string {
  return value.trim().toLowerCase();
}

export const newsletterRoutes: FastifyPluginAsync<{ services: Services }> = async (
  app,
  options,
) => {
  const { services } = options;

  app.post<{ Body: Record<string, unknown> }>('/v1/newsletter', async (request, reply) => {
    const raw = request.body?.['email'];
    if (typeof raw !== 'string') {
      throw new AppError(
        400,
        'validation_failed',
        'Validation failed',
        'The address goes in `email`.',
        [{ path: 'body.email', message: 'expected an email address as a string' }],
      );
    }
    const email = normalise(raw);
    if (!isAddress(email)) {
      // The address itself is not in the detail, in the issues or in the log.
      throw new AppError(
        400,
        'email_invalid',
        'That is not an address',
        'That does not look like an email address, so nothing was stored.',
        [{ path: 'body.email', message: 'expected an email address' }],
      );
    }

    await services.repository.recordNewsletterSignup({
      email,
      createdAt: new Date().toISOString(),
    });

    // 202 rather than 201: a 201 would have to name the thing it created, and
    // naming it would answer the question this endpoint refuses to answer.
    const view: NewsletterAcceptedView = { status: 'accepted', notice: NOTICE };
    return reply.status(202).send(view);
  });
};
