import { getBytes, isHexString } from 'ethers';

/// The claim authorisation, as EIP-712 typed data.
///
/// docs/DECISIONS.md, T04 "The claim authorisation is EIP-712 typed data with
/// three extra fields". DESIGN.md 3.6 names six: the policy id, the claim id,
/// the packet hash, the decision hash, the amount and the separation month.
/// `CoverPool` signs over three more. `nullifierHash` binds the authorisation
/// to the identity that bought the cover and re-verified at claim, so a
/// signature cannot be moved to another policy that happens to share an amount.
/// `payee` puts the destination inside the signed material. `deadline` makes a
/// leaked signature useless after half an hour.
///
/// `separationAt` replaces "separation month" because the contract derives the
/// month from the timestamp, and signing the derived value as well would make
/// two sources of truth for one fact.
///
/// The domain separator binds the signature to this contract on this chain, so
/// an authorisation produced against a local deployment cannot be replayed
/// against testnet. It is the same struct `CoverPool.CLAIM_AUTHORISATION_TYPEHASH`
/// declares, field for field and in order; adding a field here without adding
/// it there produces a signature that recovers to a stranger.

export const CLAIM_AUTHORISATION_DOMAIN_NAME = 'DisplacementBond';
export const CLAIM_AUTHORISATION_DOMAIN_VERSION = '1';

export const CLAIM_AUTHORISATION_TYPES = {
  ClaimAuthorisation: [
    { name: 'policyId', type: 'bytes32' },
    { name: 'claimId', type: 'bytes32' },
    { name: 'nullifierHash', type: 'bytes32' },
    { name: 'packetHash', type: 'bytes32' },
    { name: 'decisionHash', type: 'bytes32' },
    { name: 'payee', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'separationAt', type: 'uint64' },
    { name: 'deadline', type: 'uint64' },
  ],
} as const;

export interface ClaimAuthorisationDomain {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: string;
}

export function claimAuthorisationDomain(
  chainId: number,
  coverPoolAddress: string,
): ClaimAuthorisationDomain {
  return {
    name: CLAIM_AUTHORISATION_DOMAIN_NAME,
    version: CLAIM_AUTHORISATION_DOMAIN_VERSION,
    chainId,
    verifyingContract: coverPoolAddress,
  };
}

/** The signed message, in the field order the type declares. */
export interface ClaimAuthorisation {
  policyId: string;
  claimId: string;
  nullifierHash: string;
  packetHash: string;
  decisionHash: string;
  payee: string;
  amount: bigint;
  /** Seconds since the epoch, UTC midnight of the last day of work. */
  separationAt: number;
  /** Seconds since the epoch. After it `payClaim` reverts AuthorisationExpired. */
  deadline: number;
}

/**
 * How long an authorisation is good for.
 *
 * Thirty minutes, matching the eligibility credential's life in DESIGN.md 3.6.
 * Long enough that a relay hiccup can be retried by anybody, short enough that
 * a signature read off a log is worth nothing tomorrow.
 */
export const AUTHORISATION_TTL_SECONDS = 1800;

/**
 * The `bytes32` a `sha256:<hex>` digest string stands for.
 *
 * The packet hash and the decision hash are stored and published as prefixed
 * strings, because the topic messages carry them that way and a reader should
 * never have to guess which algorithm produced a bare hex string. The contract
 * takes 32 bytes. This is the one conversion, so the stored strings stay
 * exactly as they are.
 */
export function digestToBytes32(digest: string): string {
  const hex = digest.trim().replace(/^sha256:/i, '');
  const value = hex.startsWith('0x') ? hex : `0x${hex}`;
  if (!isHexString(value) || getBytes(value).length !== 32) {
    throw new Error(`${digest} is not a sha256 digest and cannot be a bytes32`);
  }
  return value.toLowerCase();
}

/** UTC midnight at the start of a calendar date, in seconds. */
export function separationAtOf(lastDayOfWork: string): number {
  const at = Date.parse(`${lastDayOfWork.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(at)) throw new Error(`${lastDayOfWork} is not a calendar date`);
  return Math.floor(at / 1000);
}
