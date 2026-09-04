// The committed record of what exists on testnet, and the pure function that
// decides what a run still has to create. Keeping the decision separate from
// the calls is what makes "run it twice, the second run changes nothing"
// testable without a network.
import { ACCOUNT_ROLES, type AccountRole } from './derive.js';

export interface AccountRecord {
  accountId: string;
  evmAddress: string;
}

export interface TokenRecord {
  tokenId: string;
  evmAddress: string;
  name: string;
  symbol: string;
  decimals: number;
}

export interface SettlementTokenRecord extends TokenRecord {
  /** 'created' when this script minted it, 'provided' when TESTNET_USDC_TOKEN_ID named it. */
  origin: 'created' | 'provided';
}

export interface PolicyNftRecord extends TokenRecord {
  freezeDefault: boolean;
}

export const TOPIC_NAMES = ['index', 'payments', 'claims', 'agent-journal'] as const;
export type TopicName = (typeof TOPIC_NAMES)[number];

export interface TopicRecord {
  topicId: string;
  memo: string;
  /** The role whose key signs a submission, or null for a public topic. */
  submitKeyRole: AccountRole | null;
}

export interface FreezeDefaultFinding {
  /** Does freezeDefault true compose with maxAutomaticTokenAssociations -1? */
  composesWithAutoAssociation: boolean;
  probeTokenId: string;
  probeAccountId: string;
  detail: string;
  /** Is the NFT metadata cap 100 characters or 100 bytes? */
  metadataLimit: 'bytes' | 'characters' | 'unknown';
  metadataDetail: string;
}

export interface HederaRecord {
  network: 'testnet';
  operator: AccountRecord;
  accounts: Partial<Record<AccountRole, AccountRecord>>;
  settlementToken: SettlementTokenRecord | null;
  policyNft: PolicyNftRecord | null;
  topics: Partial<Record<TopicName, TopicRecord>>;
  /** Settlement token balance handed to each holder, in minor units, as a string. */
  distributions: Partial<Record<AccountRole, string>>;
  /** Explicit associations already made, role to token ids. */
  associations: Partial<Record<AccountRole, string[]>>;
  findings: { freezeDefault: FreezeDefaultFinding | null };
  /** The x402 facilitator that will settle premiums, recorded for T08. */
  blocky402: { facilitator: string; feePayer: string } | null;
  operatorBalanceHbarAtLastChange: string;
  lastChanged: string;
}

/** Settlement token balances the demo needs, in whole tokens. */
export const DISTRIBUTION_WHOLE_TOKENS: Partial<Record<AccountRole, number>> = {
  'policyholder-1': 10_000,
  'policyholder-2': 10_000,
  'policyholder-3': 10_000,
  'investor-1': 250_000,
  'investor-2': 250_000,
};

/**
 * Accounts that get an explicit association rather than leaning on their
 * auto-association slot. The policyholders hold policy NFTs; the api and the
 * steward move the settlement token on someone else's behalf.
 */
export const EXPLICIT_SETTLEMENT_ASSOCIATIONS: AccountRole[] = ['api', 'steward'];
export const EXPLICIT_POLICY_NFT_ASSOCIATIONS: AccountRole[] = [
  'policyholder-1',
  'policyholder-2',
  'policyholder-3',
];

export const TOPIC_PLAN: Record<TopicName, { memo: string; submitKeyRole: AccountRole | null }> = {
  index: { memo: 'creance index observations ODI v1', submitKeyRole: 'oracle' },
  payments: { memo: 'creance premium and coupon settlements', submitKeyRole: 'api' },
  claims: { memo: 'creance claim decisions', submitKeyRole: 'adjuster' },
  'agent-journal': { memo: 'creance agent journal, public by design', submitKeyRole: null },
};

export interface SetupPlan {
  accounts: AccountRole[];
  settlementToken: boolean;
  freezeDefaultProbe: boolean;
  policyNft: boolean;
  topics: TopicName[];
  distributions: AccountRole[];
  associations: { role: AccountRole; kind: 'settlement' | 'policyNft' }[];
}

export function emptyPlan(): SetupPlan {
  return {
    accounts: [],
    settlementToken: false,
    freezeDefaultProbe: false,
    policyNft: false,
    topics: [],
    distributions: [],
    associations: [],
  };
}

export function planIsEmpty(plan: SetupPlan): boolean {
  return (
    plan.accounts.length === 0 &&
    !plan.settlementToken &&
    !plan.freezeDefaultProbe &&
    !plan.policyNft &&
    plan.topics.length === 0 &&
    plan.distributions.length === 0 &&
    plan.associations.length === 0
  );
}

export interface PlanInput {
  record: HederaRecord;
  /** Token ids the mirror node confirmed still exist. Anything absent is re-created. */
  confirmed: {
    accounts: Set<string>;
    tokens: Set<string>;
    topics: Set<string>;
  };
  /** Settlement token balance the mirror node reports per role, in minor units. */
  balances: Partial<Record<AccountRole, bigint>>;
  /** Token ids the mirror node reports each role is associated with. */
  associated: Partial<Record<AccountRole, Set<string>>>;
  settlementDecimals: number;
}

/**
 * What this run still has to do. Everything the record names is verified
 * against the mirror node first, so a record that drifted from the chain
 * repairs itself instead of being trusted.
 */
export function planSetup(input: PlanInput): SetupPlan {
  const { record, confirmed, balances, associated, settlementDecimals } = input;
  const plan = emptyPlan();

  const liveAccount = (role: AccountRole): AccountRecord | null => {
    const entry = record.accounts[role];
    return entry && confirmed.accounts.has(entry.accountId) ? entry : null;
  };

  for (const role of ACCOUNT_ROLES) {
    if (!liveAccount(role)) {
      plan.accounts.push(role);
    }
  }

  const settlement =
    record.settlementToken && confirmed.tokens.has(record.settlementToken.tokenId)
      ? record.settlementToken
      : null;
  plan.settlementToken = settlement === null;

  const nft = record.policyNft && confirmed.tokens.has(record.policyNft.tokenId) ? record.policyNft : null;
  plan.policyNft = nft === null;
  // The probe answers what freezeDefault the real collection is created with,
  // so it only runs when the collection does not exist yet.
  plan.freezeDefaultProbe = plan.policyNft && record.findings.freezeDefault === null;

  for (const name of TOPIC_NAMES) {
    const entry = record.topics[name];
    if (!entry || !confirmed.topics.has(entry.topicId)) {
      plan.topics.push(name);
    }
  }

  for (const [role, whole] of Object.entries(DISTRIBUTION_WHOLE_TOKENS) as [AccountRole, number][]) {
    const target = BigInt(whole) * 10n ** BigInt(settlementDecimals);
    const held = balances[role] ?? 0n;
    if (plan.accounts.includes(role) || plan.settlementToken || held < target) {
      plan.distributions.push(role);
    }
  }

  const wants = (role: AccountRole, tokenId: string | undefined): boolean => {
    if (tokenId === undefined) return true;
    if (plan.accounts.includes(role)) return true;
    return !(associated[role]?.has(tokenId) ?? false);
  };

  for (const role of EXPLICIT_SETTLEMENT_ASSOCIATIONS) {
    if (wants(role, settlement?.tokenId)) {
      plan.associations.push({ role, kind: 'settlement' });
    }
  }
  for (const role of EXPLICIT_POLICY_NFT_ASSOCIATIONS) {
    if (wants(role, nft?.tokenId)) {
      plan.associations.push({ role, kind: 'policyNft' });
    }
  }

  return plan;
}

export function describePlan(plan: SetupPlan): string[] {
  const lines: string[] = [];
  if (plan.accounts.length > 0) lines.push(`create accounts: ${plan.accounts.join(', ')}`);
  if (plan.settlementToken) lines.push('create the settlement token');
  if (plan.freezeDefaultProbe) lines.push('run the freeze default probe');
  if (plan.policyNft) lines.push('create the policy NFT collection');
  if (plan.topics.length > 0) lines.push(`create topics: ${plan.topics.join(', ')}`);
  if (plan.distributions.length > 0) {
    lines.push(`distribute the settlement token to: ${plan.distributions.join(', ')}`);
  }
  for (const association of plan.associations) {
    lines.push(`associate ${association.role} with the ${association.kind} token`);
  }
  return lines;
}
