import { createHash } from 'node:crypto';

import { getAddress, verifyMessage } from 'ethers';

import { AppError } from '../errors.js';

/// The attestation: item 2 of the packet in DESIGN.md 3.9.
///
/// "An attestation signed by the policy wallet: employer name, job title,
/// occupation group (must equal the policy's), last day of work, separation
/// type, and a statement that the contents are true and that a false claim is
/// fraud."
///
/// A signature is only worth what the signed bytes say, so the bytes are
/// written out here, once, in a canonical form. The web app in T16, the client
/// helper in packages/client and the two committed fixtures all build the same
/// string from the same fields; anything else and a wallet would sign one
/// sentence while the API checked another.
///
/// The form is deliberately human readable rather than a hash or a JSON blob.
/// The person is signing it in a wallet that will show it to them, and a
/// prompt reading "0x9f3c..." is a prompt nobody can refuse meaningfully.
///
/// Rules R09 and R10 in docs/CLAIMS.md read the two facts this produces, and
/// they are different facts: `statement_accepted` is whether the person ticked
/// the box, and `attestation_verified` is whether the wallet signed. A signed
/// message proves who sent it and not that they read what it said.

/** The four covered kinds, and the four this cover does not pay for. */
export const SEPARATION_TYPES = [
  'layoff',
  'redundancy',
  'position_eliminated',
  'site_closure',
  'resignation',
  'dismissal_for_cause',
  'fixed_term_end',
  'client_loss_self_employed',
] as const;

export type SeparationType = (typeof SEPARATION_TYPES)[number];

export interface AttestationFields {
  policyId: string;
  seriesId: string;
  fullName: string;
  employerName: string;
  jobTitle: string;
  groupKey: string;
  /** The last day of work, as a calendar date, YYYY-MM-DD. */
  lastDayOfWork: string;
  separationType: SeparationType;
}

/** The sentence the checkbox in screen C5 carries, verbatim. */
export const FRAUD_STATEMENT =
  "Everything here is true. I understand that a false claim is fraud.";

/**
 * The exact bytes a wallet signs.
 *
 * Lines joined with a single newline and no trailing one. Every value is
 * trimmed and its internal whitespace collapsed before it goes in, so a stray
 * space typed into a form field cannot produce a message the API rebuilds
 * differently from the one the wallet showed.
 */
export function attestationMessage(fields: AttestationFields): string {
  return [
    'Creance claim attestation',
    `Policy: ${fields.policyId}`,
    `Series: ${fields.seriesId}`,
    `Name: ${tidy(fields.fullName)}`,
    `Employer: ${tidy(fields.employerName)}`,
    `Job title: ${tidy(fields.jobTitle)}`,
    `Occupation: ${fields.groupKey}`,
    `Last day of work: ${fields.lastDayOfWork.slice(0, 10)}`,
    `How it ended: ${fields.separationType}`,
    FRAUD_STATEMENT,
  ].join('\n');
}

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

function tidy(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}
