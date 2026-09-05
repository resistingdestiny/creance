import { describe, expect, it } from 'vitest';

import {
  HttpNotifier,
  LoggingNotifier,
  MemoryNotifier,
  formatAlert,
  notifierFrom,
  raise,
  type Alert,
} from '../src/alerts.js';

/// Alerts are a notice about a run, so the rule they are held to here is that
/// losing one never loses the run: a missing NOTIFY_URL, a refusal and a
/// connection failure all leave a line on the log and let the run carry on.

const ALERT: Alert = {
  event: 'qa_failed',
  group: 'computer_math',
  period: '2026-08',
  message: 'bounds failed: computer_math u=55',
  run_id: 7,
};

describe('the alert body', () => {
  it('is the five fields the operator needs, as JSON', async () => {
    const sent: { url: string; body: unknown }[] = [];
    const notifier = new HttpNotifier('https://alerts.example/hook', () => {}, (async (
      url: string,
      init: { body: string },
    ) => {
      sent.push({ url, body: JSON.parse(init.body) as unknown });
      return new Response('', { status: 204 });
    }) as unknown as typeof fetch);

    await notifier.send(ALERT);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe('https://alerts.example/hook');
    expect(sent[0]?.body).toEqual({
      event: 'qa_failed',
      group: 'computer_math',
      period: '2026-08',
      message: 'bounds failed: computer_math u=55',
      run_id: 7,
    });
  });

  it('names the event, the subject and the reason on one line', () => {
    expect(formatAlert(ALERT)).toBe(
      'alert      qa_failed  computer_math 2026-08  bounds failed: computer_math u=55',
    );
  });
});

describe('a delivery that does not work', () => {
  it('logs a refusal rather than failing the run', async () => {
    const lines: string[] = [];
    const notifier = new HttpNotifier(
      'https://alerts.example/hook',
      (line) => lines.push(line),
      (async () => new Response('no', { status: 500 })) as unknown as typeof fetch,
    );
    await expect(notifier.send(ALERT)).resolves.toBeUndefined();
    expect(lines[0]).toMatch(/refused with 500/);
  });

  it('logs a connection failure rather than failing the run', async () => {
    const lines: string[] = [];
    const notifier = new HttpNotifier(
      'https://alerts.example/hook',
      (line) => lines.push(line),
      (async () => {
        throw new Error('getaddrinfo ENOTFOUND alerts.example');
      }) as unknown as typeof fetch,
    );
    await expect(notifier.send(ALERT)).resolves.toBeUndefined();
    expect(lines[0]).toMatch(/could not be delivered: getaddrinfo/);
  });
});

describe('choosing a notifier', () => {
  it('logs when NOTIFY_URL is not set, so a clone still runs', async () => {
    const lines: string[] = [];
    const notifier = notifierFrom({}, (line) => lines.push(line));
    expect(notifier).toBeInstanceOf(LoggingNotifier);
    await raise(notifier, ALERT, (line) => lines.push(line));
    expect(lines).toEqual([formatAlert(ALERT)]);
  });

  it('logs when NOTIFY_URL is blank, because a copied .env.example is blank', () => {
    expect(notifierFrom({ NOTIFY_URL: '   ' })).toBeInstanceOf(LoggingNotifier);
  });

  it('logs when NOTIFY_URL is not a URL this can post to', () => {
    const lines: string[] = [];
    expect(notifierFrom({ NOTIFY_URL: 'file:///tmp/alerts' }, (line) => lines.push(line))).toBeInstanceOf(
      LoggingNotifier,
    );
    expect(notifierFrom({ NOTIFY_URL: 'not a url' }, (line) => lines.push(line))).toBeInstanceOf(
      LoggingNotifier,
    );
    expect(lines).toHaveLength(2);
  });

  it('posts when NOTIFY_URL is an http endpoint', () => {
    expect(notifierFrom({ NOTIFY_URL: 'https://alerts.example/hook' })).toBeInstanceOf(HttpNotifier);
  });

  it('logs the line as well as sending it, so the container log carries it', async () => {
    const lines: string[] = [];
    const notifier = new MemoryNotifier();
    await raise(notifier, ALERT, (line) => lines.push(line));
    expect(notifier.sent).toEqual([ALERT]);
    expect(lines).toEqual([formatAlert(ALERT)]);
  });
});
