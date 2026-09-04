import { describe, expect, it } from 'vitest';

import {
  createKycCredential,
  grantKycArguments,
  verifyCredential,
  type SignedCredential,
} from '../ats/credential.js';

// A throwaway key. Nothing this test signs reaches a chain.
const ISSUER_KEY = `0x${'11'.repeat(32)}`;
const ISSUER_ADDRESS = '0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A';
const HOLDER = '0xb6c2ff466e3c73f1a49a3f1b936f8e3837112931';
const NOW_MS = Date.parse('2026-09-04T20:00:00.000Z');

describe('the KYC credential', () => {
  it('signs a credential the verifier accepts, with no network access', async () => {
    const credential = await createKycCredential(ISSUER_KEY, HOLDER);
    expect(credential.issuer).toBe(`did:ethr:hedera:${ISSUER_ADDRESS}`);
    expect(credential.credentialSubject.id).toBe(`did:ethr:${HOLDER}`);
    expect(await verifyCredential(credential)).toBe(true);
  });

  it('is rejected once a claim is changed under the signature', async () => {
    const credential = await createKycCredential(ISSUER_KEY, HOLDER);
    const tampered = {
      ...credential,
      credentialSubject: { ...credential.credentialSubject, kyc: 'failed' },
    };
    expect(await verifyCredential(tampered)).toBe(false);
  });
});

describe('the grantKyc arguments', () => {
  const credential: SignedCredential = {
    id: 'urn:uuid:6b1f0a0e-0000-4000-8000-000000000000',
    issuer: `did:ethr:hedera:${ISSUER_ADDRESS}`,
    validFrom: '2026-09-04T19:00:00.000Z',
    validUntil: '',
    credentialSubject: { id: `did:ethr:${HOLDER}`, kyc: 'passed' },
  };

  it('reads the issuer and the dates off the credential', () => {
    const args = grantKycArguments(credential, HOLDER, NOW_MS);
    expect(args.issuer).toBe(ISSUER_ADDRESS);
    expect(args.vcId).toBe(credential.id);
    expect(args.validFrom).toBe(Date.parse('2026-09-04T19:00:00.000Z') / 1000);
  });

  it('defaults an empty validUntil to a hundred years out, as the SDK does', () => {
    const args = grantKycArguments(credential, HOLDER, NOW_MS);
    const hundredYears = 100 * 365 * 24 * 60 * 60;
    expect(args.validTo).toBe(Math.floor(NOW_MS / 1000) + hundredYears);
  });

  it('honours an explicit validUntil', () => {
    const args = grantKycArguments(
      { ...credential, validUntil: '2027-09-04T19:00:00.000Z' },
      HOLDER,
      NOW_MS,
    );
    expect(args.validTo).toBe(Date.parse('2027-09-04T19:00:00.000Z') / 1000);
  });

  it('refuses a credential issued to a different holder', () => {
    expect(() => grantKycArguments(credential, `0x${'ab'.repeat(20)}`, NOW_MS)).toThrow(
      /but the grant targets/,
    );
  });

  it('refuses an identifier that does not end in an EVM address', () => {
    const broken = { ...credential, issuer: 'did:ethr:hedera:not-an-address' };
    expect(() => grantKycArguments(broken, HOLDER, NOW_MS)).toThrow(/no EVM address/);
  });
});
