import { canonicalize } from '@creance/index-model';
import { describe, expect, it } from 'vitest';

import { addressOfKey, buildMessage, messageBytes, signMessage } from '../src/message.js';
import { verifyMessageBytes } from '../src/verify.js';

/// The verifier goes through the parsed JSON rather than through the publisher's
/// types on purpose, so these tests hand it strings, which is all a reader
/// taking bytes off the topic has.

const KEY = 'd4'.repeat(32);
const ADDRESS = addressOfKey(KEY);

const APRIL = {
  groupKey: 'computer_math',
  seriesId: 'LNU04034021',
  period: '2026-04',
  uG: 3.5,
  uAll: 4,
  e: -0.5,
  ebar: -0.6,
  ebarBase: -0.9,
  odi: 0.3,
  attachmentShock: 2,
  levelLine: -0.68,
  forms: ['shock', 'level'] as const,
  levelOpen: true,
  shockOpen: false,
  open: true,
  openReason: 'level' as const,
  status: 'final' as const,
};

function onTopic(): string {
  return messageBytes(
    signMessage(
      buildMessage(
        { ...APRIL, forms: [...APRIL.forms] },
        {
          seriesLabel: 'ODI-COMP-2026-01',
          blsSeriesId: 'LNU04034021',
          sourceHash: 'a'.repeat(64),
          modelVersion: 'odi-1.0.0',
          computedAt: new Date('2026-09-05T09:04:48Z'),
        },
      ),
      KEY,
    ),
  ).toString('utf8');
}

describe('verifying a message off the topic', () => {
  it('accepts a message the oracle signed', () => {
    const result = verifyMessageBytes(onTopic(), ADDRESS, 16);
    expect(result).toMatchObject({
      sequenceNumber: 16,
      period: '2026-04',
      status: 'final',
      open: true,
      signer: ADDRESS,
      signatureValid: true,
      canonical: true,
      problem: null,
    });
  });

  it('rejects a message signed by anyone else', () => {
    const result = verifyMessageBytes(onTopic(), `0x${'1'.repeat(40)}`, 16);
    expect(result.signatureValid).toBe(false);
    expect(result.problem).toMatch(/signed by 0x/);
  });

  it('rejects a value changed after signing', () => {
    const tampered = onTopic().replace('"ebar":-0.6', '"ebar":-0.7');
    expect(verifyMessageBytes(tampered, ADDRESS, 16).signatureValid).toBe(false);
  });

  it('notices bytes that are not their own canonical form', () => {
    const parsed = JSON.parse(onTopic()) as Record<string, unknown>;
    // The same object, the same signature, keys in a different order.
    const reordered = JSON.stringify({ v: parsed.v, ...parsed });
    expect(reordered).not.toBe(canonicalize(parsed as never));
    const result = verifyMessageBytes(reordered, ADDRESS, 16);
    expect(result.signatureValid).toBe(true);
    expect(result.canonical).toBe(false);
    expect(result.problem).toMatch(/not their own canonical form/);
  });

  it('says so rather than throwing on rubbish', () => {
    expect(verifyMessageBytes('not json', ADDRESS, 1).problem).toMatch(/not JSON/);
    expect(verifyMessageBytes('{"period":"2026-04"}', ADDRESS, 1).problem).toMatch(/no signature/);
    expect(verifyMessageBytes('{"sig":"0x00"}', ADDRESS, 1).problem).toMatch(/will not parse/);
  });
});
