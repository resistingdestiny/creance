# Starters

Everything taken from outside this project, with the link and what was taken.
Nothing here is code from another project of ours; this build started from an
empty repository.

## OpenZeppelin Contracts 5.6.1

https://github.com/OpenZeppelin/openzeppelin-contracts

A dependency, not copied source. `CoverPool` and `CollateralVault` inherit
`AccessControl`, `Pausable`, `ReentrancyGuard` and `EIP712`, and use
`SafeERC20` and `ECDSA`. MIT licensed.

## The civil calendar conversions in contracts/contracts/MonthLib.sol

https://howardhinnant.github.io/date_algorithms.html

`monthIndexOf` and `startOfMonth` implement the published days-from-civil and
civil-from-days algorithms, which are the standard branch free, loop free way to
convert between a unix day count and a calendar date. The algorithms are taken
from that page and written in Solidity here; no source was copied. The page
places them in the public domain.

## Hedera Asset Tokenization Studio 8.0.0

https://github.com/hashgraph/asset-tokenization-studio, release tag
`v.8.0.0-ats`

The Displacement Bond Note is an ATS bond. Nothing was copied: the note is
deployed by the ATS testnet factory 0.0.9213391 against the ATS resolver
0.0.9212226, and `@hashgraph/asset-tokenization-contracts@8.0.0` is a
dependency, used for the `IFactory`, `IAsset` and `BusinessLogicResolver` ABIs
and for nothing else. Apache-2.0.

Two things were read from the repository at that tag and written out again in
this build's own words and code, because there was no other way to get them
right: the required order of `ROLE_SSI_MANAGER`, `addIssuer`, `ROLE_KYC` and
`grantKyc`, and the shape of the verifiable credential a grant records, whose
recipe is in the SDK's test helper
`packages/ats/sdk/__tests__/utils/verifiableCredentials.ts`. The role hashes in
`contracts/ats/config.ts` are the generated values from
`packages/ats/contracts/scripts/domain/atsRoles.generated.ts`; they are
constants of the deployed contracts, not code.

## Terminal3 verifiable credential libraries

https://www.npmjs.com/package/@terminal3/ecdsa_vc

`@terminal3/ecdsa_vc`, `@terminal3/vc_core` and `@terminal3/verify_vc` are
dependencies. They are the libraries the ATS SDK itself verifies credentials
with, so a credential this build signs is one the SDK would accept.
`contracts/ats/credential.ts` calls `createEcdsaCredential` and `verifyVc`; no
source was copied.
