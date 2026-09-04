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
