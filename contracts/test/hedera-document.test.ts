import { describe, expect, it } from 'vitest';
import {
  BEGIN_MARKER,
  END_MARKER,
  mergeDocument,
  renderGeneratedBlock,
} from '../scripts/hedera/document.js';
import type { HederaRecord } from '../scripts/hedera/plan.js';
import { ACCOUNT_ROLES } from '../scripts/hedera/derive.js';
import { TOPIC_NAMES } from '../scripts/hedera/plan.js';

function record(): HederaRecord {
  const accounts: HederaRecord['accounts'] = {};
  ACCOUNT_ROLES.forEach((role, index) => {
    accounts[role] = {
      accountId: `0.0.${4000 + index}`,
      evmAddress: `0x${(index + 1).toString(16).padStart(40, 'b')}`,
    };
  });
  const topics: HederaRecord['topics'] = {};
  TOPIC_NAMES.forEach((name, index) => {
    topics[name] = { topicId: `0.0.${6000 + index}`, memo: `memo ${name}`, submitKeyRole: null };
  });
  return {
    network: 'testnet',
    operator: { accountId: '0.0.10362512', evmAddress: '0x639444758b987b4d938c57169a1f61a62b2d009c' },
    accounts,
    settlementToken: {
      tokenId: '0.0.5001',
      evmAddress: '0x0000000000000000000000000000000000001389',
      name: 'Creance Test USD',
      symbol: 'TUSD',
      decimals: 6,
      origin: 'created',
    },
    policyNft: {
      tokenId: '0.0.5002',
      evmAddress: '0x000000000000000000000000000000000000138a',
      name: 'Creance Occupation Cover Policy',
      symbol: 'CPOL',
      decimals: 0,
      freezeDefault: true,
    },
    topics,
    distributions: { 'policyholder-1': '10000000000', 'investor-1': '250000000000' },
    associations: {},
    findings: {
      freezeDefault: {
        composesWithAutoAssociation: true,
        probeTokenId: '0.0.4999',
        probeAccountId: '0.0.4998',
        detail: 'the transfer landed',
        metadataLimit: 'bytes',
        metadataDetail: '120 bytes in 60 characters was rejected',
      },
    },
    blocky402: { facilitator: 'https://api.testnet.blocky402.com', feePayer: '0.0.7162784' },
    operatorBalanceHbarAtLastChange: '1030',
    lastChanged: '2026-09-04',
  };
}

describe('renderGeneratedBlock', () => {
  it('is a pure function of the record, so a re-run rewrites the same bytes', () => {
    expect(renderGeneratedBlock(record())).toBe(renderGeneratedBlock(record()));
  });

  it('carries the ids, the HashScan links and the balances', () => {
    const block = renderGeneratedBlock(record());
    expect(block).toContain('https://hashscan.io/testnet/account/0.0.4000');
    expect(block).toContain('https://hashscan.io/testnet/token/0.0.5001');
    expect(block).toContain('https://hashscan.io/testnet/topic/0.0.6000');
    expect(block).toContain('10000 TUSD');
    expect(block).toContain('250000 TUSD');
    expect(block).toContain('0.0.7162784');
    expect(block).toContain('Operator balance when this file was last changed: 1030 HBAR.');
  });

  it('shows the long-zero form for a topic and the key derived form for an account', () => {
    const block = renderGeneratedBlock(record());
    expect(block).toContain('0x0000000000000000000000000000000000001770');
    expect(block).toContain('0x639444758b987b4d938c57169a1f61a62b2d009c');
  });
});

describe('mergeDocument', () => {
  it('builds the whole file when there is nothing there yet', () => {
    const merged = mergeDocument(null, 'BLOCK');
    expect(merged).toContain('# Hedera testnet resources');
    expect(merged).toContain(`${BEGIN_MARKER}\n\nBLOCK\n\n${END_MARKER}`);
    expect(merged).toContain('## Contracts');
    expect(merged).toContain('## Scheduled transactions');
    expect(merged).toContain('## Asset Tokenization Studio');
  });

  it('replaces only the generated block, leaving later tickets their sections', () => {
    const first = mergeDocument(null, 'OLD');
    const edited = `${first}\n## T04 notes\n\nCoverPool at 0xabc.\n`;
    const merged = mergeDocument(edited, 'NEW');
    expect(merged).toContain('NEW');
    expect(merged).not.toContain('OLD');
    expect(merged).toContain('CoverPool at 0xabc.');
  });

  it('is stable when the block has not changed', () => {
    const first = mergeDocument(null, 'BLOCK');
    expect(mergeDocument(first, 'BLOCK')).toBe(first);
  });
});
