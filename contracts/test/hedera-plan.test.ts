import { describe, expect, it } from 'vitest';
import { ACCOUNT_ROLES, type AccountRole } from '../scripts/hedera/derive.js';
import {
  DISTRIBUTION_WHOLE_TOKENS,
  EXPLICIT_POLICY_NFT_ASSOCIATIONS,
  EXPLICIT_SETTLEMENT_ASSOCIATIONS,
  type HederaRecord,
  type PlanInput,
  TOPIC_NAMES,
  planIsEmpty,
  planSetup,
} from '../scripts/hedera/plan.js';

const SETTLEMENT = '0.0.5001';
const POLICY_NFT = '0.0.5002';

function completeRecord(): HederaRecord {
  const accounts: HederaRecord['accounts'] = {};
  ACCOUNT_ROLES.forEach((role, index) => {
    accounts[role] = {
      accountId: `0.0.${4000 + index}`,
      evmAddress: `0x${(index + 1).toString(16).padStart(40, 'a')}`,
    };
  });
  const topics: HederaRecord['topics'] = {};
  TOPIC_NAMES.forEach((name, index) => {
    topics[name] = { topicId: `0.0.${6000 + index}`, memo: name, submitKeyRole: null };
  });
  return {
    network: 'testnet',
    operator: { accountId: '0.0.1', evmAddress: '0x1' },
    accounts,
    settlementToken: {
      tokenId: SETTLEMENT,
      evmAddress: '0x0000000000000000000000000000000000001389',
      name: 'Creance Test USD',
      symbol: 'TUSD',
      decimals: 6,
      origin: 'created',
    },
    policyNft: {
      tokenId: POLICY_NFT,
      evmAddress: '0x000000000000000000000000000000000000138a',
      name: 'Creance Occupation Cover Policy',
      symbol: 'CPOL',
      decimals: 0,
      freezeDefault: true,
    },
    topics,
    distributions: Object.fromEntries(
      Object.entries(DISTRIBUTION_WHOLE_TOKENS).map(([role, whole]) => [
        role,
        (BigInt(whole) * 1_000_000n).toString(),
      ]),
    ),
    associations: {
      api: [SETTLEMENT],
      steward: [SETTLEMENT],
      'policyholder-1': [POLICY_NFT],
      'policyholder-2': [POLICY_NFT],
      'policyholder-3': [POLICY_NFT],
    },
    findings: {
      freezeDefault: {
        composesWithAutoAssociation: true,
        probeTokenId: '0.0.4999',
        probeAccountId: '0.0.4998',
        detail: 'probe transfer landed',
        metadataLimit: 'bytes',
        metadataDetail: 'probe mint rejected 120 bytes in 60 characters',
      },
    },
    operatorBalanceHbarAtLastChange: '1030',
    lastChanged: '2026-09-04',
  };
}

function settledInput(record: HederaRecord): PlanInput {
  const balances: PlanInput['balances'] = {};
  const associated: PlanInput['associated'] = {};
  for (const [role, whole] of Object.entries(DISTRIBUTION_WHOLE_TOKENS) as [AccountRole, number][]) {
    balances[role] = BigInt(whole) * 1_000_000n;
  }
  for (const role of EXPLICIT_SETTLEMENT_ASSOCIATIONS) {
    associated[role] = new Set([SETTLEMENT]);
  }
  for (const role of EXPLICIT_POLICY_NFT_ASSOCIATIONS) {
    associated[role] = new Set([POLICY_NFT]);
  }
  return {
    record,
    confirmed: {
      accounts: new Set(Object.values(record.accounts).map((a) => a.accountId)),
      tokens: new Set([SETTLEMENT, POLICY_NFT]),
      topics: new Set(Object.values(record.topics).map((t) => t.topicId)),
    },
    balances,
    associated,
    settlementDecimals: 6,
  };
}

describe('planSetup', () => {
  it('plans everything from an empty record', () => {
    const record = completeRecord();
    const empty: HederaRecord = {
      ...record,
      accounts: {},
      settlementToken: null,
      policyNft: null,
      topics: {},
      distributions: {},
      associations: {},
      findings: { freezeDefault: null },
    };
    const plan = planSetup({
      record: empty,
      confirmed: { accounts: new Set(), tokens: new Set(), topics: new Set() },
      balances: {},
      associated: {},
      settlementDecimals: 6,
    });
    expect(plan.accounts).toEqual([...ACCOUNT_ROLES]);
    expect(plan.settlementToken).toBe(true);
    expect(plan.policyNft).toBe(true);
    expect(plan.freezeDefaultProbe).toBe(true);
    expect(plan.topics).toEqual([...TOPIC_NAMES]);
    expect(plan.distributions).toEqual(Object.keys(DISTRIBUTION_WHOLE_TOKENS));
    expect(plan.associations).toHaveLength(
      EXPLICIT_SETTLEMENT_ASSOCIATIONS.length + EXPLICIT_POLICY_NFT_ASSOCIATIONS.length,
    );
    expect(planIsEmpty(plan)).toBe(false);
  });

  it('plans nothing on a second run, which is what keeps git clean', () => {
    const record = completeRecord();
    expect(planIsEmpty(planSetup(settledInput(record)))).toBe(true);
  });

  it('re-creates only what the mirror node cannot confirm', () => {
    const record = completeRecord();
    const input = settledInput(record);
    input.confirmed.topics.delete(record.topics.claims?.topicId ?? '');
    const plan = planSetup(input);
    expect(plan.topics).toEqual(['claims']);
    expect(plan.accounts).toEqual([]);
    expect(plan.settlementToken).toBe(false);
  });

  it('tops a holder up when its balance fell short', () => {
    const record = completeRecord();
    const input = settledInput(record);
    input.balances['policyholder-2'] = 9_999_999_999n;
    expect(planSetup(input).distributions).toEqual(['policyholder-2']);
  });

  it('does not re-run the probe once the collection exists', () => {
    const record = completeRecord();
    record.findings.freezeDefault = null;
    const plan = planSetup(settledInput(record));
    expect(plan.policyNft).toBe(false);
    expect(plan.freezeDefaultProbe).toBe(false);
  });

  it('runs the probe again when the collection has to be re-created', () => {
    const record = completeRecord();
    record.findings.freezeDefault = null;
    const input = settledInput(record);
    input.confirmed.tokens.delete(POLICY_NFT);
    const plan = planSetup(input);
    expect(plan.policyNft).toBe(true);
    expect(plan.freezeDefaultProbe).toBe(true);
  });

  it('re-distributes and re-associates when the settlement token is gone', () => {
    const record = completeRecord();
    const input = settledInput(record);
    input.confirmed.tokens.delete(SETTLEMENT);
    const plan = planSetup(input);
    expect(plan.settlementToken).toBe(true);
    expect(plan.distributions).toEqual(Object.keys(DISTRIBUTION_WHOLE_TOKENS));
    expect(plan.associations.filter((a) => a.kind === 'settlement')).toHaveLength(
      EXPLICIT_SETTLEMENT_ASSOCIATIONS.length,
    );
    expect(plan.associations.filter((a) => a.kind === 'policyNft')).toHaveLength(0);
  });

  it('associates a re-created account again even when the token is unchanged', () => {
    const record = completeRecord();
    const input = settledInput(record);
    input.confirmed.accounts.delete(record.accounts.steward?.accountId ?? '');
    const plan = planSetup(input);
    expect(plan.accounts).toEqual(['steward']);
    expect(plan.associations).toEqual([{ role: 'steward', kind: 'settlement' }]);
  });
});
