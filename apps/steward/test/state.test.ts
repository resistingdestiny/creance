import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { readState, writeState } from '../src/state.js';

const directory = (): string => mkdtempSync(join(tmpdir(), 'steward-state-'));

describe('the state file', () => {
  it('is empty for a principal the agent has never bought for', () => {
    expect(readState(directory(), 'policyholder-2')).toEqual({
      principal: 'policyholder-2',
      policy_id: null,
      bound_at: null,
    });
  });

  it('round trips the policy it last bound', () => {
    const home = directory();
    writeState(home, {
      principal: 'policyholder-2',
      policy_id: 'pol_01M1',
      bound_at: '2026-09-05T13:00:00.000Z',
    });
    expect(readState(home, 'policyholder-2').policy_id).toBe('pol_01M1');
  });

  it('treats an unreadable file as no memory rather than failing the run', () => {
    const home = directory();
    writeFileSync(join(home, 'policyholder-2.json'), 'not json', 'utf8');
    expect(readState(home, 'policyholder-2').policy_id).toBeNull();
  });

  it('refuses a principal name that would escape the directory', () => {
    expect(() => readState(directory(), '../../etc/passwd')).toThrow(/principal name/);
  });
});
