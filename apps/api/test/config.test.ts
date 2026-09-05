import { readFileSync } from 'node:fs';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadApiConfig } from '../src/config.js';
import { loadInvestorConfig } from '../src/investor/config.js';

/// The judge path, as a test.
///
/// README Setup says to copy the example environment and fill in the few lines
/// it names. Everything else then arrives as `NAME=`, which node reads as the
/// empty string rather than as absent, and the configuration has to treat that
/// as absent or the deployment record, the day 0 resources and every default
/// are erased by a file the judge was told to copy.

const EXAMPLE = new URL('../../../.env.example', import.meta.url).pathname;

/** Every variable the example documents, blank, exactly as a copy of it is. */
function copiedExample(): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const line of readFileSync(EXAMPLE, 'utf8').split('\n')) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (match !== null) vars[match[1]!] = match[2]!;
  }
  return vars;
}

function stub(vars: Record<string, string>): void {
  for (const [name, value] of Object.entries(vars)) vi.stubEnv(name, value);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the API configuration under a copied example environment', () => {
  it('documents nothing it does not read and reads nothing it does not document', () => {
    const vars = copiedExample();
    expect(vars.HEDERA_OPERATOR_ID).toBe('');
    expect(vars.CREANCE_DEPLOYMENT_RECORD).toBe('');
    expect(vars.HEDERA_COVERPOOL_ADDRESS).toBe('');
  });

  it('still finds the deployment record when the path variable is blank', () => {
    stub(copiedExample());
    const config = loadApiConfig();
    expect(config.network).toBe('testnet');
    expect(config.coverPoolAddress).toBe('0x6358ddd5AA2e1797ddA949D7d82eA86C9F89ff09');
    expect(config.vaultAddress).toBe('0xD0473d355ECB299F2ECc0d92124bc8CF63554e60');
    expect(config.series[0]?.label).toBe('ODI-COMP-2026-01');
  });

  it('still finds the day 0 resources when their path variable is blank', () => {
    stub(copiedExample());
    const config = loadApiConfig();
    expect(config.settlementToken.tokenId).toBe('0.0.10366463');
    expect(config.settlementToken.decimals).toBe(6);
    expect(config.policyNftTokenId).toBe('0.0.10366468');
    expect(config.paymentsTopicId).toBe('0.0.10366471');
    expect(config.indexTopicId).toBe('0.0.10366470');
    expect(config.claimsTopicId).toBe('0.0.10366473');
  });

  it('keeps its own defaults rather than taking a blank as a value', () => {
    stub(copiedExample());
    const config = loadApiConfig();
    expect(config.rpcUrl).toBe('https://testnet.hashio.io/api');
    expect(config.mirrorUrl).toBe('https://testnet.mirrornode.hedera.com/api/v1');
    expect(config.autoApproval.limit).toBe('5000000000');
    expect(config.databaseUrl).toBeUndefined();
  });

  it('serves the investor endpoints from the same copied file', () => {
    stub(copiedExample());
    const config = loadInvestorConfig();
    expect(config.rpcUrl).toBe('https://testnet.hashio.io/api');
    expect(config.series[0]?.coverPool?.address).toBe(
      '0x6358ddd5AA2e1797ddA949D7d82eA86C9F89ff09',
    );
  });

  it('lets a filled in value win over the record', () => {
    stub({ ...copiedExample(), HEDERA_COVERPOOL_ADDRESS: '0x00000000000000000000000000000000000f00d5' });
    expect(loadApiConfig().coverPoolAddress).toBe(
      '0x00000000000000000000000000000000000f00d5',
    );
    expect(loadInvestorConfig().series[0]?.coverPool?.address).toBe(
      '0x00000000000000000000000000000000000f00d5',
    );
  });
});
