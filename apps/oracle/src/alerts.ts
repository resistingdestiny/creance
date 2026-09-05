import type { Period } from '@creance/index-model';

/**
 * The alerts of docs/INDEX-SPEC.md section 9.
 *
 * Five events, all of them named in the specification: a run that failed, a QA
 * gate that failed, a source that has gone stale, a revision detected after
 * publication, and the first open month for a group, which is a product event
 * and not only an ops one.
 *
 * The transport is one HTTP POST to `NOTIFY_URL` with a small JSON body. There
 * is no queue and no retry: an alert that cannot be delivered is logged and the
 * run carries on, because a run that fails because its alert failed turns a
 * notice into an outage. A clone with no `NOTIFY_URL` set logs the line it
 * would have sent, so the demo path and the test suite need no endpoint.
 *
 * The specification also sends alerts to STATUS.md. That file is the board's,
 * outside this repository, and the daily status job is what carries index
 * health into it: see docs/INDEX-OPS.md.
 */

export type AlertEvent =
  | 'run_failed'
  | 'qa_failed'
  | 'source_stale'
  | 'revision_detected'
  | 'first_open_month';

export interface Alert {
  event: AlertEvent;
  /** The group the alert is about, or null for a whole-run event. */
  group: string | null;
  period: Period | null;
  /** One line a human can act on. */
  message: string;
  run_id: number | null;
}

export interface Notifier {
  send(alert: Alert): Promise<void>;
}

/** How long a delivery may take before the run stops waiting for it. */
export const NOTIFY_TIMEOUT_MS = 5_000;

/**
 * The real notifier. A POST of the alert as JSON, and nothing else: no
 * signature, no authentication and no secret, because the body carries only
 * what is already public on the topic and the endpoint is the operator's.
 */
export class HttpNotifier implements Notifier {
  constructor(
    private readonly url: string,
    private readonly log: (line: string) => void = () => {},
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(alert: Alert): Promise<void> {
    try {
      const response = await this.fetchImpl(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(alert),
        signal: AbortSignal.timeout(NOTIFY_TIMEOUT_MS),
      });
      if (!response.ok) {
        this.log(`alert      ${alert.event} was refused with ${response.status}`);
      }
    } catch (error) {
      // Deliberately swallowed. The alert is a notice about a run; losing it
      // must not also lose the run.
      this.log(
        `alert      ${alert.event} could not be delivered: ` +
          (error instanceof Error ? error.message : String(error)),
      );
    }
  }
}

/** What a clone with no NOTIFY_URL gets: the line, on the run log. */
export class LoggingNotifier implements Notifier {
  constructor(private readonly log: (line: string) => void = () => {}) {}

  async send(alert: Alert): Promise<void> {
    this.log(formatAlert(alert));
  }
}

/** Keeps what it was sent. What a test asserts on. */
export class MemoryNotifier implements Notifier {
  readonly sent: Alert[] = [];

  async send(alert: Alert): Promise<void> {
    this.sent.push(alert);
  }
}

/** One line for a run log, whether or not the alert also left the process. */
export function formatAlert(alert: Alert): string {
  const subject = [alert.group, alert.period].filter((part) => part !== null).join(' ');
  return `alert      ${alert.event}${subject === '' ? '' : `  ${subject}`}  ${alert.message}`;
}

/**
 * The notifier a command should use, given its environment.
 *
 * `NOTIFY_URL` unset is the normal case for a clone and for `pnpm test`, so it
 * is a logged line rather than a failure. A value that is not an http or https
 * URL is a mistake worth saying out loud, and it also falls back to the log
 * rather than throwing at the start of a run that would otherwise have worked.
 */
export function notifierFrom(
  vars: NodeJS.ProcessEnv = process.env,
  log: (line: string) => void = () => {},
): Notifier {
  const raw = vars.NOTIFY_URL?.trim();
  if (raw === undefined || raw === '') return new LoggingNotifier(log);
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      log(`alerts     NOTIFY_URL is ${url.protocol}, which is not a URL this can post to`);
      return new LoggingNotifier(log);
    }
  } catch {
    log('alerts     NOTIFY_URL is not a URL, so alerts are logged and not sent');
    return new LoggingNotifier(log);
  }
  return new HttpNotifier(raw, log);
}

/**
 * Send an alert and also log it.
 *
 * Both, always. The run log is the operator's copy and the POST is the pager's,
 * and a run whose alerts only exist at the far end of an HTTP call cannot be
 * read back from the container logs the event window keeps.
 */
export async function raise(
  notifier: Notifier,
  alert: Alert,
  log: (line: string) => void = () => {},
): Promise<void> {
  if (!(notifier instanceof LoggingNotifier)) log(formatAlert(alert));
  await notifier.send(alert);
}
