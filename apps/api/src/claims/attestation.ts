import { createHash } from 'node:crypto';

import { getAddress, verifyMessage } from 'ethers';

import {
  claimAttestationMessage,
  FRAUD_STATEMENT,
  SEPARATION_TYPES,
  type ClaimAttestationFields,
  type SeparationType,
} from '@creance/client';

import { AppError } from '../errors.js';

/// The attestation: item 2 of the packet in DESIGN.md 3.9.
///
/// "An attestation signed by the policy wallet: employer name, job title,
/// occupation group (must equal the policy's), last day of work, separation
/// type, and a statement that the contents are true and that a false claim is
/// fraud."
///
/// A signature is only worth what the signed bytes say, so the bytes are
/// written out once, in a canonical form, in `@creance/client`. The web app in
/// T16, the testnet script and the demo seed all build them and none of them
/// may import from this workspace; two implementations of a signed message is
/// one wallet signing a sentence the API never checks. This module is the other
/// half: whether the policy's own wallet produced it.
///
/// Rules R09 and R10 in docs/CLAIMS.md read the two facts this produces, and
/// they are different facts: `statement_accepted` is whether the person ticked
/// the box, and `attestation_verified` is whether the wallet signed. A signed
/// message proves who sent it and not that they read what it said.

/// The canonical message and the eight separation types are in
/// `@creance/client`, not here. The web app, the testnet script and the demo
/// seed all build the bytes a wallet signs, none of them may import from this
/// workspace, and two implementations of a signed message is one wallet signing
/// a sentence the API never checks. They are re-exported so a reader of this
/// file finds them where they expect to.

export {
  claimAttestationMessage as attestationMessage,
  FRAUD_STATEMENT,
  SEPARATION_TYPES,
  type ClaimAttestationFields as AttestationFields,
  type SeparationType,
};

/** `sha256:<hex>` over the message, stored so the signed bytes are recoverable. */
export function attestationMessageHash(message: string): string {
  return `sha256:${createHash('sha256').update(message, 'utf8').digest('hex')}`;
}

export type AttestationMethod = 'eip191' | 'hedera_sign_message' | 'unsigned_accepted';

export interface SignedAttestation {
  method: AttestationMethod;
  /** Absent on `unsigned_accepted`, which is a recorded click-through. */
  signature: string | null;
}

/**
 * Whether the policy's own wallet signed the message.
 *
 * `eip191` is `personal_sign`, which is what every EVM wallet and
 * `ethers.Wallet.signMessage` produce, and the recovered address is compared
 * with the policy's EVM address. That address is the one the cover was bound
 * to and the one `payClaim` pays, so this is the only comparison that means
 * "the person who holds the cover said this".
 *
 * `unsigned_accepted` is the honest name for a recorded click-through with no
 * signature behind it. It is accepted, stored as what it is, and rule R10
 * refers the claim to a person rather than declining it: weaker evidence is
 * not a broken flow. It can never auto-approve.
 *
 * `hedera_sign_message` is reserved for a wallet that signs with a Hedera key
 * rather than an EVM one. Nothing produces one in this build, because the web
 * app's wallet mode is the demo account, so it is refused here rather than
 * accepted unchecked: an unverified signature stored as verified is worse than
 * no signature at all.
 */
export function verifyAttestation(
  message: string,
  signed: SignedAttestation,
  walletEvm: string,
): boolean {
  if (signed.method === 'unsigned_accepted') return false;
  if (signed.method === 'hedera_sign_message') {
    throw new AppError(
      501,
      'attestation_method_unsupported',
      'That signature cannot be checked here',
      'This deployment can check an EIP-191 signature from the wallet that holds the cover, and nothing else yet.',
    );
  }
  const signature = signed.signature;
  if (signature === null || signature === '') {
    throw new AppError(
      400,
      'attestation_signature_missing',
      'Signature missing',
      'An eip191 attestation carries the signature the wallet produced.',
    );
  }
  let recovered: string;
  try {
    recovered = verifyMessage(message, signature);
  } catch {
    throw new AppError(
      400,
      'attestation_signature_malformed',
      'Signature malformed',
      'That signature could not be read.',
    );
  }
  if (getAddress(recovered) !== getAddress(walletEvm)) {
    throw new AppError(
      403,
      'attestation_wrong_wallet',
      'Wrong wallet',
      'That statement was signed by a wallet other than the one holding this cover.',
    );
  }
  return true;
}
