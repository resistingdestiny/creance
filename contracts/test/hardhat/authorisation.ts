import type { Signer, TypedDataDomain } from 'ethers';

import type { CoverPool } from '../../types/ethers-contracts/index.js';

/// The claim authorisation the API signs after the Adjuster has decided. It is
/// EIP-712 typed data so the domain separator binds it to this contract on this
/// chain: an authorisation produced against the local deployment cannot be
/// replayed against testnet, and adding a field is a compile time break rather
/// than a silent hash collision.
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

export interface ClaimAuthorisation {
  policyId: string;
  claimId: string;
  nullifierHash: string;
  packetHash: string;
  decisionHash: string;
  payee: string;
  amount: bigint;
  separationAt: bigint;
  deadline: bigint;
}

export async function claimDomain(
  pool: CoverPool,
  chainId: bigint,
  verifyingContract?: string,
): Promise<TypedDataDomain> {
  return {
    name: 'DisplacementBond',
    version: '1',
    chainId,
    verifyingContract: verifyingContract ?? (await pool.getAddress()),
  };
}

export async function signAuthorisation(
  signer: Signer,
  domain: TypedDataDomain,
  value: ClaimAuthorisation,
): Promise<string> {
  return signer.signTypedData(domain, CLAIM_AUTHORISATION_TYPES as never, value);
}
