import { describe, expect, it } from 'vitest';

import {
  COVER,
  PACKETS,
  coverProblems,
  emptyRecord,
  inUnits,
  parseBoundPolicy,
  packetsNeedingCover,
  RUN,
  stagesToRun,
  type SeedRecord,
} from '../scripts/testnet/demo-seed/plan.js';
import {
  SCENARIO,
  runtime,
  scenarioProblems,
  showcase,
  timecode,
} from '../scripts/testnet/demo-seed/scenario.js';

const BIND_OUTPUT = `series ODI-COMP-2026-01: claims_open, free capacity 77000000000
cover 2025-12-01 to 2026-12-01
claims payable from 2026-01-30
binding receipt sequence 118
bind 0x1234, gas 207324
policy receipt 0.0.10366468 serial 21

policy      pol_01M1S3EBDQR3W79A9E8MR6MPYB
cover key   K7QP K7QP K7QP K7QP K7QP
holder      0.0.10366453 0xcad39730d48683b13e6077a70c6972add449b6f5
nullifier   stored, 19 digits
bind        https://hashscan.io/testnet/transaction/0xabc123
exposure    24000000000 of 98000000000
`;

function recordWith(policies: SeedRecord['policies']): SeedRecord {
  return { ...emptyRecord('testnet'), policies };
}

describe('the stages', () => {
  it('runs every stage in order when none is named', () => {
    expect(stagesToRun(undefined)).toEqual(RUN);
    expect(stagesToRun('all')).toEqual(RUN);
  });

  it('runs one stage alone, so a run that died half way through is resumed', () => {
    expect(stagesToRun('packets')).toEqual(['packets']);
  });

  it('refuses a stage it does not have, and says which it has', () => {
    expect(() => stagesToRun('claims')).toThrow(/unknown stage "claims"/);
    expect(() => stagesToRun('claims')).toThrow(/status, policies, investors, packets, verify, all/);
  });

  it('reads the status of the world before it changes any of it', () => {
    expect(RUN[0]).toBe('status');
    expect(RUN[RUN.length - 1]).toBe('verify');
  });
});

describe('what still needs binding', () => {
  const seeded = [
    {
      role: 'policyholder-1',
      packet: 'a' as const,
      policyId: 'pol_A',
      accountId: '0.0.10366453',
      address: '0xcad3',
      startAt: COVER.startAt,
      claimsPayableFrom: '2026-01-30',
      limit: COVER.limit,
    },
    {
      role: 'policyholder-3',
      packet: 'b' as const,
      policyId: 'pol_B',
      accountId: '0.0.10366458',
      address: '0xb4e3',
      startAt: COVER.startAt,
      claimsPayableFrom: '2026-01-30',
      limit: COVER.limit,
    },
  ];

  it('binds both packets from nothing', () => {
    expect(packetsNeedingCover(emptyRecord('testnet'), () => true).map((plan) => plan.packet)).toEqual([
      'a',
      'b',
    ]);
  });

  it('binds nothing on a second run, which is the run that matters on video day', () => {
    expect(packetsNeedingCover(recordWith(seeded), () => true)).toEqual([]);
  });

  it('rebinds only the packet whose cover was used up', () => {
    const needed = packetsNeedingCover(recordWith(seeded), (policyId) => policyId !== 'pol_A');
    expect(needed.map((plan) => plan.packet)).toEqual(['a']);
  });

  it('keeps the approved and the declined paths on different accounts', () => {
    const roles = PACKETS.map((plan) => plan.role);
    expect(new Set(roles).size).toBe(PACKETS.length);
  });
});

describe('reading the bind command back', () => {
  it('takes the policy id, the transaction and the receipt serial from the printed block', () => {
    expect(parseBoundPolicy(BIND_OUTPUT)).toEqual({
      policyId: 'pol_01M1S3EBDQR3W79A9E8MR6MPYB',
      coverKey: 'K7QPK7QPK7QPK7QPK7QP',
      bindTx: '0xabc123',
      nftSerial: 21,
      claimsPayableFrom: '2026-01-30',
    });
  });

  it('takes the cover key without the groups it was printed in', () => {
    expect(parseBoundPolicy(BIND_OUTPUT).coverKey).toHaveLength(20);
  });

  it('leaves the key out when the bind command printed none, rather than inventing one', () => {
    const older = BIND_OUTPUT.replace(/^cover key.*\n/m, '');
    expect(parseBoundPolicy(older).coverKey).toBeUndefined();
  });

  it('refuses output with no policy in it rather than recording a half bind', () => {
    expect(() => parseBoundPolicy('series ODI-COMP-2026-01: active\n')).toThrow(/no policy id/);
  });
});

describe('whether a packet can be claimed on the cover under it', () => {
  const policy = { claimsPayableFrom: '2026-01-30', endsAt: '2026-12-01T00:00:00.000Z' };
  const windowEnds = new Date('2026-10-05T09:04:51Z');
  const now = new Date('2026-09-08T10:00:00Z');

  it('passes the committed packets against the cover the seed binds', () => {
    for (const plan of PACKETS) {
      expect(coverProblems(plan, policy, windowEnds, now)).toEqual([]);
    }
  });

  it('catches a separation inside the waiting period', () => {
    const early = { ...PACKETS[0]!, separationDate: '2025-12-20' };
    expect(coverProblems(early, policy, windowEnds, now)).toEqual([
      'separation 2025-12-20 is inside the waiting period, which ends 2026-01-30',
    ]);
  });

  it('catches a claim window that has already closed', () => {
    const late = new Date('2026-10-06T00:00:00Z');
    expect(coverProblems(PACKETS[0]!, policy, windowEnds, late)).toEqual([
      'the claim window closed 2026-10-05T09:04:51.000Z',
    ]);
  });

  it('catches a separation after the cover ended', () => {
    const expired = { ...PACKETS[0]!, separationDate: '2027-01-04' };
    expect(coverProblems(expired, policy, windowEnds, now)).toEqual([
      'separation 2027-01-04 is after the cover ended 2026-12-01',
    ]);
  });
});

describe('the replay scenario', () => {
  it('is a cut that can be shot', () => {
    expect(scenarioProblems()).toEqual([]);
  });

  it('fits the gate ETHGlobal enforces', () => {
    expect(runtime()).toBeGreaterThanOrEqual(120);
    expect(runtime()).toBeLessThanOrEqual(240);
    expect(timecode(runtime())).toBe('3:50');
  });

  it('shows the reserve, both claims and the release, in that order', () => {
    const proved = SCENARIO.flatMap((beat) => beat.proves ?? []);
    expect(proved).toEqual(['reserve', 'approved-claim', 'declined-claim', 'reserve-release']);
  });

  it('drops only the harness beat from the showcase cut, which stays inside the gate', () => {
    const cut = showcase();
    expect(cut).toHaveLength(SCENARIO.length - 1);
    expect(scenarioProblems(cut)).toEqual([]);
  });

  it('names a command or a screen for every beat', () => {
    for (const beat of SCENARIO) {
      expect(beat.surface.length).toBeGreaterThan(0);
      expect(beat.before.length).toBeGreaterThan(0);
    }
  });
});

describe('printing amounts', () => {
  it('reads a cover limit the way the shot list says it out loud', () => {
    expect(inUnits(COVER.limit, 6)).toBe('1,000');
    expect(inUnits(COVER.premium, 6)).toBe('28');
    expect(inUnits('100000000000', 6)).toBe('100,000');
    expect(inUnits('1500000', 6)).toBe('1.5');
  });
});
