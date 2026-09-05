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

## The web app

Nothing. No starter kit, no scaffold and no sample code. `apps/web` was created
by hand from the framework's own documentation, and every component in
docs/DESIGN-TOKENS.md was built from the token sheet during the event.

## The Creance mark and its icon sizes

Not a starter and not code, listed so the disclosure is complete. Every file in
`apps/web/public` was drawn before kick-off: `favicon.ico`, `icon-16.png`,
`icon-32.png`, `icon-180.png`, `icon-192.png`, `icon-512.png` and
`creance-mon.svg`. They are the browser icon and the metadata icons and nothing
else: no screen renders them and no layout depends on them.

`apps/web/src/app/layout.tsx` points the icon metadata at `favicon.ico`,
`icon-16.png`, `icon-32.png` and `icon-180.png`. The other three are the
install sizes and the source mark, kept for the web manifest a later ticket
adds, and nothing in the build references them today.

## The x402 packages, version 2.25.0

https://github.com/x402-foundation/x402

`@x402/core`, `@x402/hedera`, `@x402/fastify` and `@x402/fetch` are
dependencies. No source was copied. The API registers `ExactHederaScheme` from
`@x402/hedera/exact/server` with `x402ResourceServer` and puts
`paymentMiddleware` from `@x402/fastify` in front of two routes; the payer in
`packages/client` registers the client half of the same scheme with
`wrapFetchWithPaymentFromConfig`. Apache-2.0.

The wiring in `apps/api/src/x402/gate.ts` follows the shape of the quick start
in the `@x402/fastify` README and of the client setup in the `@x402/hedera`
README, which are four and six lines respectively; everything around them,
including the per-quote gate on `POST /v1/bind`, the settlement records and the
payments topic message, is this build's.

## The World IDKit packages

https://github.com/worldcoin/idkit

`@worldcoin/idkit` 4.2.3 in `apps/web` and `@worldcoin/idkit-core` 4.2.4 in
`apps/api`, both pinned exactly rather than with a caret. Dependencies, not
copied source. MIT licensed.

What is used from them, and nothing else. In the API,
`signRequest` and `computeRpSignatureMessage` from
`@worldcoin/idkit-core/signing`, which produce and describe the `rp_context`
signature the World App checks, and `hashSignal` from
`@worldcoin/idkit-core/hashing`, which is the `hash_to_field` the signal
comparison needs. In the web app, `IDKitRequestWidget` and the preset builders
`selfieCheckLegacy`, `proofOfHuman`, `orbLegacy` and `deviceLegacy` from
`@worldcoin/idkit`. `apps/web/src/app/verify/world-check.tsx` is thirty lines of
our own around the widget; the state machine, the error mapping and every check
on the returned proof are this build's.

The test vectors in `apps/api/test/world-signing.test.ts` are copied, and this
is the entry for them: the four `hash_to_field` values, the two
`compute_rp_signature_message` messages, the two 65 byte `sign_request`
signatures and the signing key `0xabab...ab` they are computed with are all
published on https://docs.world.org/world-id/idkit/signatures. That key is a
documentation vector and is not any key of this deployment. The assertions
around them are ours, as is the trick the test needs to run at all, which is
stubbing `Date.now` and `crypto.getRandomValues` because the shipped
`signRequest` takes neither as a parameter.

## The World MiniKit package

https://github.com/worldcoin/minikit-js

`@worldcoin/minikit-js` 2.0.3 in `apps/web`, pinned exactly for the same reason
IDKit is. A dependency, not copied source. MIT licensed.

Two things are used from it and nothing else: `MiniKitProvider` from
`@worldcoin/minikit-js/minikit-provider`, which installs the SDK so the app is a
Mini App inside World App and IDKit uses the native transport, and the accessors
`MiniKit.isInWorldApp()` and `MiniKit.isInstalled()`, which answer which surface a
screen is on. No MiniKit command is called anywhere, so nothing in this build
touches World Chain.

`apps/web/src/app/providers.tsx` follows the four line provider snippet on
https://docs.world.org/mini-apps/quick-start/installing, which is the whole of
what was taken. The surface context around it, the reason the provider's own flag
is read as a trigger rather than an answer, and every copy branch are this
build's. `MiniKit.getMiniAppUrl` is deliberately not used; the entry links are
built in `apps/api/src/world/mini-app.ts` from the schema the quick actions page
publishes, because the helper and the schema disagree about encoding.

## Blocky402

https://blocky402.com/docs/testnet/

A service, not code. The testnet facilitator at
`https://api.testnet.blocky402.com` verifies and settles every payment this
build takes. No API key and no account: its own documentation says testnet is
open access. Its `GET /supported` is where the Hedera fee payer account comes
from.

## The Hedera Harness

https://github.com/hedera-dev/hedera-harness, branch `dev` at 2.0.0-rc.4

Not a dependency of this build and not vendored into this repository. The T20
contribution is a pull request to that project, developed in a fork cloned
outside this tree, so nothing came from the harness into here. MIT licensed.

What went the other way is one piece of this build's own code. The transaction
id conversion in `hashscanTransactionUrl` in `packages/client`, which turns the
SDK's `0.0.x@sss.nnn` into the `0.0.x-sss-nnn` the mirror node and HashScan
accept, is rewritten in the pull request as `normalizeTransactionId` in the
harness's own style, with the mirror form passing through and an unrecognised
value throwing. It is four lines of regular expression either way and neither
copy was pasted from the other, but it is the same idea and it is recorded here
because the pull request carries it into somebody else's repository.
