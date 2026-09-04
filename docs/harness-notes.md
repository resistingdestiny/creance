# Harness notes

Every place where Hedera documentation and Hedera behaviour disagreed, with the
page, the date it was read and what testnet actually did. Each entry was
reproduced on testnet before it was written down. This file is the raw material
for the Hedera Harness contribution, so it is a deliverable, not a diary.

## T03, Hedera resources, 4 September 2026

### A default freeze does not compose with automatic token association

Two documented mechanisms, described separately and never together:

- The token properties page says `freezeDefault` true means "an account must be
  unfrozen before it can receive the token".
  https://docs.hedera.com/hedera/sdks-and-apis/sdks/token-service/define-a-token
- The account properties page says `maxAutomaticTokenAssociations = -1` means
  unlimited automatic association, and that "when tokens are sent to an account
  with available auto-association slots, one slot is consumed and the account
  becomes associated automatically".
  https://docs.hedera.com/hedera/core-concepts/accounts/account-properties

Neither page says what happens when both apply. Measured on testnet with a
throwaway collection, token 0.0.10366466, and a fresh account created with
`setMaxAutomaticTokenAssociations(-1)`, account 0.0.10366465:

    TransferTransaction().addNftTransfer(0.0.10366466, 1, operator, 0.0.10366465)
    -> ACCOUNT_FROZEN_FOR_TOKEN

So they do not compose. The automatic association happens, and the account then
arrives frozen, so the transfer in the same transaction fails. An account with
unlimited auto-association slots cannot receive the first serial of a collection
whose default freeze status is frozen.

Consequence for this build: the policy NFT collection 0.0.10366468 is created
without `freezeDefault`, and non-transferability is enforced by freezing the
holder after the transfer. Each bind is associate, transfer, freeze. A second
policy for the same holder needs an unfreeze first, because freeze is per
account per token and not per serial.

### The NFT metadata cap counts bytes, not characters

The mint page says "The metadata field has a 100-character limit".
https://docs.hedera.com/hedera/sdks-and-apis/sdks/token-service/mint-a-token

The Solidity helper library comment says "Maximum allowed size of each metadata
is 100 bytes". The two differ for anything that is not ASCII. Measured on the
same throwaway collection:

- 100 ASCII characters, 100 bytes: minted.
- 60 characters of two-byte UTF-8, 120 bytes: `METADATA_TOO_LONG`.

The limit is bytes. Sixty characters is well inside a hundred, so the character
reading is wrong. Policy NFT metadata stays ASCII and under 100 bytes.

### The mirror node answers 404 for a missing topic but 200 for its messages

Both endpoints are on the same resource and disagree about what absence looks
like. Checked on 4 September 2026 against
https://testnet.mirrornode.hedera.com/api/v1

    GET /topics/0.0.999999999            404 {"_status":{"messages":[{"detail":"Topic not found", ...
    GET /topics/0.0.999999999/messages   200 {"messages":[],"links":{"next":null}}

So "did my message land" cannot be answered by an HTTP status on the messages
endpoint, and an empty array does not distinguish a wrong topic id from a
message that has not been mirrored yet. Existence checks in the setup script go
through `/topics/{id}`; message reads take the sequence number from the receipt
and poll by sequence number.

`/accounts/{id}` and `/tokens/{id}` do both return 404 for a missing entity, so
the topics messages endpoint is the odd one out.

### setKeyWithAlias means different things in the JavaScript and Java SDKs

The account creation page shows Java calling `setKeyWithAlias(key)` with one
argument to set an ECDSA key and derive the EVM address from it.
https://docs.hedera.com/hedera/sdks-and-apis/sdks/accounts-and-hbar/create-an-account

In `@hiero-ledger/sdk` 2.87.0, `AccountCreateTransaction.prototype.setKeyWithAlias`
has arity 2: it takes a key and a separate ECDSA key for the alias. The
single-argument JavaScript equivalent is `setECDSAKeyWithAlias(publicKey)`,
which is what the setup script uses. Copying the Java line into TypeScript
compiles and then sets an alias nobody expected.

### TokenId.toEvmAddress returns the address without the 0x prefix

`TokenId.fromString('0.0.10366463').toEvmAddress()` returns
`00000000000000000000000000000000009e2dff`, forty hex characters and no prefix.
Every ethers and viem call wants the prefix, so it has to be prepended. Nothing
on the address page says the SDK omits it.
https://docs.hedera.com/hedera/core-concepts/smart-contracts/deploying-smart-contracts/json-rpc-relay

### A repeated association fails rather than being a no-op

Confirmed on testnet: associating account 0.0.10366451 with token 0.0.10366463 a
second time throws `TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT`. It is benign, but it
is a thrown error and not a success receipt, so any onboarding path that can run
twice has to catch it by status. The setup script does.

### The Hiero SDK pulls a blocked postinstall script under pnpm 11

`@hiero-ledger/sdk` 2.87.0 depends on `protobufjs` 7.6.6, whose postinstall
script pnpm 11 refuses to run without an explicit allowance, and the install
ends with `ERR_PNPM_IGNORED_BUILDS`. The SDK imports and runs correctly with
that script skipped, so `pnpm-workspace.yaml` records `protobufjs: false`
rather than allowing it. Nothing in the SDK documentation mentions the
postinstall step or that it is optional.

### Long-zero and key-derived addresses, confirmed rather than assumed

Every account created here was read back from the mirror node and checked
against the address derived from its public key. All nine came back with a
key-derived EVM address and `max_automatic_token_associations = -1`, so none of
them is long-zero and all of them can pass an ECRECOVER check. This is the
property CoverPool depends on for the CLAIMS authorisation in T04, and it is
cheap to assert at creation and expensive to discover later.

## T04, contracts on the Hedera EVM, 4 September 2026

### The documented HashScan verification server is now a redirect that drops the path

The verification tutorial names `https://server-verify.hashscan.io` as the
Sourcify style server for Hedera, and the same page says manual HashScan
verification is temporarily disabled.
https://docs.hedera.com/hedera/tutorials/smart-contracts/how-to-verify-a-smart-contract-on-hashscan

Checked on 4 September 2026:

    GET https://server-verify.hashscan.io/v2/contract/296/0x2D0F...1348
    -> 308 Permanent Redirect
    following it lands on https://sourcify.dev/server, path discarded
    -> 404 Cannot GET /

So the host still resolves, but any client configured with it as an `apiUrl`
loses its path on the redirect and gets a 404 that looks like "contract not
found" rather than "wrong server". The working route is the public Sourcify
server with no custom `apiUrl` at all, which is what
`@nomicfoundation/hardhat-verify` 3.1.0 uses by default:

    verify: { sourcify: { enabled: true } }

Both contracts verified that way and Sourcify reports `exact_match` for each:

    GET https://sourcify.dev/server/v2/contract/296/0x96E0c26864fbAFCa58655944b7F862f12eD1333D
    -> {"runtimeMatch":"exact_match", ...}

Consequence for this build: nothing points at `server-verify.hashscan.io`. Do
not add it back as an `apiUrl` because a doc page names it.

### hardhat-verify needs a second attempt for a contract with imports, and says so

The first Sourcify submission for CoverPool used the minimal compiler input and
failed; the plugin retried by itself with the full solc input and got an exact
match. The docs describe manual multi file upload as "extremely difficult and
error prone" for a contract with dependencies but do not mention that the plugin
handles it in two passes and warns that "unrelated contracts may be displayed on
Sourcify as a result". Worth knowing before you read the first failure line as a
real failure. CollateralVault, which has the same OpenZeppelin imports, matched
on the first pass.

### A contract associates itself with an HTS token through the HIP-719 facade, and isAssociated reads back true

The system contract page documents `associate()` and the argument free
`isAssociated()` on the token address, from consensus node 0.38 and 0.53.
https://docs.hedera.com/hedera/core-concepts/smart-contracts/hedera-token-service-hts-system-contract

Both work from inside a contract and are caller scoped, which is the whole
story: CollateralVault can opt itself in and can read back its own state, and no
contract can ask whether some other account is associated. Measured on testnet:

    CollateralVault.associateSettlementToken()  -> success, 735,563 gas
    CollateralVault.isSettlementTokenAssociated() -> true

735,563 gas for one association is worth budgeting for. It is by a wide margin
the most expensive call either contract makes, five times the cost of moving the
token itself.

### The ERC-20 facade is not orders of magnitude more expensive than storage

The gas page explains that a call into the token service from Solidity is priced
by converting a USD cost to gas and adding a twenty percent surcharge, which
reads as a warning that any HTS touching call will dwarf ordinary storage.
Measured against TUSD (0.0.10366463) through its ERC-20 facade, with everything
else in the call being storage writes:

    subscribe  (transferFrom into the vault)   141,378 gas
    payClaim   (transfer out of the vault)     172,701 gas
    bind       (no token call at all)          224,668 gas
    submitObservation, opening month           270,878 gas

A bind, which touches no token, costs more than either transfer. The surcharge
is real but at this scale it is not the dominant term, and `associate` is the
outlier rather than the rule. Explicit gas limits are still the right call
because `eth_estimateGas` cannot see the state dependent part; the numbers this
build uses are in docs/HEDERA.md.

### ECRECOVER accepts an EIP-712 signature from a key derived Hedera account

The address page warns that a long-zero account "cannot pass ECRECOVER-based
signature checks", which leaves open whether a normal Hedera account can.
https://docs.hedera.com/hedera/core-concepts/accounts/account-properties

Confirmed on testnet: the api account 0.0.10366450, created with an ECDSA key
and the matching key derived EVM address
`0x7c02879d6b95f923681f517b0487aa45af2b8fdf`, signed a `ClaimAuthorisation`
with `signTypedData` against domain
`{ name: "DisplacementBond", version: "1", chainId: 296, verifyingContract: <CoverPool> }`,
and `ECDSA.tryRecover` inside CoverPool recovered exactly that address. The
payout went through in
https://hashscan.io/testnet/transaction/0x3185d7d188a332ddb585238b1282ec2cf4706f81be914526aade4b9cb106dcbd

So the qualifier is on the account's key type, not on Hedera. Every account this
build signs with is ECDSA with a key derived address, and the deploy script
refuses to grant a role to a long-zero address for the same reason.

### Solidity 0.8.24 cannot compile the claim digest without the IR pipeline

Not a Hedera fact, but it costs a compile cycle to discover. Hashing the
EIP-712 struct is one `abi.encode` of a type hash plus nine fields, and the
legacy code generator runs out of stack on it:

    CompilerError: Stack too deep ... try viaIR

`viaIR: true` with the optimizer on compiles it and verifies as an exact match.
The setting has to be identical between the deploy and the verify, so it is
pinned in `contracts/hardhat.config.ts` and written into docs/HEDERA.md.

### Hardhat 3 deprecates network.connect(), which is what the Hedera docs use

The Hedera Hardhat page's examples call `hre.network.connect()`.
https://docs.hedera.com/hedera/tutorials/smart-contracts/deploy-a-smart-contract-using-hardhat

Hardhat 3.15.0 runs it and then prints:

    WARNING: hre.network.connect() is deprecated and will be removed in a
    future version. Use hre.network.create() or hre.network.getOrCreate()
    instead.

The suites in this repository use `network.getOrCreate()`. Following the Hedera
page verbatim works today and will stop working.

### A mirror node timeout reaches the caller as a JSON-RPC error on eth_getBlockByNumber

The relay troubleshooting page says to look a failed transaction up on the
mirror node because the consensus level result is more specific than what the
relay returns. The reverse case is not described: when the mirror node behind
the relay is slow, an ordinary read fails with a code that reads like a client
bug. Hit once on 4 September 2026, midway through a run against Hashio:

    eth_getBlockByNumber ["latest", false]
    -> code -32020, "Mirror node upstream failure: statusCode=504,
       message=timeout of 30000ms exceeded"

ethers wraps it as `UNKNOWN_ERROR ... could not coalesce error`, which says
nothing about the cause. The same command succeeded unchanged a minute later.
Treat -32020 as a retry, the same as `THROTTLED_AT_CONSENSUS`, and do not go
looking at your own code first.
## T10, web app, 4 September 2026

This section is not Hedera. It is here because the same rule applies: where a
written expectation and the runtime disagree, the runtime wins and the
disagreement gets written down. Nothing in this section belongs in the Hedera
Harness contribution.

### en-GB abbreviates September to four letters, not three

The web app formats every date with a hard-coded `en-GB` locale so that a
judge's machine cannot reorder a date. The chart axis label uses
`Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric' })`. Every
month abbreviates to three letters except September:

    2025-01 -> "Jan 2025"
    2024-09 -> "Sept 2024"

That is CLDR's abbreviated form for British English, and the MDN reference for
`month: "short"` describes it only as "the abbreviated name of the month" with
no width guarantee
(https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat/DateTimeFormat,
read 2026-09-04). Measured on Node v22.23.1 with full ICU.

Consequence: the axis label is accepted at its natural width. Slicing it to
three characters would produce "Sep", which is the American form, in an app
whose whole copy deck is British English. The chart lays out two labels at the
ends of the plot, so four characters cost nothing.
