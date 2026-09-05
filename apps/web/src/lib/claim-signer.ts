import { roleKeyHex } from '@creance/client/src/hedera/keys';
import { signClaimAttestation, type ClaimAttestationFields } from '@creance/client/src/claim';

import { serverVar } from './server-env';
import { demoRoleOf } from './wallet';

/**
 * Who signs the attestation on C5, and with what.
 *
 * docs/CLAIMS.md makes the signature `eip191` recovered against the cover's own
 * EVM address, which is the address `payClaim` pays. There is no wallet in the
 * browser that can sign, so this is a server side signer holding the key of the
 * account the cover is bound to, exactly as src/lib/payer.ts is a server side
 * payer holding the key of the account the premium comes from, and for the same
 * reason: the HashPack path is not wired and a demo that pretends otherwise is
 * worse than one that says so.
 *
 * The key is derived rather than stored, with the same HKDF label the API uses,
 * so a clone with the operator key has it and no new secret exists. No key ever
 * reaches the browser: this module is only ever loaded on the server.
 *
 * A cover held by an account this app has no role for is signed by nobody, and
 * the packet goes up as `unsigned_accepted`, which is the honest name for a
 * recorded click-through with no signature. The API stores it as what it is,
 * the Adjuster's R10 refers it, and the confidence cap keeps it out of
 * auto-approval, so nothing is quietly waved through.
 *
 * https://eips.ethereum.org/EIPS/eip-191
 */

export interface SignedClaimAttestation {
  readonly method: 'eip191' | 'unsigned_accepted';
  readonly signature: string;
}

/** The unsigned form: recorded as accepted, signed by nothing. */
const UNSIGNED: SignedClaimAttestation = { method: 'unsigned_accepted', signature: '' };

export async function signAttestationAs(
  holderAccountId: string,
  fields: ClaimAttestationFields,
): Promise<SignedClaimAttestation> {
  const role = demoRoleOf(holderAccountId);
  const operator = serverVar('HEDERA_OPERATOR_KEY');
  if (role === null || operator === null) return UNSIGNED;
  try {
    const signed = await signClaimAttestation(roleKeyHex(operator, role), fields);
    return { method: 'eip191', signature: signed.signature };
  } catch (cause) {
    console.error(`[web] the attestation could not be signed as ${role}. ${String(cause)}`);
    return UNSIGNED;
  }
}
