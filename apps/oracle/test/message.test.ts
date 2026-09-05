import { canonicalize, sha256Hex, type Observation } from '@creance/index-model';
import { describe, expect, it } from 'vitest';

import {
  MAX_MESSAGE_BYTES,
  addressOfKey,
  assertUnderCap,
  buildMessage,
  messageBytes,
  recoverSigner,
  signMessage,
  signingPayload,
  verifyMessage,
} from '../src/message.js';

const KEY = 'a1'.repeat(32);

/// The real April 2026 opening for the computer and mathematical group, which
/// is the observation the demo turns on.
const APRIL: Observation = {
  groupKey: 'computer_math',
  seriesId: 'LNU04034021',
  period: '2026-04',
  uG: 3.5,
  uAll: 4.0,
  e: -0.5,
  ebar: -0.6,
  ebarBase: -0.9,
  odi: 0.3,
  attachmentShock: 2.0,
  levelLine: -0.68,
  forms: ['shock', 'level'],
  levelOpen: true,
  shockOpen: false,
  open: true,
  openReason: 'level',
  status: 'final',
};

const CONTEXT = {
  seriesLabel: 'ODI-COMP-2026-01',
  blsSeriesId: 'LNU04034021',
  sourceHash: 'f'.repeat(64),
  modelVersion: 'odi-1.0.0',
  computedAt: new Date('2026-09-05T12:31:00.456Z'),
};

describe('the v2 observation message', () => {
  it('carries the schema fields, the two thresholds and the opening decision', () => {
    const message = buildMessage(APRIL, CONTEXT);
    expect(message).toMatchObject({
      v: 2,
      series: 'ODI-COMP-2026-01',
      group: 'computer_math',
      period: '2026-04',
      ebar: -0.6,
      odi: 0.3,
      attachment_shock: 2.0,
      level_line: -0.68,
      open: true,
      open_reason: 'level',
      status: 'final',
      revises_seq: null,
      model_version: 'odi-1.0.0',
      source: 'bls:LNU04034021',
    });
  });

  it('drops the milliseconds so two runs over the same data agree', () => {
    expect(buildMessage(APRIL, CONTEXT).computed_at).toBe('2026-09-05T12:31:00Z');
  });

  it('stays well under the 1 KB cap, signature included', () => {
    const signed = signMessage(buildMessage(APRIL, CONTEXT), KEY);
    const bytes = assertUnderCap(signed);
    expect(bytes.byteLength).toBeLessThan(MAX_MESSAGE_BYTES);
  });

  it('is under the cap for every status, including the gap months', () => {
    const shapes: Observation[] = [
      APRIL,
      { ...APRIL, period: '2025-10', uG: null, uAll: null, e: null, ebar: null, ebarBase: null, odi: null, forms: [], levelOpen: false, shockOpen: false, open: false, openReason: 'none', status: 'no_source' },
      { ...APRIL, period: '2025-11', ebar: null, odi: null, forms: [], levelOpen: false, shockOpen: false, open: false, openReason: 'none', status: 'insufficient_history' },
      { ...APRIL, odi: null, forms: ['level'] },
    ];
    for (const shape of shapes) {
      const signed = signMessage(buildMessage(shape, CONTEXT), KEY);
      expect(messageBytes(signed).byteLength).toBeLessThan(MAX_MESSAGE_BYTES);
    }
  });

  it('rejects a message that would not fit in one chunk', () => {
    const signed = signMessage(buildMessage(APRIL, CONTEXT), KEY);
    expect(() => assertUnderCap({ ...signed, group: 'x'.repeat(MAX_MESSAGE_BYTES) })).toThrow(
      /over the 1024 byte cap/,
    );
  });

  it('publishes canonical JSON: sorted keys and no whitespace', () => {
    const bytes = messageBytes(signMessage(buildMessage(APRIL, CONTEXT), KEY)).toString('utf8');
    expect(bytes).not.toMatch(/\s/);
    const keys = [...bytes.matchAll(/"([a-z_0-9]+)":/g)].map((m) => m[1] as string);
    expect(keys).toEqual([...keys].sort());
    expect(keys[0]).toBe('attachment_shock');
  });

  it('signs the canonical form without the signature field', () => {
    const unsigned = buildMessage(APRIL, CONTEXT);
    const signed = signMessage(unsigned, KEY);
    expect(signingPayload(signed)).toBe(canonicalize(unsigned));
    expect(signingPayload(signed)).not.toContain('"sig"');
  });

  it('recovers the oracle address, and only over the exact bytes', () => {
    const signed = signMessage(buildMessage(APRIL, CONTEXT), KEY);
    expect(signed.sig).toMatch(/^0x[0-9a-f]{130}$/);
    expect(recoverSigner(signed)).toBe(addressOfKey(KEY));
    expect(verifyMessage(signed, addressOfKey(KEY))).toBe(true);
    expect(verifyMessage({ ...signed, ebar: -0.61 }, addressOfKey(KEY))).toBe(false);
    expect(verifyMessage(signed, `0x${'0'.repeat(40)}`)).toBe(false);
  });

  it('lets a reader with only the bytes verify the signature', () => {
    const onTopic = messageBytes(signMessage(buildMessage(APRIL, CONTEXT), KEY)).toString('utf8');
    const parsed = JSON.parse(onTopic) as Record<string, unknown>;
    const { sig, ...rest } = parsed as { sig: string };
    expect(sha256Hex(canonicalize(rest as never))).toHaveLength(64);
    expect(typeof sig).toBe('string');
    expect(recoverSigner(parsed as never)).toBe(addressOfKey(KEY));
  });
});
