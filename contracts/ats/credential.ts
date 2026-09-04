import { createEcdsaCredential, EthrDID } from '@terminal3/ecdsa_vc';
import { DID } from '@terminal3/vc_core';
import { verifyVc } from '@terminal3/verify_vc';

/// Internal KYC on an ATS bond is not a list of addresses. It is a per account
/// record carrying the id of a verifiable credential, its validity window and
/// the address of a registered issuer. The contract stores the id as an opaque
/// string and never checks the signature; the check is off chain, and this
/// module is where this build does it, so the id written on chain always points
/// at a credential that verified.

export interface SignedCredential {
  id: string;
  issuer: string;
  validFrom?: string;
  validUntil?: string;
  credentialSubject: { id: string; [claim: string]: unknown };
  [field: string]: unknown;
}

/// The DID method segment. The credential is an ECDSA secp256k1 assertion over
/// its own contents, so the segment only names where the issuer key lives; it
/// is not resolved against a registry during verification.
const DID_NETWORK = 'hedera';

const HUNDRED_YEARS_MS = 100 * 365 * 24 * 60 * 60 * 1000;

/// A KYC credential for one investor, signed by the issuer key. The issuer has
/// to be registered on the security with addIssuer before the grant, or the
/// grant reverts.
export async function createKycCredential(
  issuerPrivateKeyHex: string,
  holderEvmAddress: string,
): Promise<SignedCredential> {
  const issuer = new EthrDID(issuerPrivateKeyHex, DID_NETWORK);
  const holder = new DID('ethr', holderEvmAddress.toLowerCase());
  const credential = await createEcdsaCredential(
    issuer,
    holder,
    { kyc: 'passed' },
    ['KycCredential'],
    undefined,
    undefined,
    {},
  );
  return credential as unknown as SignedCredential;
}

/// verifyVc reports a bad signature by throwing, not by returning isValid
/// false, so the SDK's own `if (!result.isValid)` branch never runs for the
/// case it names. Both outcomes are a rejection here. See docs/harness-notes.md.
export async function verifyCredential(credential: SignedCredential): Promise<boolean> {
  try {
    const result = (await verifyVc(credential as never)) as { isValid: boolean };
    return result.isValid;
  } catch {
    return false;
  }
}

/// The last colon separated segment of a DID, which is the EVM address in both
/// did:ethr:<network>:<address> and did:ethr:<address>.
function addressOf(did: string): string {
  const segment = did.split(':').pop();
  if (segment === undefined || !/^0x[0-9a-fA-F]{40}$/.test(segment)) {
    throw new Error(`no EVM address at the end of the identifier "${did}"`);
  }
  return segment;
}

export interface GrantKycArguments {
  account: string;
  vcId: string;
  validFrom: number;
  validTo: number;
  issuer: string;
}

/// Turn a credential into the five arguments Kyc.grantKyc takes, by the same
/// rules the SDK's GrantKycCommandHandler uses: the credential id, its dates as
/// Unix seconds, and the issuer read off the credential rather than passed in.
/// A credential with no validUntil is treated as valid for a hundred years,
/// which is the SDK's default and not something the contract supplies.
export function grantKycArguments(
  credential: SignedCredential,
  targetEvmAddress: string,
  nowMs: number,
): GrantKycArguments {
  const holder = addressOf(credential.credentialSubject.id);
  if (holder.toLowerCase() !== targetEvmAddress.toLowerCase()) {
    throw new Error(`the credential names ${holder} but the grant targets ${targetEvmAddress}`);
  }
  const validFromMs = credential.validFrom ? Date.parse(credential.validFrom) : nowMs;
  const hasUntil = credential.validUntil !== undefined && credential.validUntil.trim() !== '';
  const validToMs = hasUntil
    ? Date.parse(credential.validUntil as string)
    : nowMs + HUNDRED_YEARS_MS;
  if (Number.isNaN(validFromMs) || Number.isNaN(validToMs)) {
    throw new Error('the credential carries a validity date that is not a date');
  }
  if (validFromMs > validToMs) {
    throw new Error('the credential is valid until before it is valid from');
  }
  return {
    account: targetEvmAddress,
    vcId: credential.id,
    validFrom: Math.floor(validFromMs / 1000),
    validTo: Math.floor(validToMs / 1000),
    issuer: addressOf(credential.issuer),
  };
}
