# The note series in the Asset Tokenization Studio

The Displacement Bond Note for series `ODI-COMP-2026-01` is an Asset
Tokenization Studio bond, deployed by the ATS testnet factory on Hedera testnet
on 4 September 2026. This file is the run through: what was sent, what came
back, and what each step proves. `pnpm ats:issue` reproduces all of it.

## The note

| Field | Value |
|---|---|
| Series | ODI-COMP-2026-01 |
| Name | Creance Displacement Bond Note ODI-COMP-2026-01 |
| Symbol | CDBN01 |
| Contract id | [0.0.10368240](https://hashscan.io/testnet/contract/0.0.10368240) |
| EVM address | `0xBB14C072d2861B944C18e5f873C5aEa71c2F1f36` |
| Deploy transaction | [0x226d62fd...49ad398](https://hashscan.io/testnet/transaction/0x226d62fd0b562535baf1c027c8bd320df2b017326c56921328b6af27849ad398) |
| ATS release | 8.0.0, repository tag `v.8.0.0-ats` |
| Factory | [0.0.9213391](https://hashscan.io/testnet/contract/0.0.9213391) `0xd1f118a40f3b02883d35909ef2517e7edd78379d` |
| Resolver | [0.0.9212226](https://hashscan.io/testnet/contract/0.0.9212226) `0xba2d5fc2083a0b8f164c50e65d782087fba18e0a` |
| Configuration id | `0x00...02` (bond) |
| Configuration version | 1, read off the resolver with `getLatestVersionByConfiguration` |
| ISIN | `ZZODIC55S1Q6`, a test value, see below |
| Decimals | 6 |
| Units | 100 |
| Nominal value | 1,000 USD per unit, held as `1000000000` at 6 decimals |
| Principal | 100,000 USD |
| Currency | `0x555344`, the three bytes of USD |
| Supply cap | `100000000`, which is 100 units at 6 decimals |
| Maturity | 1820082162, 4 September 2027, the same value the vault froze for the series |
| Regulation | Regulation S |
| Internal KYC | on, and it cannot be turned off |
| Clearing | off |
| Controllable | off |

The note is a **contract, not an HTS token**. It has a contract id and an EVM
address and no token id, its HashScan links are `/contract/`, and nobody
associates with it. Do not write "associate" in any investor copy for the note.

## Reproducing it

    pnpm install
    pnpm ats:issue status      # what the resolver reports and what is recorded
    pnpm ats:issue             # every step below, in order

The script is record driven. Every step reads
`contracts/deployments/testnet.json`, skips what is already there and writes
back what it did, so a relay timeout half way through is recovered by running
the same command again. Individual steps run on their own:
`pnpm ats:issue kyc2`, `pnpm ats:issue controls`, and so on. The full step list
is in `contracts/ats/issue.ts`.

## The path: the contracts, not the SDK

The issuance is an `ethers` call to `IFactory.deployBond` on the ATS testnet
factory, with the ABIs taken from `@hashgraph/asset-tokenization-contracts@8.0.0`,
the package the ATS SDK itself depends on. Everything after it is a call to the
bond proxy through the `IAsset` ABI from the same package.

It is not the ATS SDK, because the SDK cannot be driven from a shell:
`SupportedWallets` at 8.0.0 is `METAMASK`, `HWALLETCONNECT`, `DFNS`,
`FIREBLOCKS` and `AWSKMS`. The Metamask adapter calls
`detectEthereumProvider()` and reads `globalThis.window.ethereum`; the
WalletConnect adapter needs a Reown project id and a wallet application to
approve each transaction; the other three are third party custody services. See
docs/DECISIONS.md for the reasoning and docs/harness-notes.md for the evidence.

Everything the SDK would have sent, this build sends: the same factory, the
same resolver, the same bond configuration, the same request fields, the same
single partition, and the same credential library.

## The run through

Every transaction below is on Hedera testnet, paid for by the operator
0.0.10362512 unless the row says otherwise. HashScan deep links answer HTTP 404
to `curl` and open normally in a browser, see docs/harness-notes.md.

### 1. The throwaway deployment

Before the real series, one bond with junk values, to prove the factory and
resolver pair and to test one thing that could not be tested any other way.

| Field | Value |
|---|---|
| Contract | [0.0.10368234](https://hashscan.io/testnet/contract/0.0.10368234) `0x3D49836c6d26Bdb7922694747455d063E9FDd823` |
| Transaction | [0x0648e030...cc084a64](https://hashscan.io/testnet/transaction/0x0648e03012c7ae5060411c15cccf622b402d15261887b4efb9efc774cc084a64) |
| Gas used | 6,939,363 of a 15,000,000 limit |
| Fee | 7.6332993 HBAR |
| ISIN | `ZZT06TRK6CM7` |
| Supply cap | `100`, deliberately the unscaled unit count |

**What it proves.** The factory and resolver pair from the 8.0.0 web
application's example environment file deploys a working 8.0.0 bond, at
configuration version 1. The deployed-addresses page in the same repository
lists a different, older pair; it was not needed and was not used.

Then, on that throwaway, `issueByPartition` of one whole unit:

    issueByPartition({ partition: 0x00..01, tokenHolder: <operator>, value: 1000000, data: 0x })
    -> reverted MaxSupplyReached(100)

[The failed transaction](https://hashscan.io/testnet/transaction/0xcf45fe36f004efcc9c5dd71f734a8a7b77b6343f949c7c3d9497d11b52f90fef).

**What it proves.** The supply cap is a raw balance in the note's own decimals,
not a count of units. A hundred units of a six decimal note is a cap of
`100000000`, and a cap of `100` refuses the very first whole unit. The real
series was deployed with the scaled value. See docs/harness-notes.md, which
records that the SDK sends the unscaled number.

### 2. Issuance

    deployBond(
      security: {
        resolver: 0xba2d5fc2083a0b8f164c50e65d782087fba18e0a,
        maxSupply: 100000000,
        resolverProxyConfiguration: { key: 0x00..02, version: 1 },
        erc20MetadataInfo: {
          name: "Creance Displacement Bond Note ODI-COMP-2026-01",
          symbol: "CDBN01", isin: "ZZODIC55S1Q6", decimals: 6 },
        rbacs: [{ role: DEFAULT_ADMIN_ROLE, members: [<operator>] }],
        externalPauses: [], externalControlLists: [], externalKycLists: [],
        compliance: 0x0, identityRegistry: 0x0,
        arePartitionsProtected: false, isMultiPartition: false,
        isControllable: false, isWhiteList: false, clearingActive: false,
        internalKycActivated: true, erc20VotesActivated: false },
      bondDetails: {
        currency: 0x555344, nominalValue: 1000000000, nominalValueDecimals: 6,
        startingDate: 1788552681, maturityDate: 1820082162 },
      proceedRecipients: [], proceedRecipientsData: [],
      regulation: { regulationType: 1 (Regulation S), regulationSubType: 0,
        countriesControlListType: false, listOfCountries: "",
        info: "Creance Displacement Bond Note, series ODI-COMP-2026-01" })

[Transaction](https://hashscan.io/testnet/transaction/0x226d62fd0b562535baf1c027c8bd320df2b017326c56921328b6af27849ad398),
gas used 7,005,006, fee 7.7055066 HBAR. The `BondDeployed` event carries the
proxy address `0xBB14C072d2861B944C18e5f873C5aEa71c2F1f36`, which the mirror
node resolves to contract id 0.0.10368240.

**What it proves.** The series exists as an instrument with the terms
DESIGN.md 3.4 sets: principal 100,000 as 100 units of 1,000, a twelve month
maturity that matches the vault's, and the compliance switches DESIGN.md 3.8
asks for.

### 3. Roles

One `grantRole` per role, all to the operator, all under `DEFAULT_ADMIN_ROLE`
which the factory set at creation. The role hashes are the 8.0.0 values from
`atsRoles.generated.ts`; they changed in this release and an older constant
names a role that no longer exists.

| Role | Hash | Transaction |
|---|---|---|
| ROLE_SSI_MANAGER | `0x3120494a82251fe85b0403877539486dbfcf0f94c20741a3229cfad31f625ee1` | [0xad70c0da...a8e3cfee](https://hashscan.io/testnet/transaction/0xad70c0dadfad9d50c9f2a1a98aee3f920bcce6a8bb237baaceafc69ca8e3cfee) |
| ROLE_KYC | `0x754f499f9fdfbb089d12bdec817a6863d593d8a3ea7f546c00a5cafd20957bfc` | [0xbc18bea4...5c3cc06a](https://hashscan.io/testnet/transaction/0xbc18bea44c54733d43032050742ea766b2f4ee0fbccc3f40c538933b5c3cc06a) |
| ROLE_ISSUER | `0x5eeaf5602c75bf26e73b5206d0bd6ee82f621166255e5fd73cc06bc7bd84a95f` | [0xa53b6227...067cfe9a](https://hashscan.io/testnet/transaction/0xa53b622762f994432f0d9dd93a2c92c3d4e5dd77670b8d604c7ab180067cfe9a) |
| ROLE_CORPORATE_ACTION | `0xa1acfc499025c99f55059195e6276f639d34a18aad7b8121b9192b7f438c55cd` | [0x89b15399...b1a95a22](https://hashscan.io/testnet/transaction/0x89b15399594efca317b379d0a3e2962a6cc22006e076ede4887959d2b1a95a22) |
| ROLE_PAUSER | `0x3cb8b459fdb6e7dc3d2a2aa529e530f885d45e03584adb438423209c86a2731f` | [0xbe4e8a52...0025bac1](https://hashscan.io/testnet/transaction/0xbe4e8a52cdd90d452582a2314005d317169d0d37b3d74c61566f10640025bac1) |
| ROLE_FREEZE_MANAGER | `0x71ae38482e1ab1c28e767d64766d686215b490c8c1bd7dfe6b101525187c2155` | [0x486f13c2...9884da49](https://hashscan.io/testnet/transaction/0x486f13c2a6e4fb6226613ee6f45128c0f7b87ac6fd04b0c57fd772cc9884da49) |
| ROLE_MATURITY_REDEEMER | `0x433f48f8aca23480f6ab07666cbc9131d32a0b4672033453f65e18f4dd390523` | [0xe72bc61c...cddf9e52](https://hashscan.io/testnet/transaction/0xe72bc61cdbcb71e76ba91b76d1dbf32e8754d6370d7df76937fd75f1cddf9e52) |
| ROLE_MATURITY_MANAGER | `0xc20b7fd7efe1a2c9f69003a21c2c55c79ef84e16252b62599246ff01f6207314` | [0x39ab7a21...30a9a874](https://hashscan.io/testnet/transaction/0x39ab7a21180b67c4f47ace2156446c05c04438f4aa3015e94a7bfc3330a9a874) |

Each grant used 179,937 gas. `hasRole` reads true for all eight afterwards; the
script asserts that before it moves on.

**What it proves.** The pause and freeze roles DESIGN.md 3.8 asks for exist and
are held. ROLE_SSI_MANAGER and ROLE_KYC are the two the KYC grant needs, in
that order.

### 4. The credential issuer

    addIssuer(0x639444758B987b4D938c57169a1F61A62b2d009C)

[Transaction](https://hashscan.io/testnet/transaction/0x7a1a32e3178bea2e894552cd3822e1006933abe6e83c4a9098265bd052f89230),
gas used 126,977. `isIssuer(<operator>)` reads true afterwards.

**What it proves.** Internal KYC is not a list of addresses. It is a per
account record naming a credential and the issuer that signed it, and the
issuer has to be registered on the security before any grant. Removing an
issuer revokes every grant it made, retroactively and with no event, so this
registration stands for the life of the series.

### 5. KYC for the first noteholder

The credential is an `EcdsaSecp256k1Signature2019` verifiable credential signed
by the operator key with `createEcdsaCredential` from `@terminal3/ecdsa_vc`,
the library the ATS SDK verifies with. The signature is checked off chain
before the call: the contract stores the credential id as an opaque string and
never looks at the proof.

    credential id  urn:uuid:92801b75-ca3c-4617-a044-9533154baffe
    issuer         did:ethr:hedera:0x639444758B987b4D938c57169a1F61A62b2d009C
    subject        did:ethr:0xb6c2ff466e3c73f1a49a3f1b936f8e3837112931
    grantKyc(0xb6c2ff466e3c73f1a49a3f1b936f8e3837112931,
             "urn:uuid:92801b75-ca3c-4617-a044-9533154baffe",
             1788552752, 4942152752,
             0x639444758B987b4D938c57169a1F61A62b2d009C)

[Transaction](https://hashscan.io/testnet/transaction/0x44e5f93d56d72350baf85cea6bd5a6dc1dbe0054f9f87a598e592eb7c4ebf5b5),
gas used 273,905. `getKycStatusFor(0xb6c2ff...12931)` reads `1`, GRANTED.

**What it proves.** The internal KYC path works, and it works without a browser
and without reaching a DID registry. The validity window is the credential's
own, as Unix seconds; the `4942152752` upper bound is the SDK's hundred year
default for a credential with no `validUntil`, reproduced here so the on chain
record matches what the SDK would have written.

### 6. Mint to the first noteholder

    issueByPartition({ partition: 0x00..01, tokenHolder: <investor-1>,
                       value: 60000000, data: 0x })

[Transaction](https://hashscan.io/testnet/transaction/0xc58192c2df8c6160828eacb1e9951b3291a63eb426e78870421b3b9fef96b98d),
gas used 475,349. `balanceOf(investor-1)` goes from `0` to `60000000`, which is
60 units.

### 7. The blocked transfer

investor-1 signs a transfer of 10 units to investor-2, which holds no KYC.

    transferByPartition(0x00..01, { to: 0xcaa1184cd59b9296f757efc7303a10ecec6ce51e,
                                    value: 10000000 }, 0x)
    -> reverted InvalidKycStatus

[The failed transaction](https://hashscan.io/testnet/transaction/0x0791d049fa5ab514f4af143a5f652973df0f6a22f0a288d7dd39334529970cf1).
`getKycStatusFor(0xcaa118...ce51e)` read `0`, NOT_GRANTED, at the time.

**What it proves.** Compliance is enforced at transfer by the note itself, not
by anything of ours. The mechanism that blocked it is internal KYC: no control
list, no external KYC list and no external compliance module is registered on
this note.

### 8. KYC for the second noteholder, then the same transfer

    credential id  urn:uuid:f2323f3c-423d-44e2-b006-55fb7816f13c
    grantKyc(0xcaa1184cd59b9296f757efc7303a10ecec6ce51e, ..., 1788552788, 4942152788, <operator>)

[Grant](https://hashscan.io/testnet/transaction/0xecdc481155d644bfb8a1254b39d040f0751cfc3e06456bbef878c88322024f9a),
gas used 256,805, `getKycStatusFor` then reads `1`.

The same call as step 7, same parties, same amount, same partition:

[Transaction](https://hashscan.io/testnet/transaction/0xce6d12fcf5def0015a0cc15806a3a315e4f0d3dddfb108b50798ebe3b93d911c),
gas used 473,562. `balanceOf(investor-2)` goes from `0` to `10000000`.

**What it proves.** The only thing that changed between the failure and the
success is the KYC record. That pair of transactions, side by side, is the
compliance demonstration.

### 9. Mint to the second noteholder

    issueByPartition({ partition: 0x00..01, tokenHolder: <investor-2>,
                       value: 40000000, data: 0x })

[Transaction](https://hashscan.io/testnet/transaction/0x9bee9bdcaf06955764bb38928e72c2596688591608f680de0da1ca66fcd113bd),
gas used 214,419. `balanceOf(investor-2)` goes from `10000000` to `50000000`.

Total supply is now `100000000`, exactly the cap: 100 units, 50 each, 50,000 of
principal each.

### 10. Pause

| Step | Transaction | Result |
|---|---|---|
| `pause()` | [0xbeb15e8a...d72a86db](https://hashscan.io/testnet/transaction/0xbeb15e8acfeac4008d0116d3c85a1032d3f5452773056a90b32f3cf1d72a86db) | `paused()` reads true, 79,287 gas |
| transfer of one unit between two granted holders | [0xd6e1aa8e...7315370a](https://hashscan.io/testnet/transaction/0xd6e1aa8e3839f9afab72295f34ba2769663c48aef0800f08565fd7877315370a) | reverted `IsPaused` |
| `unpause()` | [0x30a3eecd...fada7f3b](https://hashscan.io/testnet/transaction/0x30a3eecd2db8868242106f589536d4783000527712490904ffae7a84fada7f3b) | `paused()` reads false, 55,060 gas |

**What it proves.** `ROLE_PAUSER` stops every transfer, including one that would
otherwise pass every compliance check.

### 11. Freeze

| Step | Transaction | Result |
|---|---|---|
| `freezePartialTokens(investor-2, 45000000)` | [0xeecbf14f...653fe7891](https://hashscan.io/testnet/transaction/0xeecbf14f96b9923b452966dc7fa31a34c890d8dea1f928fa9692922653fe7891) | `getFrozenTokens` reads `45000000`, `balanceOf` drops from `50000000` to `5000000`, 162,283 gas |
| investor-2 transfers `6000000`, one unit more than is left unfrozen | [0x04fbd62b...b7706539](https://hashscan.io/testnet/transaction/0x04fbd62b599b3b0871ca85dacef17fb59df286400feb37496f25aa36b7706539) | reverted `InsufficientBalance(0xCAa1184cd59B9296f757EfC7303a10eCec6ce51e, 5000000, 6000000, 0x00..01)` |
| `unfreezePartialTokens(investor-2, 45000000)` | [0x0edc8a9a...59a6b9f4](https://hashscan.io/testnet/transaction/0x0edc8a9a1ad5459e7603a17e4efddd6cc3a4f1ea149c0c37eb95c1ac59a6b9f4) | `getFrozenTokens` reads `0`, `balanceOf` back to `50000000`, 123,218 gas |

**What it proves.** `ROLE_FREEZE_MANAGER` can immobilise part of a holding
without touching the rest, which is the closest ATS analogue to the vault's
reserve. It also shows a thing worth knowing before any screen reports a
balance: a freeze **leaves the partition balance**, so while tokens are frozen
`balanceOf` reports only what is spendable and the holder's real position is
`balanceOf` plus `getFrozenTokens`. See docs/harness-notes.md.

### 12. The first coupon

    setCoupon({ recordDate: 1788553283, executionDate: 1788553583,
                startDate: 1788552983, endDate: 1791144983,
                fixingDate: 1788553283,
                rate: 8, rateDecimals: 2, rateStatus: 1 (SET) })
    -> coupon id 1

[Transaction](https://hashscan.io/testnet/transaction/0xcf162de307a74ecb440c357d80dc8ea34cc0ac33c49a8cd7b5c8669925dbe804),
gas used 628,757.

Eight percent a year is `rate` 8 at `rateDecimals` 2. The accrual window is a
real calendar month, 4 September to 4 October 2026, because ATS prices a coupon
as balance times nominal times rate times the window in seconds over 365 days.
The record and execution dates are five and ten minutes out rather than at the
end of the accrual window, so the settlement half can be shown inside the
event; a live series would put the record date at the end of the month it pays
for. That is a deliberate demo choice and it is recorded in docs/DECISIONS.md.

**The coupon action never moves money.** There is no settlement token anywhere
in the coupon facet. It declares the rate and the window, snapshots the holders
at the record date, and exposes each holder's entitlement as an exact fraction.
Paying it is a Scheduled Transaction from the vault's premium account, which is
T14.

## The test ISIN

`ZZODIC55S1Q6` is a **structurally valid test identifier, not a registered
one**. The ATS factory validates the ISIN on chain: exactly twelve characters,
with the last one the ISO 6166 mod 10 check digit, or the deployment reverts
`WrongISIN` or `WrongISINChecksum`. There is no registered ISIN for a demo
instrument, so the value is generated: `ZZ`, which is user assigned in ISO 3166
and can therefore never be issued by a national numbering agency, then the four
leading alphanumerics of the series label, then five characters of the base36
SHA-256 of the same label, then the check digit. The rule is in
`contracts/ats/isin.ts` and its tests check the algorithm against published
ISINs. Do not put this value on screen as though it were real.

## What "verified on HashScan" means for this note

Checked, rather than assumed, on 4 September 2026.

The note is a proxy the ATS factory deployed. Its bytecode is ATS's
`ResolverProxy`, and every call it answers is dispatched by the Business Logic
Resolver 0.0.9212226 to facet contracts the ATS team deployed. This build
compiled none of that and deployed none of it, so there is no source of ours to
submit for it.

Sourcify, which is where HashScan reads verification from on chain 296, has no
match for the note `0xBB14C072d2861B944C18e5f873C5aEa71c2F1f36`, none for the
throwaway, none for the ATS factory `0xd1f118a4...78379d` and none for the
resolver `0xba2d5fc2...a18e0a`. The ATS deployment is unverified upstream, and
verifying somebody else's proxy would prove nothing about the facets that
actually run.

What is verified is the part this build wrote: `CollateralVault` and `CoverPool`
are both exact matches on Sourcify, and docs/HEDERA.md links them. The honest
sentence for docs/PRIZES.md is that our contracts are verified, and that the
note is an unmodified ATS deployment whose source is public at tag
`v.8.0.0-ats` and whose configuration is recorded here field by field.

## What was ATS and what was ours

| Concern | Owner | Mechanism |
|---|---|---|
| Note identity, supply, transfer | ATS bond proxy | ERC-1400 partitions with ERC-3643 style compliance |
| Investor eligibility | ATS | internal KYC plus the SSI issuer registry |
| Transfer restriction, pause, freeze | ATS | `ROLE_PAUSER`, `ROLE_FREEZE_MANAGER`, control lists |
| Coupon declaration, record date, per holder entitlement | ATS | `setCoupon`, the snapshot, `getCouponFor` |
| Coupon payment | ours | a Scheduled Transaction of the settlement token from the premium account |
| Principal held, reserved on an open month, released at window close | ours | CollateralVault and CoverPool |
| Principal reduction after a paid claim | ours | CollateralVault |
| Burning the note at maturity | ATS | `fullRedeemAtMaturity` under `ROLE_MATURITY_REDEEMER` |
| Returning remaining principal at maturity | ours | CollateralVault |

## Cost

Measured, not quoted. The ATS documentation puts a bond deployment at 50 to 200
HBAR; on testnet on 4 September 2026 it cost under eight.

| Transaction | Gas used | Fee, HBAR |
|---|---|---|
| `deployBond`, throwaway | 6,939,363 | 7.6332993 |
| `deployBond`, the series | 7,005,006 | 7.7055066 |
| `grantRole`, each of eight | 179,937 | |
| `addIssuer` | 126,977 | |
| `grantKyc` | 273,905 and 256,805 | |
| `issueByPartition` | 475,349 and 214,419 | |
| `transferByPartition` | 473,562 | |
| `pause` / `unpause` | 79,287 / 55,060 | |
| `freezePartialTokens` / `unfreezePartialTokens` | 162,283 / 123,218 | |
| `setCoupon` | 628,757 | |

Every call is sent with an explicit gas limit, for the reason
`contracts/scripts/deploy` gives: the relay's `eth_estimateGas` cannot price a
call whose cost depends on state it cannot see. The limits are in
`contracts/ats/config.ts`.

## Handed to T14

- Coupon id `1` on the note, snapshot and per holder entitlement read with
  `pnpm ats:issue couponcheck` once the record date has passed.
- The entitlement arrives as `numerator / denominator` in whole currency units;
  the settlement amount is `floor(numerator * 10^6 / denominator)` in TUSD minor
  units.
- `fullRedeemAtMaturity` needs the holder to still hold KYC at the moment it is
  called, and `updateMaturityDate` only moves the date forward, so a maturity
  demonstration inside the event needs a second, short dated series.
