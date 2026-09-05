import { describe, expect, it } from 'vitest';

import { bondData, maxSupplyFor, nominalValueFor, principalFor, type BondPlan } from '../ats/bond.js';
import { ATS, NOTE } from '../ats/config.js';
import { testIsinFor } from '../ats/isin.js';

const plan: BondPlan = {
  name: NOTE.name,
  symbol: NOTE.symbol,
  isin: testIsinFor('ODI-COMP-2026-01'),
  decimals: 6,
  units: 100n,
  nominalValue: 1_000n,
  startingDate: 1_788_549_000,
  maturityDate: 1_820_082_162,
  owner: '0x639444758b987b4d938c57169a1f61a62b2d009c',
  configVersion: 1,
  internalKycActivated: true,
  scaleMaxSupply: true,
};

describe('the bond plan', () => {
  it('multiplies units by nominal value into the series principal', () => {
    expect(principalFor(plan)).toBe(100_000n);
  });

  it('caps supply in the token decimals, not in whole units', () => {
    expect(maxSupplyFor(plan)).toBe(100_000_000n);
    expect(maxSupplyFor({ ...plan, scaleMaxSupply: false })).toBe(100n);
  });

  it('quotes the nominal value at the token scale', () => {
    expect(nominalValueFor(plan)).toBe(1_000_000_000n);
  });
});

describe('the deployBond arguments', () => {
  const rbacs = [
    { role: `0x${'00'.repeat(32)}`, members: [plan.owner] },
  ];

  it('carries the resolver, the bond configuration and the resolved version', () => {
    const data = bondData(plan, rbacs);
    expect(data.security.resolver).toBe(ATS.resolver);
    expect(data.security.resolverProxyConfiguration.key).toBe(ATS.bondConfigId);
    expect(data.security.resolverProxyConfiguration.version).toBe(1n);
  });

  it('sends the currency as three bytes, not the word USD', () => {
    expect(bondData(plan, rbacs).bondDetails.currency).toBe('0x555344');
    expect(Buffer.from('555344', 'hex').toString('ascii')).toBe('USD');
  });

  it('leaves clearing, control and the external T-REX modules off', () => {
    const { security } = bondData(plan, rbacs);
    expect(security.clearingActive).toBe(false);
    expect(security.isControllable).toBe(false);
    expect(security.isWhiteList).toBe(false);
    expect(security.compliance).toBe(`0x${'00'.repeat(20)}`);
    expect(security.identityRegistry).toBe(`0x${'00'.repeat(20)}`);
  });

  it('registers no external KYC list, because the two mechanisms are an AND', () => {
    const { security } = bondData(plan, rbacs);
    expect(security.internalKycActivated).toBe(true);
    expect(security.externalKycLists).toEqual([]);
  });

  it('sends no proceed recipients, so the two arrays cannot disagree in length', () => {
    const data = bondData(plan, rbacs);
    expect(data.proceedRecipients).toEqual([]);
    expect(data.proceedRecipientsData).toEqual([]);
  });

  it('refuses a maturity that is not after the start', () => {
    expect(() => bondData({ ...plan, maturityDate: plan.startingDate }, rbacs)).toThrow(
      /must be after the start/,
    );
  });
});
