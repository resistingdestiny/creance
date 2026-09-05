import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { parseProfile } from '../src/profile.js';

const demo = {
  principal: 'policyholder-2',
  occupation: 'computer_math',
  wallet: {
    account_id: '0.0.10366457',
    evm_address: '0xf4801d2881df3f4deccf6f4b22302232cbfa5c13',
  },
  cover_limit: '1000000000',
  eligibility: { source: 'api_demo_issuer' },
};

describe('parseProfile', () => {
  it('reads the committed demo profile', () => {
    const value = JSON.parse(
      readFileSync(new URL('../profiles/policyholder-2.json', import.meta.url), 'utf8'),
    ) as unknown;
    const profile = parseProfile(value);
    expect(profile.principal).toBe('policyholder-2');
    expect(profile.occupation).toBe('computer_math');
    expect(profile.wallet.accountId).toBe('0.0.10366457');
    expect(profile.coverLimit).toBe('1000000000');
    expect(profile.eligibility.kind).toBe('api_demo_issuer');
  });

  it('takes a credential carried in the profile', () => {
    const profile = parseProfile({
      ...demo,
      eligibility: { source: 'inline', credential: 'header.body.signature' },
    });
    expect(profile.eligibility).toEqual({ kind: 'inline', credential: 'header.body.signature' });
  });

  it('refuses an eligibility source it does not know', () => {
    expect(() => parseProfile({ ...demo, eligibility: { source: 'world' } })).toThrow(
      /inline or api_demo_issuer/,
    );
  });

  it('refuses a wallet that is not a Hedera account id', () => {
    expect(() =>
      parseProfile({ ...demo, wallet: { ...demo.wallet, account_id: '0xf4801d28' } }),
    ).toThrow(/0\.0\.x form/);
  });

  it('refuses an EVM address that is not twenty bytes', () => {
    expect(() => parseProfile({ ...demo, wallet: { ...demo.wallet, evm_address: '0xf480' } })).toThrow(
      /20 byte EVM address/,
    );
  });

  it('refuses a cover limit written as a decimal', () => {
    expect(() => parseProfile({ ...demo, cover_limit: '1000.00' })).toThrow(/minor units/);
  });

  it('names the field that is missing', () => {
    const { occupation: _dropped, ...without } = demo;
    expect(() => parseProfile(without)).toThrow(/occupation/);
  });
});
