# Harness notes

Every place where documentation and behaviour disagreed, with the page, the date
it was read and what actually happened. Most entries are Hedera and were
reproduced on testnet before they were written down; the index model's source
data is the one non-Hedera section, and its entries were reproduced against the
live BLS endpoints and the committed archive. This file is the raw material for
the Hedera Harness contribution, so it is a deliverable, not a diary.

## T02, the index model, 4 September 2026

The index reads the BLS Public Data API and the BLS flat file server, not
Hedera, so these are source-side rather than chain-side. Every measurement below
was reproduced from this repository on 5 September 2026, and where the number
differs from what was first written down on 4 September the newer measurement is
the one recorded.

### The v1 endpoint needs its trailing slash, and v2 does not

The v1 signature page writes the URL as
`https://api.bls.gov/publicAPI/v1/timeseries/data/`, with the slash, and never
says the slash is load bearing.
https://www.bls.gov/developers/api_signature.htm

It is. Measured with the same POST body against both versions:

    POST https://api.bls.gov/publicAPI/v1/timeseries/data   -> HTTP 404, HTML
    POST https://api.bls.gov/publicAPI/v1/timeseries/data/  -> HTTP 200, JSON
    POST https://api.bls.gov/publicAPI/v2/timeseries/data   -> HTTP 200, JSON

Without the slash v1 answers with a Tomcat error page, `HTTP Status 404 - Not
Found`, so the failure is not a JSON body at all and a client that goes straight
to `JSON.parse` dies on `<`. v2 tolerates the missing slash, which is how the
mistake survives a copy from a v2 example into a v1 client.

Both endpoints are written with the slash in `ENDPOINTS`, and the failure path
checks the HTTP status and the parse before it reads the body's status field.

### A rejected request still comes back as HTTP 200

The FAQs describe the response's `status` field, and the signature pages show
`"status": "REQUEST_SUCCEEDED"` in every sample, but nothing says the HTTP status
code is not the one to branch on.
https://www.bls.gov/developers/api_faqs.htm

Measured on 5 September 2026, once the keyless daily allowance for this host was
spent:

    HTTP 200
    {"status":"REQUEST_NOT_PROCESSED","responseTime":0,
     "message":["Request could not be serviced, as the daily threshold for total
     number of requests allocated to the user with registration key  has been
     reached."],"Results":{}}

A status-code-only check treats that as a good fetch and then finds no series in
it, which downstream is indistinguishable from an occupation whose unemployment
rate never moves. So `describeFailure` treats any body whose `status` is not
`REQUEST_SUCCEEDED` as a failure, retries with backoff on the body rather than
on the code, and `assertComplete` refuses a response that is missing a series or
a month it asked for.

The registration key in that message is empty because the request was keyless.
The keyless v1 allowance is 25 requests a day and it is pooled across everything
sharing the address, so a spent allowance is a normal operating condition and
not a bug. The disk cache under `var/cache/bls` is what makes a second run of the
day possible; `--source archive` needs no network at all.

### The public site refuses a client with no descriptive User-Agent

The BLS site policies page asks automated users to identify themselves and says
access may be blocked otherwise. https://www.bls.gov/bls/pss.htm

What that means in practice, measured 5 September 2026:

    GET https://download.bls.gov/pub/time.series/ln/ln.series
      default curl agent                  -> HTTP 403
      "creance-index (+https://creance.co)" -> HTTP 200

    GET https://www.bls.gov/schedule/news_release/empsit.htm
      empty User-Agent                    -> HTTP 403
      "creance-index (+https://creance.co)" -> HTTP 200

This corrects what was written on 4 September, which said `www.bls.gov` answers
403 to servers as such and that the release calendar therefore cannot be fetched
at all. The gate is the User-Agent, not the client being a server: with a
descriptive agent the release calendar page answers 200 from this host. The
release calendar is still not fetched by the oracle, because a scraped HTML
schedule is a worse input than a committed one, but the reason is a choice and
not a block.

Every request this package makes sends `BLS_CONTACT` as its User-Agent, and
defaults to `creance-index (+https://creance.co)` when it is unset.

### v1 returns Results as an object, and the signature page shows an array

The v1 signature page's sample response nests the payload as
`"Results": [ { "series": [ ... ] } ]`, an array holding one object.
https://www.bls.gov/developers/api_signature.htm

Every real v1 response this build has seen returns
`"Results": { "series": [ ... ] }`, an object. The six committed archive files
under `data/bls/api` are keyless v1 responses and all six have the object form,
as does every live response measured since. The v2 page shows the object form.
`parseBlsResponse` accepts the object form and rejects anything else loudly
rather than returning an empty series list.

### October 2025 was never collected, so the smoothing window has a permanent hole

The CPS documentation describes the monthly series as continuous and gives no
gap convention. https://www.bls.gov/cps/documentation.htm

Every LN series in the archive carries this for October 2025:

    {"year":"2025","period":"M10","periodName":"October","value":"-",
     "footnotes":[{"code":"9",
       "text":"Data unavailable due to the 2025 lapse in appropriations."}]}

The value is the string `-`, not a number and not an absent row, so a parser
that coerces will read it as 0 and publish an occupation with no unemployment.
The month was never collected, so it is not a revision that will later arrive.

What we do: `-` is treated as absent, never as a value and never interpolated,
and the three month smoothing window does not slide over the hole. The
consequence is stated rather than hidden: the smoothed excess is undefined for
October, November and December 2025, and the year on year form is therefore
undefined for October, November and December 2026. The alternative reading, in
which the window hops the gap and takes the last three available months, is
implemented only as a test that asserts the code does not take it, because
sliding the window would change the definition of the index after issuance and
would open computer and mathematical in December 2025 when the strict reading
does not.

### The archive stops at July 2026, so the August 2026 opening is live only

`data/bls/PROVENANCE.txt` records the latest source period at fetch as 2026 M07,
so `pnpm oracle:backtest` reports arts, design, entertainment, sports and media
as last open in February 2026 and every acceptance number in docs/INDEX.md is a
statement about the archive.

On the live path on 4 September 2026 that group's August 2026 observation was
u_g 7.4 against u_all 4.3, a smoothed excess of 2.17 against a level line of
1.32, which opens on the level form. Nothing in the archive shows it.

Re-running the live fetch on 5 September 2026 was not possible from this host:
the keyless v1 allowance was already spent, so `pnpm oracle:backtest --source
api` failed as it should, with

    BLS v1 request failed after 4 attempts: status REQUEST_NOT_PROCESSED

What we do: the backtest and the backfill default to `--source archive`, so the
published tables are reproducible by anyone with the repository and no network,
and the live months are reached through `--source api` with the cache behind it.
A number that appears in docs/INDEX.md is an archive number, and the demo
narrative says which months the archive can and cannot show.

### The hazard table reproduces where it prices and drifts in its flat tail

The pre-event pricing work fitted `h(d) = 0.047 + 0.613 * exp(-d / 0.22)` to a
seven bucket empirical hazard measured on the archive. Recomputing that table
from the archive with this package, four of the seven buckets reproduce and
three do not:

    distance to line      pre-event   recomputed   sample
    at or past the line     65.6         65.6        32
    0 to 0.25 points        30.0         30.0        20
    0.25 to 0.5 points      12.2         12.2        74
    0.5 to 1 point           3.6          2.9       720
    1 to 2 points            4.7          4.7      1644
    2 to 4 points            4.7          4.6      1524
    more than 4 points       4.8          4.1       684

The sample counts are identical in all seven buckets, so the bucketing agrees
and only the count of months that went on to open differs, by five months in the
0.5 to 1 bucket and five in the tail. The three that diverge are all beyond half
a point, where the curve is flat and the shock form is setting the floor.

What we do: nothing to the price. `HAZARD_FIT` is frozen at the published
constants, and the guide rate is read off the fitted curve, not off the table, so
a tenth of a point of drift in the flat region does not move a quoted rate. The
three buckets that do move the price, the ones inside half a point, reproduce
exactly. The table is printed by `pnpm oracle:backtest` from the archive on every
run, so the divergence is visible rather than asserted, and the floor of 0.047
stays a stated judgment rather than a refitted measurement.

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
## T05, Scheduled Transactions, 4 September 2026

Measured with `pnpm hedera:schedule`, which runs each finding below as its own
stage against testnet. The payer throughout is policyholder-1 0.0.10366453 and
the destination is the steward 0.0.10366451; the settlement token is TUSD
0.0.10366463 with six decimals.

### The 62 day expiry cap is exact, and it is measured from the consensus timestamp

The create page gives the number without saying what it is measured against:
"A timestamp for specifying when the transaction should be evaluated for
execution and then expire (optional). The maximum allowed value is 62 days
(5356800 seconds)." https://docs.hedera.com/native/scheduled/create

Sixty-two days after what is the part that decides the code. It is not the time
you send the transaction and it is not its valid start: it is the **consensus
timestamp of the `ScheduleCreate` itself**, which on a normal testnet round
lands five to eight seconds after the valid start the SDK generates. Bisected
with 26 creates, each one's expiry set relative to its own valid start so the
bracket does not drift with latency:

    offset from valid start   status                    expiry minus consensus
    3600s                     SUCCESS
    17280000s                 SCHEDULE_EXPIRATION_TIME_TOO_FAR_IN_FUTURE
    ...
    5356804s                  SUCCESS                    5356799s
    5356805s                  SUCCESS                    5356800s
    5356806s                  SCHEDULE_EXPIRATION_TIME_TOO_FAR_IN_FUTURE

So the accepted maximum is exactly 5,356,800 seconds, 62.0 days, past consensus,
and 5,356,801 is rejected. The documented number is right; what is missing from
the page is the reference point, and code that measures the window from
`Date.now()` will build a schedule that fails intermittently within about eight
seconds of the cap.

The failed create is not free. A `ScheduleCreate` rejected with
`SCHEDULE_EXPIRATION_TIME_TOO_FAR_IN_FUTURE` was charged 0.12905667 HBAR, the
same fee to the tinybar as the successful probe creates in the same run. The
thirteen rejected probes and the thirteen accepted ones came to the same total.

### An expiry in the past has its own status, which no page names

Neither the create page nor the scheduled transaction concept page says what
happens when the expiration time has already gone. Measured with an expiry 60
seconds before the valid start:

    ScheduleCreateTransaction().setExpirationTime(now - 60s)
    -> SCHEDULE_EXPIRATION_TIME_MUST_BE_HIGHER_THAN_CONSENSUS_TIME

Also charged the full 0.12905667 HBAR. Both boundary statuses are worth naming
in the page, because the pair is what a caller has to distinguish: one means the
due date is too far out and the schedule has to be created later, the other
means the due date has passed and the payment is late.

### A schedule can execute before the expiration time the mirror node reports

The page says a schedule with `wait_for_expiry` set "will be evaluated for
execution at expiration_time", and the concept page says execution happens "at
the earliest available consensus time after their expiration time". Both read as
a lower bound. Measured on schedule
[0.0.10367507](https://hashscan.io/testnet/schedule/0.0.10367507):

    expiration_time      1788548305.130000000
    executed_timestamp   1788548305.112642208

The transfer executed 17.4 milliseconds **before** the expiration time the
mirror node reports for the same schedule. The whole second matches and the
fraction does not, so the sub-second part of the expiration time is stored and
served but is not what the evaluation waits for. Reproduced on a second schedule
with a different fraction,
[0.0.10367560](https://hashscan.io/testnet/schedule/0.0.10367560):

    expiration_time      1788548590.230000000
    executed_timestamp   1788548590.019679254

210 milliseconds early, again inside the same second.

It makes no practical difference to a monthly premium, and it is exactly the
kind of thing a test asserts on. Nothing should compare an execution timestamp
to an expiry with better than one second of tolerance, in either direction.

### A fully signed schedule with wait_for_expiry false executes in the same round

The default behaviour is documented as executing "at the time the minimum number
of signatures are received", without saying how quickly. For a premium that is
pre-signed at creation, the answer is immediately: schedule
[0.0.10367504](https://hashscan.io/testnet/schedule/0.0.10367504) reports

    consensus_timestamp  1788548119.891878716
    executed_timestamp   1788548119.891878717

one nanosecond apart, which is the same consensus round. This is the trap the
premium schedule has to avoid: leaving `waitForExpiry` at its default with a
pre-signed transfer drains the payer at bind time instead of at the due date,
and the receipt looks perfectly normal.

### Two schedules that differ only in their expiry are not identical schedules

The create page warns that a second create of the same schedule returns
`IDENTICAL_SCHEDULE_ALREADY_CREATED` and that the caller should sign the
existing one instead. It does not say which fields the comparison covers. Two
creates were accepted as separate schedules,
[0.0.10367507](https://hashscan.io/testnet/schedule/0.0.10367507) and
[0.0.10367560](https://hashscan.io/testnet/schedule/0.0.10367560), with the same
creator, the same payer, the same admin key, the same memo
`creance premium POL-SPIKE-1 202609` and the same inner transfer of 1.000000
TUSD from 0.0.10366453 to 0.0.10366451. The only difference between them was the
expiration time, and both executed.

That is the wrong way round for a premium. A Steward that times out waiting for
a receipt and retries with a freshly computed expiry does not get the safety net
the page describes: it gets a second schedule and the policyholder pays twice.
The duplicate check cannot be leaned on, so the caller has to hold the schedule
id and check it before creating anything, which is what the `policy_schedules`
row exists for.

### The create and the transfer it schedules share one transaction id

The create page says the scheduled transaction id "inherits the valid start time
and the account ID from the original schedule transaction" and carries a
`?scheduled` suffix in the SDK. What it does not say is that after the suffix is
dropped for the mirror node's `0.0.x-seconds-nanos` form, the two are the same
string. `GET /transactions/0.0.10366453-1788548118-155677633` returns two
transactions:

    SCHEDULECREATE   scheduled=false  consensus 1788548125.508381104  fee 0.13034724
    CRYPTOTRANSFER   scheduled=true   consensus 1788548305.112642208  fee 0.01290566

They are told apart by the `scheduled` flag and nothing else. So a HashScan
`/transaction/<id>` link resolves to both, and any code that reads an execution
out of the mirror node has to filter on `scheduled`, not pick the first element.

### HashScan answers HTTP 404 for every deep link

Not a Hedera behaviour, but it wastes an afternoon if a link checker is pointed
at the evidence links this repository publishes. HashScan is a single page app:
`GET https://hashscan.io/testnet/account/0.0.10362512` returns status 404 with
the application shell in the body, and so does every other route including ones
that resolve perfectly in a browser. The status code carries no information
about whether the entity exists.

The routes themselves are in the client router, and the one this ticket needed
is `/{network}/schedule/{scheduleId}`, alongside `/{network}/transaction/{id}`
and `/{network}/transactionsById/{id}`.

## T06, the Asset Tokenization Studio, 4 September 2026

Everything in this section was reproduced against the ATS testnet factory
0.0.9213391 and resolver 0.0.9212226 with release 8.0.0, on 4 September 2026.
Source references are to the repository at tag `v.8.0.0-ats`.

### The SDK cannot be driven without a browser wallet or a custody account

`packages/ats/sdk/src/domain/context/network/Wallet.ts` at 8.0.0 defines
`SupportedWallets` as exactly `METAMASK`, `HWALLETCONNECT`, `DFNS`,
`FIREBLOCKS` and `AWSKMS`. There is no key based or local signer option.
`RPCTransactionAdapter.register` delegates to `MetamaskService`, which calls
`detectEthereumProvider()` and reads `globalThis.window.ethereum`, so it needs a
browser extension; `HWALLETCONNECT` needs a Reown project id and a wallet
application to approve each transaction; the other three are third party
custody services with their own credentials.

The documentation does not say this. The SDK integration guide opens with a
Node example. A headless script, a CI job or an agent therefore cannot use the
SDK at all, and has to call the contracts directly with the ABIs from
`@hashgraph/asset-tokenization-contracts`, which is what this build does.

The adapter does expose `setSignerOrProvider`, so a local signer looks
achievable without much work upstream; that would be the fix.

### The SDK sends the supply cap unscaled, which caps a six decimal bond at a millionth of a unit

`Bond.create` builds `maxSupply: BigDecimal.fromString(req.numberOfUnits)` and
`SecurityDataBuilder.buildSecurityData` passes `maxSupply.toString()` straight
into the factory. `BigDecimal.fromString("100")` with no decimals is the string
`"100"`, so a request for 100 units of a six decimal bond sends a cap of `100`.

The contract holds balances in the token's own decimals.
`CapStorageWrapper.isCorrectMaxSupply` is
`(_maxSupply == 0) || (_amount <= _maxSupply)`, so a cap of `100` on a six
decimal note allows one ten thousandth of one unit and refuses everything
above it.

Reproduced: a bond deployed with `maxSupply` 100 and `decimals` 6
([0.0.10368234](https://hashscan.io/testnet/contract/0.0.10368234)) refuses
`issueByPartition` of `1000000`, one whole unit, with
`MaxSupplyReached(100)`
([transaction](https://hashscan.io/testnet/transaction/0xcf45fe36f004efcc9c5dd71f734a8a7b77b6343f949c7c3d9497d11b52f90fef)).
The same bond with `maxSupply` `100000000` takes all hundred units
([0.0.10368240](https://hashscan.io/testnet/contract/0.0.10368240)).

Nothing in the creating-bond guide or the SDK reference says which scale
`numberOfUnits` is in, and a zero cap silently means no cap at all, so the
mistake only appears at the first mint.

### Internal KYC and external KYC lists combine as an AND, and the guide says OR

`docs/ats/user-guides/managing-compliance.md` says: "You can use Internal KYC +
External KYC Lists + SSI simultaneously. Any method granting KYC allows the
transfer."

`packages/ats/contracts/contracts/domain/core/KycStorageWrapper.sol` says the
opposite:

    function verifyKycStatus(IKyc.KycStatus _kycStatus, address _account) internal view returns (bool) {
        bool internalKycValid = !kycStorage().internalKycActivated ||
            getKycStatusFor(_account, block.timestamp) == _kycStatus;
        return internalKycValid && ExternalListManagementStorageWrapper.isExternallyGranted(_account, _kycStatus);
    }

and `ExternalListManagementStorageWrapper.isExternallyGranted` is true only when
**every** registered external list reports the required status, vacuously true
when there are none. So:

| Internal KYC | External lists | Effective gate |
|---|---|---|
| on | none | internal KYC only |
| off | one or more | every external list must agree |
| on | one or more | both, an AND |
| off | none | no KYC gate at all |

Adding an external list as a fallback to internal KYC makes the gate stricter,
not looser, and a transfer that worked stops working. This build uses internal
KYC alone and registers no external list, which is why the blocked transfer in
docs/ATS.md reverts `InvalidKycStatus` and not something else. The two file
references above are the whole of the fix: the guide's sentence is wrong.

### The compliance guide's createVC hardhat task does not exist

`managing-compliance.md` tells the reader to run
`npx hardhat createVC --holder <addr> --privatekey <key>` from
`packages/ats/contracts`. `packages/ats/contracts/tasks/index.ts` at 8.0.0
exports `Arguments`, `utils`, `deploy`, `transparentUpgradeableProxy`,
`businessLogicResolver`, `compile`, `selector`, `generateRegistry` and
`generateHashes`, and nothing called `createVC`.

What does work, and what this build uses, is the recipe in the SDK's own test
helper `packages/ats/sdk/__tests__/utils/verifiableCredentials.ts`:
`createEcdsaCredential` from `@terminal3/ecdsa_vc`. Neither `@terminal3/ecdsa_vc`
nor `@terminal3/vc_core` appears in any `package.json` in the repository; they
resolve transitively under `@terminal3/verify_vc` and have to be installed
explicitly by anyone writing the script.

### The credential verifies with no network access, and no DID registry

Worth recording because the test helper points its `provider` at
`https://testnet.hashio.io/api` while hard coding a `didRegistryAddress` and a
`revocationRegistryAddress`, which reads as though verification resolves a DID
document somewhere. It does not. `createEcdsaCredential` with an empty options
object produces an `EcdsaSecp256k1Signature2019` credential, and `verifyVc`
accepts it offline: the proof is an ECDSA signature recovered against the
address in the issuer DID. The DID method segment is free text as far as
verification is concerned, so this build issues
`did:ethr:hedera:<operator address>` rather than the helper's `did:ethr:polygon:`.

Two smaller things in the same library. `verifyVc` reports a bad signature by
**throwing** `Signature does not correspond to verificationMethod in the proof`,
not by returning `{ isValid: false }`, so the SDK's own
`if (!verificationResult.isValid) throw new InvalidVc()` in
`GrantKycCommandHandler` never runs for the case it names. And a namespace
containing a colon, for example `hedera:testnet`, is parsed as a chain id and
fails inside ethers with `invalid BytesLike value`.

### grantKyc stores the credential id and never checks the credential

`packages/ats/contracts/contracts/facets/kyc/Kyc.sol` takes
`(address _account, string _vcId, uint256 _validFrom, uint256 _validTo, address _issuer)`
and stores `_vcId` as an opaque string. The only on chain conditions are the
`ROLE_KYC` role, a registered issuer, a not yet granted account and
`validFrom <= validTo` with `validTo >= block.timestamp`. Every claim about the
credential itself is checked off chain, in the SDK, before the call.

That is worth stating plainly because a reader of the contract will assume the
verifiable credential is verified by the chain. It is not. Any caller with
`ROLE_KYC` can pass any string. A build that bypasses the SDK, as this one does,
has to run `verifyVc` itself or the on chain record points at nothing.

### The SDK derives validFrom and validTo by taking the first ten characters of a millisecond timestamp

`GrantKycCommandHandler` calls
`BigDecimal.fromString(updatedSignedCredential.validFrom.substring(0, 10))`,
where the value is a millisecond timestamp rendered as a decimal string. It is
a string truncation standing in for a division by a thousand, and it holds only
while millisecond timestamps have exactly thirteen digits. `Terminal3Vc` also
defaults a missing `validUntil` to a hundred years from now rather than to the
credential's own expiry, which is why the grants in docs/ATS.md carry
`validTo` 4942152752, in the year 2126.

### A partial freeze leaves the partition balance, so balanceOf reports only what is spendable

`ERC3643StorageWrapper.freezeTokens` increments the frozen counters and then
calls `ERC1410StorageWrapper.reducePartitionOnly` and
`ERC20StorageWrapper.performTransfer(_account, address(0), _amount)`. So a
freeze of 45 units on a holder of 50 leaves `balanceOf` and
`balanceOfByPartition` reading 5, and emits an ERC-20 transfer to the zero
address that looks exactly like a burn.

Measured on the note: before the freeze `balanceOf(0xCAa1184c...ce51e)` was
`50000000`; after
[freezePartialTokens](https://hashscan.io/testnet/transaction/0xeecbf14f96b9923b452966dc7fa31a34c890d8dea1f928fa9692922653fe7891)
of `45000000` it was `5000000` with `getFrozenTokens` at `45000000`; after
[unfreezePartialTokens](https://hashscan.io/testnet/transaction/0x0edc8a9a1ad5459e7603a17e4efddd6cc3a4f1ea149c0c37eb95c1ac59a6b9f4)
it was back to `50000000`.

A holder's position is `balanceOf` plus `getFrozenTokens`. Any screen or
indexer that reports `balanceOf` as the holding will understate a frozen holder
and, if it follows transfer events, will record the freeze as a burn.

### The coupon snapshot id stays zero after the record date

The corporate actions guide describes the record date as taking a holder
snapshot bound to the coupon by `snapshotId`. On the note, five minutes after
the record date of coupon 1 had passed, `getCoupon(1)` still returned
`snapshotId` `0`, while `getCouponFor(1, holder)` returned
`recordDateReached true` and a non zero entitlement for both holders. The
snapshot is taken lazily by the next operation that touches the balance, so
`snapshotId` is not the signal that the record date has been reached.
`recordDateReached` is.

### The coupon entitlement is a fraction in whole currency units, not in token units

`CouponStorageWrapper._calculateCouponAmount` returns

    numerator   = balance * nominalValue / 10^nominalValueDecimals * rate * (endDate - startDate)
    denominator = 10^(decimals + rateDecimals) * 365 days

so both the token decimals and the rate decimals are divided out and what comes
back is an amount in whole currency units. On the note,
`1036800000000000000 / 3153600000000000` is `328.767...` United States dollars,
not `328767123` of anything. The caller multiplies by the settlement token's own
scale. The contract comment says the fraction defers rounding to the caller; it
does not say which unit the fraction is in, and getting that wrong is a factor
of a million.

### A bond deployment costs about eight HBAR, not the fifty to two hundred the guide quotes

`docs/ats/user-guides/creating-bond.md` puts a bond deployment at 50 to 200
HBAR. Measured from the mirror node's `charged_tx_fee` on 4 September 2026:
7.6332993 HBAR for the throwaway and 7.7055066 HBAR for the series, at
6,939,363 and 7,005,006 gas against a 15,000,000 limit. Useful in the other
direction too: the SDK's `GAS.CREATE_BOND_ST` of 15,000,000 is the whole per
transaction cap, so a deployment cannot be batched with anything else.

### The factory takes the resolver as an argument, so there is no pair to get wrong

`IFactory.deployBond` carries `security.resolver` in its own request. The
factory is not bound to a resolver at deployment, which means the two testnet
address sets in the repository are not a matched pair that has to be discovered:
the caller chooses the resolver, and the only requirement is that it has the
8.0.0 bond configuration registered. `getLatestVersionByConfiguration(0x00..02)`
on 0.0.9212226 returns `1`, and 0.0.9213391 deployed against it twice without
complaint. The stale `deployed-addresses.md` page is still worth fixing, but the
failure it would have caused is a missing configuration, not a mismatch.

## T14, coupons and maturity, 4 September 2026

### A contract call can be wrapped in a Scheduled Transaction, and the contract sees the schedule payer as the caller

The Scheduled Transactions page lists the transaction types that can be
scheduled and `ContractExecuteTransaction` is not among the examples, and the
schedulable set is the kind of thing that changes between releases, so it was
measured rather than assumed. It matters because the premium account is a
balance inside `CollateralVault`, and a contract has no key with which to sign
the transfer inside a schedule.

On testnet on 4 September 2026 a `ScheduleCreate` carrying a
`ContractExecuteTransaction` was accepted, and the schedule executed at its
expiry. The second half of the question, which account the contract sees as
`msg.sender`, was answered by scheduling `CollateralVault.fundCoupon` with a
zero amount from the api account, which holds `TREASURY_ROLE`. The call is
ordered `whenNotPaused`, then `onlyRole(TREASURY_ROLE)`, then the series check,
then the amount check, so the revert name is the answer:

    schedule    0.0.10368856, created by 0.0.10366450, wait_for_expiry true
    executed    0.0.10366450-1788556686-320635056
    result      CONTRACT_REVERT_EXECUTED, error_message 0x1f2a2005 = ZeroAmount()

It reverted on the argument and not on the role, so the caller was the schedule
payer. Checked rather than inferred: `hasRole(TREASURY_ROLE, 0x7c02879d...8fdf)`
is true and `hasRole(TREASURY_ROLE, 0x00...9e2df2)` is false, and those are the
two spellings of the same account.

The consequence is the whole shape of T14: a coupon is paid by scheduling the
vault's own `fundCoupon` call, so the settlement token goes straight from the
premium account to the noteholder and no intermediate account ever holds a
noteholder's coupon.

### A ScheduleCreate that carries a contract call costs ten times one that carries a transfer

Measured from `charged_tx_fee` on the same day, on the same account, with the
same expiry and the same admin key.

| Schedule holds | HBAR |
|---|---|
| a `CryptoTransfer` of the settlement token | 0.12905667 |
| a `ContractExecuteTransaction` with a 1,500,000 gas limit | 1.29264098 |

The execution fee is the ordinary contract call fee, 0.0322707 HBAR for the
reverted probe and about 0.03 for each of the two coupon payments. Nothing in
the fee schedule documentation prices the create by what it carries, and the
difference is large enough to plan around: two noteholders cost 2.59 HBAR in
create fees a month, which is fine, and a hundred would not be.

### The contract result of a scheduled call is not reachable by its transaction id

`GET /api/v1/contracts/results/{transactionIdOrHash}` answers

    {"_status":{"messages":[{"message":"Not found"}]}}

for `0.0.10366450-1788556362-164242817`, which is a scheduled contract call that
executed and is visible at `GET /api/v1/transactions/{id}` with `scheduled`
true. The result is reachable by the consensus timestamp of the execution
instead:

    GET /api/v1/contracts/results?timestamp=1788556414.010845823

returns the row, with `result`, `gas_used` and `error_message`. The schedule
record carries that timestamp as `executed_timestamp`, so the read is: schedule,
then transactions by timestamp for the outcome, then contract results by the
same timestamp for the revert data and the gas.

### The mirror node reports the long-zero address as the caller of a scheduled contract call

The contract result above has `"from": "0x00000000000000000000000000000000009e2df2"`,
the long-zero form of 0.0.10366450, while the EVM inside the call saw
`0x7c02879d6b95f923681f517b0487aa45af2b8fdf`, the key derived alias of the same
account: the role check passed, and only the alias holds the role. Any indexer
that matches a caller by the address in a contract result will miss every call
made by an account that has an alias. Match on the account id.

### ethers reserves twice the base fee times the gas limit before it will send

Not a Hedera quirk, but it bites hard at Hedera's gas price. The relay reported
`eth_gasPrice` of 1,160,000,000,000 weibar, which is 116 tinybar per gas, so a
call sent with the 2,000,000 gas limit this build uses for a token service call
needs 2.32 HBAR of headroom, and ethers checks against roughly twice that
before it will sign. An account holding 4.15 HBAR failed with `insufficient
funds for intrinsic transaction cost` on a transfer that went on to use 39,647
gas and cost a fraction of a HBAR.

So "unused gas is refunded in full, so a generous limit is free" is true of the
fee and false of the balance. Every account that signs its own calls in this
build is topped up to 12 HBAR first.

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

### Tailwind reads prose as class names, and a sentence emitted the only shadow

The design has no shadows. A test asserts that no rule in the built stylesheet
sets `box-shadow` to anything but `none`. It failed, on this rule:

    .ring{--tw-ring-shadow:...;box-shadow:var(--tw-inset-shadow), ...}

Nothing in the app uses that utility. It was emitted because three source
comments explained that the design's focus state is an outline rather than the
framework's default, and the framework's class scanner treats every word in
every reachable file as a candidate class name. The word matched a real utility,
so the utility was generated.

The behaviour is documented, in the sense that the detection page says source
files are scanned "for class names" and that the scanner is deliberately
ignorant of the language it is reading
(https://tailwindcss.com/docs/detecting-classes-in-source-files, read
2026-09-04). What no page says is that a comment counts, which is the part that
costs an hour.

Two fixes, both applied. The prose was reworded. More usefully, the source set
is now pinned in the stylesheet:

    @import "tailwindcss" source(none);
    @source "../";

so the candidate list comes from `src/` and cannot be widened by a test file, a
fixture or a markdown document that happens to contain the wrong word.

### The theme block drops tokens that nothing has used yet

`@theme` emits only the variables some utility referenced. `--radius-hero` and
the two marketing ground colours are in the sheet, are not used by any screen in
this ticket, and were therefore absent from the built CSS, which failed the test
that every token resolves to its hex.

That is the documented behaviour and it is the right default for an application.
It is the wrong default for a file that is the token sheet of record, so the
block is declared `@theme static`, which emits every variable whether or not a
utility reached for it
(https://tailwindcss.com/docs/theme, read 2026-09-04).

### A font module in the bundle graph is fetched whether or not it is used

The ticket asks for both typeface options wired behind one switch, with the
inactive one not loaded at runtime. The obvious shape is a conditional import in
the root layout on an inlined public environment variable, so the bundler can
drop the branch it does not take.

It does not drop it. Built with Option A active, the page still carried:

    <link rel="preload" href="/_next/static/media/Geist_Variable-s.p....woff2"
          as="font" crossorigin="anonymous">

The font loader runs over any module in the graph and emits its `@font-face` and
its preload link at build time, before any branch can be evaluated. Neither the
font optimisation page nor the environment variable page says this
(https://nextjs.org/docs/app/api-reference/components/font and
https://nextjs.org/docs/app/guides/environment-variables, both read 2026-09-04).

The switch was moved to module resolution instead, aliasing one specifier to one
of the two font modules in `next.config.ts`. Rebuilt and measured both ways:
with A active there is no Geist file in the output, with B active there is no
Inter file.

## T07, the API, 5 September 2026

### The account that holds BINDER_ROLE cannot write to the index topic

docs/HEDERA.md's topic table and the T07 acceptance disagree. The acceptance
asks for the bind receipt on the index topic; the index topic's submit key is
the oracle's. The api account holds BINDER_ROLE, CLAIMS_ROLE and the payments
topic submit key, and nothing more. A `TopicMessageSubmitTransaction` to the
index topic signed by the api key fails, so this is a design constraint and not
a runtime discovery: the receipt goes to the payments topic. See
docs/DECISIONS.md.

### The policy NFT's supply and freeze keys belong to the operator, not the API

Same shape of gap, on the token side. `pnpm hedera:setup` created CPOL with the
operator key as treasury, admin, supply and freeze key. The API is the process
that mints a policy receipt, so it needs the operator key too, not only the api
key. Two keys in one process is worth saying out loud, because a reader of
DESIGN.md 4 would reasonably expect the api account to own everything the API
does.

### `hcsReceiptSeq` forces the receipt to be published before the bind

`CoverPool.bind` takes the HCS sequence number as an input. A bind therefore
publishes first and calls second, and a revert leaves a message on a public
settlement topic describing a policy that was never registered. HCS has no
retraction. The T04 note anticipated this and proposed passing zero; the API
passes the real sequence number and writes a second message resolving the first,
because a receipt that is never resolved is worse than two messages.

Measured on testnet: the two messages landed at sequences 3 and 4 for the first
policy and 5 and 6 for the second, on topic
[0.0.10366471](https://hashscan.io/testnet/topic/0.0.10366471).

### A second policy for the same holder needs the unfreeze, and it is a mirror read

docs/DECISIONS.md's "The policy NFT collection has no default freeze" says a
second policy for the same holder needs an unfreeze first. There is no cheap way
to ask the network whether an account is frozen for a token: the SDK has no
query for it, so the answer comes from the mirror node's
`/accounts/{id}/tokens?token.id={token}`, whose `freeze_status` reads `FROZEN`
or `UNFROZEN`. That read is on the bind path, which means a bind depends on the
mirror node being current for a fact the network already knows.

Proven both ways on testnet against
[0.0.10366458](https://hashscan.io/testnet/account/0.0.10366458): the first bind
found no relationship freeze and minted serial 1; the second found `FROZEN`,
unfroze, minted serial 2, transferred and froze again.

### The premium the formula of record produces is not DESIGN's demo number

DESIGN.md 3.4 gives the demo premium as "around 15 to 30 a month" for a 5,000
limit. docs/DECISIONS.md's "Premium is a guide price from the index multiplied
by a capacity term" supersedes DESIGN's frequency formula, and it prices from
the distance to the level line, which moves every month. Computed from the
committed archive at zero utilisation, for a 5,000 limit:

| Month | ebar | Distance to the line | Rate | Monthly premium |
|---|---|---|---|---|
| 2026-03 | -0.80 | 0.12 | 524 bps | 21.83 |
| 2026-04 | -0.60 | -0.08, open on the level form | 1210 bps | 50.42 |
| 2026-05 | -0.63 | -0.05, open on the level form | 1063 bps | 44.29 |
| 2026-06 | -1.00 | 0.32 | 248 bps | 10.33 |
| 2026-07 | -1.37 | 0.69 | 96 bps | 4.00 |

So DESIGN's 15 to 30 is right for March 2026, the month before claims open, and
wrong for the archive's latest month, which is what a clone quotes today. The
number is not a constant and the copy deck's 28.00 placeholder should stay
interpolated at runtime, which DESIGN.md already says.

### The Hedera SDK's TokenMintTransaction takes metadata as bytes, and the cap is bytes

Already recorded from T03 as a day 0 finding, confirmed from the API side:
`setMetadata([Buffer])` is the shape, one entry per serial, and 100 bytes is the
limit. The policy metadata is `{"p":"pol_<ulid>","s":"<series>"}`, 60 bytes, so
a longer series label would still fit and a second field would not.

### A ULID with a four character prefix is exactly 30 bytes, which fits bytes32

`ethers.encodeBytes32String` takes at most 31 bytes. `pol_` plus a 26 character
ULID is 30, with one byte to spare, so a policy id round trips between the JSON,
the database and the chain with no lookup table and a HashScan event log decodes
to something a person can read. A UUID would not have fitted, which is why the
ids are ULIDs.

### The mirror node's NFT metadata is base64, and its `/tokens/{id}/nfts/{serial}` answers 404 before it answers 200

Consistent with the T03 note on topic messages: the entity endpoints 404 while
the mirror catches up, so both the NFT read and the topic message read after a
bind are polls. Measured on testnet at roughly one to three seconds behind
consensus for both.

### The Node PostgreSQL driver returns numeric as a string, which is what this build wants

`numeric(78,0)` comes back from `pg` as a JavaScript string rather than a
number, which is the behaviour every amount in this system depends on. It is not
a setting and it is easy to read as a bug, so it is written down: a `pg` type
parser that "fixes" it by returning a number would silently truncate every
amount over 2^53.

### Flipping the last base64url character of a JWT signature does not always break it

Found by a test of this build's own, which failed about one run in four and
passed the rest. The test forged a credential by flipping the final character of
the signature segment and expected `jwtVerify` to refuse it. Sometimes it did
not.

An Ed25519 signature is 64 bytes and its base64url form is 86 characters. Those
encode 516 bits for 512 bits of signature, so the last character carries four
significant bits and two that the decoder discards. For sixteen of the
sixty-four possible final characters the flip lands entirely in the discarded
bits, the signature decodes to the same 64 bytes, and the token verifies
normally.

Nothing is wrong with `jose` here; the test was wrong. It is worth writing down
because "flip a character to corrupt it" is the obvious way to write this test
and it is subtly unsound for any base64 payload whose length is not a multiple
of three bytes. Decode, flip a byte, re-encode.

## T17, web investor screens, 5 September 2026

### The ATS internal KYC register is a uint, and the docs only ever show it as a word

docs/ATS.md records `getKycStatusFor` reading `1` for a granted noteholder,
which is the value the ATS run through printed. The Asset Tokenization Studio
documentation describes the states as GRANTED and NOT_GRANTED and does not give
the ABI type behind them, so the fragment the API reads with had to be
established against testnet rather than from a page.

Measured on the demo note `0.0.10368240` through the JSON-RPC relay with the
fragment `function getKycStatusFor(address) view returns (uint256)`:

    0xb6c2ff466e3c73f1a49a3f1b936f8e3837112931  investor-1        1
    0xcaa1184cd59b9296f757efc7303a10ecec6ce51e  investor-2        1
    0xcad39730d48683b13e6077a70c6972add449b6f5  policyholder-1    0

The third account is the one that matters for a screen: an account nobody has
granted reads `0` rather than reverting, so a "Verification needed" state is a
read and not an error path. A word-shaped return type would have decoded the
same 32 bytes, which is why this was checked rather than assumed.

### CoverPool.seriesOf answers for a series it has never heard of

The maturity demonstration series `ODI-MAT-1788558259` exists in the vault and
in the note but was never registered in the CoverPool, and `seriesOf` returns a
zeroed struct for it rather than reverting:

    ODI-COMP-2026-01   term 31536000  waiting 5184000  status 1  activeExposure 0
    ODI-MAT-1788558259 term 0         waiting 0        status 0  activeExposure 0

Both series therefore read "0 capacity used" from the exposure alone, and only
one of them means it. `registerSeries` refuses a zero term, so a zero term is
the signal that separates the two, and the investor view carries `registered`
rather than letting a screen infer a state from a nought.

### Tailwind v4 reads "shadow:" in a comment as a class candidate and "shadow," not

The web app's stylesheet already carries a warning about this: the utility
scanner reads prose as a list of class name candidates and emits the utility for
any word that happens to be one. The boundary is narrower than the warning
suggests. `apps/web/src/components/toast.tsx` has carried the phrase "no
shadow," since T10 with no effect on the built CSS. A new comment ending "no
shadow:" put the framework's whole shadow composite into the stylesheet:

    box-shadow: var(--tw-inset-shadow), var(--tw-inset-ring-shadow),
                var(--tw-ring-offset-shadow), var(--tw-ring-shadow),
                var(--tw-shadow)

and failed the test that asserts this design has no drop shadow anywhere. The
detection page describes the scan as looking for "tokens that could be class
names" and does not say which trailing punctuation ends a token
(https://tailwindcss.com/docs/detecting-classes-in-source-files, read
2026-09-05). A colon does not, because a colon is the variant separator, so
`shadow:` reads as the start of a variant and the base utility is emitted. The
comment was reworded. The test caught it, which is the argument for having it.

Met again on T37, and the boundary is narrower still. A comment describing where
IDKit draws its overlay said "in a shadow host it appends to the document body".
A plain space after the word is enough: the same composite went into the built
stylesheet and the same test failed. So a trailing comma ends the token and a
trailing space does not, which means the safe rule for prose in a scanned file
is not "avoid punctuation after a utility name" but "do not write a utility name
as a bare word at all". Reworded to "shadow-root host", which is a candidate
Tailwind has no rule for and is the more accurate phrase anyway.
## T08, x402 and Blocky402, 5 September 2026

### The Fastify middleware prices a route before the request body exists

`@x402/fastify`'s `paymentMiddleware` registers its work on Fastify's
`onRequest` hook, and a route's `price` may be a function of the request
context, which carries an `adapter.getBody()`. Those two do not compose.
Fastify parses the body after `onRequest`, in the parsing phase, so
`getBody()` inside a price function returns `undefined` on every request. A
route whose price depends on the body cannot be priced from the route map.

Measured with a route configured as

    'POST /probe-body': { accepts: { price: async (ctx) => {
        console.log(ctx.adapter.getBody?.());   // undefined, every time
        return '$0.01';
    } } }

against a POST carrying `{"quote_id":"quote_abc"}`.

`POST /v1/bind` charges the first month's premium, which is per quote and
identified by the quote id in the body, so this is exactly the case that does
not work. The endpoint gets its own gate in `apps/api/src/x402/bind.ts`, driving
the same `x402ResourceServer` object, so the wire format, the facilitator and
the settlement path are the library's and only the ordering is ours. The
alternative, moving the quote id into the query string, would have changed the
API shape to suit a hook's ordering.

The adapter interface's own JSDoc says "Fastify automatically parses JSON
bodies", which is true and is not the same claim.

### The settle hook is handed the request context from before the route matched

`x402HTTPResourceServer` builds an `enrichedContext` carrying `routePattern`
and uses it to price the route, but the Fastify middleware stores the
unenriched `context` on the request and passes that one to settlement. So a
`afterSettle` hook reading `transportContext.request.routePattern` finds it
undefined and has only the concrete path. Recognising which route a settlement
belongs to has to be done by method and path, which is what
`apps/api/src/x402/gate.ts` does.

### The client refuses its own network's non-default token, and caps a payment at a dollar

`x402Client`'s spend controls default to "only assets `findDefaultAsset`
recognises, capped at `$1` each". On `hedera:testnet` the only recognised asset
is USDC `0.0.429274`. This build settles in its own HTS token
`0.0.10366463`, and a first premium is more than a dollar, so both defaults
refuse the payment before it reaches the facilitator, in the client, with no
network call to look at. `packages/client/src/x402/payer.ts` sets
`spendControls.allowedAssets` to the settlement token and turns the dollar cap
off, and takes a ceiling in minor units instead.

The server half needs the matching setting: `new ExactHederaScheme({
defaultAssets: { 'hedera:testnet': { asset, decimals } } })`, or a `"$0.01"`
price converts against USDC and advertises the wrong token.

### The facilitator settles an arbitrary HTS token, not only USDC

The package ships USDC as the network default and its README points at the
Circle faucet, which reads as though the default were a constraint. It is not.
Blocky402's testnet facilitator verified and settled a transfer of this build's
own token `0.0.10366463` with no configuration on its side: the asset travels in
the payment requirements and the facilitator checks the transfer against them.
Confirmed by a real settlement, `0.0.7162784@1788600927.143349211`, which moved
10000 minor units of `0.0.10366463` from `0.0.10366451` to `0.0.10366450` with
the network fee of 1379442 tinybars paid by `0.0.7162784`.

### The settlement field is `transaction`, and `payer` is the wallet

Two disagreements between the x402 Hedera scheme specification and Blocky402's
own API reference, both resolved by running it. The settle response carries the
Hedera transaction id under `transaction`, which is Blocky402's spelling; the
scheme specification calls the same field `transactionId`. And `payer` carries
the paying wallet `0.0.10366451`, not the sponsoring fee payer that the scheme
specification's example shows there. This build reads both keys for the
transaction id and stores its own idea of the payer beside whatever the
facilitator returned.

### HashScan will not resolve the transaction id the facilitator returns

The facilitator returns `0.0.7162784@1788600927.143349211`. HashScan's
transaction route wants `0.0.7162784-1788600927-143349211`, and so does the
mirror node's `/transactions/{id}`. Pasting the `@` form returns nothing at all
rather than an error, which is a bad thing to discover in front of a judge.
`hashscanTransactionUrl` in `packages/client` does the conversion.

### The packages moved a minor version during the event

The prep reading was against 2.24.0, published 2026-08-27. The registry served
2.25.0 for all four packages on 5 September. Nothing in the shapes above
changed. `@x402/hedera` 2.25.0 pins `@hiero-ledger/sdk` 2.85.0 while this
repository is on 2.87.0, so two copies of the SDK are on disk; the README warns
that mixing them breaks the SDK's `instanceof` checks, so every file that
touches x402 imports `PrivateKey` and the rest from `@x402/hedera` rather than
from the SDK directly, and nothing has been seen to break.

## T18, the audit trail, 5 September 2026

### The mirror node has two shapes for one topic message and they are not interchangeable

`GET /api/v1/topics/{id}/messages/{sequenceNumber}` answers with the message
object itself, at the top level. `GET /api/v1/topics/{id}/messages?sequencenumber=eq:{n}`
answers with `{"messages": [...], "links": {...}}` and the same message inside
the list. Both are 200 and both are documented under the same heading in the
REST reference, so a client that starts on one and moves to the other for the
sake of a filter gets `undefined` where the body should be, with no error.
`MirrorClient` in `packages/client` uses the query form for every read, so one
code path serves both the single message and the window.

Measured, payments topic 0.0.10366471 on 5 September 2026:

    /topics/0.0.10366471/messages/18          -> {"consensus_timestamp": "...", "sequence_number": 18, "message": "..."}
    /topics/0.0.10366471/messages?sequencenumber=eq:18 -> {"messages": [ ... ], "links": {"next": null}}

### `sequencenumber` takes the comparison operators, which is how a window is read

The reference names `sequencenumber` as a filter without saying what a value may
look like. It takes the same `operator:value` form the timestamp filters take:

    GET /topics/0.0.10366471/messages?limit=3&order=asc&sequencenumber=gte:18
    -> sequence numbers 18, 19, 20

That is what makes the second half of a policy receipt findable. A bind writes
two messages and only the first sequence number is stored, so the audit trail
reads forward from it with `gte:` rather than guessing that the next message on
a shared topic is the one it wants.

### A transaction id on a topic message comes in two forms, and only one resolves

The coupon run writes `transactionId` in the mirror form,
`0.0.10366450-1788556746-724064738`. The x402 settlement writes `tx` in the SDK
form the facilitator returns, `0.0.7162784@1788602397.120605122`. Both are
correct for their writer and only the first resolves on HashScan, so the reader
converts before it builds a link, as the T08 note above says. A trail assembled
from a topic has to expect both forms rather than the one its own writer uses.

## T15, web worker screens, 5 September 2026

### A constant exported from a "use client" module reaches a server component as a stub that throws

`AMOUNT_DEFAULT` was exported beside the amount slider, which is a client
component. Importing it from the Amount route, a server component, gave back not
the number 5000 but a function whose body throws:

    Attempted to call AMOUNT_DEFAULT() from the server but AMOUNT_DEFAULT is on
    the client.

The route did not crash. It passed the stub into a conversion that expects a
whole number, which threw a RangeError, which the route caught as "the API is
unreachable" and rendered its error state. Nothing in the terminal said what had
happened until an explicit log was added to that catch.

The framework documents the directive as marking "the boundary between server
and client code" and describes what happens to components
(https://react.dev/reference/rsc/use-client, read 2026-09-05); the failure mode
for a plain value crossing the same boundary in the other direction is a runtime
proxy rather than a build error. Two things follow, both applied here: a
constant the server needs lives in a module with no directive, and a catch that
renders an error state logs the reason rather than swallowing it.

### A "use server" module may export only async functions, and it is a build error, not a runtime one

A synchronous helper exported beside the purchase flow's server actions compiled
and typechecked, and `next build` refused it:

    Server Actions must be async functions.

The rule is in the directive's reference
(https://react.dev/reference/rsc/use-server, read 2026-09-05). It applies to
every export in the file, not to the ones a client actually calls, so a message
builder and a result type sitting beside the actions are enough to fail a build
that `pnpm dev` had been serving happily for an hour. Anything exported from
those files that is not itself an action moves out.

### The API's money display is the asset's full scale, and the sheet's money rule is two decimals

`POST /v1/bind` answered `premium.display` as `0.858333` for a 1,000 limit,
which is the six decimal settlement asset written out. docs/DESIGN-TOKENS.md
section 9 says two decimals for money. The screens therefore format
`premium.amount` through `src/lib/format.ts` rather than rendering `display`,
which is the same rule T17 recorded for a coupon, and the exact minor units stay
one call away in the endpoint's own response. `display` is what a human reading
the API response sees; it is not what a screen prints.

### The quote view carries the attachment and the level line but not the exhaustion

`GET /v1/quote` returns `attachment_shock` and `level_line`, both of which the
Amount screen's sentence needs, and no exhaustion, which the same sentence also
needs ("Full payout at 4 points"). docs/HEDERA.md, "The demo series", publishes
E as 4.0 points for ODI-COMP-2026-01, so the web app reads it from a per series
table and drops the clause for a series that has no published exhaustion. The
field belongs in the quote view; see docs/DECISIONS.md.

### The framework refuses node's own file flags in NODE_OPTIONS, so a start script cannot load one

The web app is a workspace inside a monorepo whose one settings file sits at the
repository root, and the framework reads settings files from the application
directory. The obvious fix, putting node's `--env-file-if-exists` flag in front
of the start script, builds for about a second and then fails:

    Error: Initiated Worker with invalid NODE_OPTIONS env variable:
    --env-file-if-exists= is not allowed in NODE_OPTIONS

The framework spawns build and render workers and passes the parent's exec
arguments through NODE_OPTIONS, and node's allow list for that variable does not
include those flags (https://nodejs.org/api/cli.html#node_optionsoptions, read
2026-09-05).

The documented alternative, an `instrumentation.ts` with `register`, works but is
compiled for the Edge runtime as well as node, and `process.loadEnvFile` there is
reported as "a Node.js API is used which is not supported in the Edge Runtime"
followed by "Ecmascript file had an error" on every recompile, whether the call
is guarded by `NEXT_RUNTIME` or hidden behind a dynamic import.

What works and is quiet is to read the file in the one module that needs a
secret, which is only ever loaded on the server. `process.loadEnvFile` is on the
global, so that module has no node: import for the Edge build to see.

### A workspace whose entry point is TypeScript with ".js" specifiers cannot be imported through its barrel

`@creance/client` is TypeScript source with `"main": "src/index.ts"`, and its
barrel re-exports with explicit `.js` specifiers, which is correct for the
TypeScript runtime the API and its scripts use. The web app's bundler resolves
those specifiers literally, finds no `.js` file beside the `.ts` one, and fails
the build with a module-not-found for every line of the barrel.

Importing the concrete modules instead, `@creance/client/src/x402/payer` and
`@creance/client/src/hedera/keys`, resolves and builds: neither of those two
files imports anything else inside the package, so the barrel is the only thing
with a `.js` specifier on the path. The alternative, giving the workspace a build
step and a `dist`, is a change to a package four other workspaces depend on and
buys nothing else today.

## T20, the Hedera Harness, 5 September 2026

### The mirror node rejects the SDK transaction id form, it does not answer nothing

The T08 note above says pasting the `@` form "returns nothing at all rather than
an error". That is true of HashScan's transaction route and false of the mirror
node's REST API, which was read again on 5 September 2026 while building the
Harness contribution:

    GET /transactions/0.0.10362512-1788608475-314442638   200
    GET /transactions/0.0.10362512@1788608475.314442638   400
      {"_status":{"messages":[{"message":"Invalid Transaction id. Please use
       \"shard.realm.num-sss-nnn\" format where sss are seconds and nnn are
       nanoseconds"}]}}

Both forms are still a trap for the same reason, because an id copied out of an
app's receipt panel is in the `@` form and the app author has no reason to
suspect it, but the failure mode differs by reader: the mirror node says exactly
what is wrong, HashScan renders an empty page. The Harness PR normalises before
it reads and treats a 400 as the caller's mistake rather than as lag, since a
malformed request never comes right by waiting.

### Tier 3.5 verifies effects through a mirror node the harness has no code for

hedera-harness at `dev`, 2.0.0-rc.4, read on 5 September 2026. `src/types.ts`
describes CHAIN as "verify txs via mirror node" and
`docs/authoring-a-recipe.md` as verifying "against the mirror node rather than
UI toasts", but no file under `src/` reads it: the only `fetch` in the tree is
the dev-server health probe in `src/validation/devServer.ts`. What ships instead
is `prompts/validator.md`, which hands the evaluator agent five endpoints and
the sentence "Poll up to ~30s for mirror lag". Two of those endpoints are wrong
for the question the prompt asks of them. `GET /api/v1/topics/{topicId}/messages`
is listed for verifying a message landed, and it answers 200 with an empty list
for a topic that was never created, so thirty seconds of polling it cannot
distinguish a typo in a topic id from a message still in flight. Nothing in the
prompt mentions the two transaction id forms.

### A freshly created account's mirror node visibility is a race, not a delay

`provisionChainSigner` returns as soon as `AccountCreateTransaction` has a
receipt, and the scaffold it hands that account to resolves the account id from
the EVM alias through the mirror node. Whether the first read finds it is a
coin toss. Two runs of the same script, minutes apart on 5 September 2026:

    account 0.0.10377496   GET /accounts/0.0.10377496 -> 404, then 200 after 946ms
    account 0.0.10377504   GET /accounts/0.0.10377504 -> 200 on the first read

The one that intermittently loses is worse than one that always loses, because
the failure reads as a flaky app rather than as a missing wait. The same is true
of the topic message read, which was 404 on the first attempt in every run
measured and 200 roughly a second later. Waiting for the account before the run
goes on is what the Harness PR changes.

## T12, the oracle worker, 5 September 2026

Measured against Hedera testnet on 5 September 2026, during the replay of real
BLS history for ODI-COMP-2026-01 recorded in docs/HEDERA.md.

### The contract does not ignore a duplicate observation, it reverts three ways

docs/INDEX-SPEC.md section 6 says "The contract ignores a second submission for
the same (group, period)". CoverPool does not. All three of the following are
`eth_call` results against the deployed pool at
`0x6358ddd5AA2e1797ddA949D7d82eA86C9F89ff09` after the April 2026 submission,
so they are what a rerun actually meets:

    resubmit 2026-04, already present
      ObservationExists(0x4f44...0100, 202604)
    submit 2026-03, submitted earlier in the same run
      ObservationExists(0x4f44...0100, 202603)
    submit 2025-10, never submitted and behind the last observed month
      PeriodNotAfterLast(0x4f44...0100, 202510, 24315)
    submit 2026-12, a month that has not started
      PeriodInFuture(0x4f44...0100, 202612)

The presence check runs before the ordering check, so a month that is both
present and behind reports `ObservationExists`. The specification's sentence is
the one that is wrong, and the contract's behaviour is the one to keep: silently
ignoring a resubmission would hide a bug in the worker.

Idempotence is therefore the worker's job, not the contract's. Before each call
the oracle reads `observationOf(seriesId, period).present` and
`seriesOf(seriesId).lastObservedMonth`, and treats an existing observation as
done rather than as an error. The specification should be corrected to say so.

### Without error fragments in the ABI, ethers reports "unknown custom error"

A hand written narrow ABI that carries only the functions and events decodes a
revert as `execution reverted (unknown custom error)` and nothing else, which is
useless in a run log. The four `error` fragments cost nothing to add and are
what turns a failed submission into a sentence. Worth doing on every hand
written fragment list in this build.

### The first submission on a series costs 15 percent more than the rest

Measured over thirteen `submitObservation` calls on the same series:

    first submission, 2025-01              127,525
    every later non-opening month          110,451 to 110,841
    the opening month, 2026-04             253,941

The first call writes `lastObservedMonth` from zero, which is a cold storage
slot. docs/HEDERA.md records 271,024 for an opening month, measured on the T04
smoke series; the 253,941 here is the same call on a series whose
`firstOpenMonth` and `windowEndsAt` were also being written for the first time
but whose `activeExposure` was already non-zero. Both are comfortably inside the
1,000,000 limit this build uses, and the spread is the reason the limit is
explicit rather than estimated.

### Sixteen HCS messages and thirteen contract calls cost 1.79 HBAR

The oracle account went from 14.4093 to 12.6181 HBAR over the whole replay. The
contract calls dominate: the messages are a fraction of a tinybar each at
roughly 553 to 571 bytes. Budgeting one HBAR per ten submitted months is
generous and correct.

### A signed observation is 553 bytes, not near the 1 KB cap

DESIGN.md 4 warns that HCS messages are capped at roughly 1 KB. With the compact
provenance form, a v2 observation carrying both thresholds, both measured
values, the opening decision, the model version, a 64 character source hash and
a 130 character signature is 553 bytes for a final month and 571 bytes for the
longest, `insufficient_history`. The margin is real: the array form of
`source_files` from docs/INDEX-SPEC.md section 7 would not have fitted with the
archive's seven files, which is what forced the choice recorded in
docs/DECISIONS.md.

### The collection gap switches the jump QA gate off for fifteen months

docs/INDEX-SPEC.md section 8 asks for five standard deviations of the trailing
24 months. October, November and December 2025 have no smoothed excess for any
group, so no target month from 2025-10 to 2026-09 has 24 values in its trailing
window, and a literal reading of the gate abstains for fifteen consecutive
months including both months the demo settles on. The window stays 24 calendar
months and the gate now runs on whatever those months collected, with a floor of
twelve values. This is a specification bug that only shows up against real data
with a real hole in it, and it is the kind of thing a fixture-only test suite
never finds.

### The keyless BLS allowance is 25 requests a day and it runs out

Confirmed again on 5 September 2026, the second time this build has hit it. The
API answers HTTP 200 with `"status":"REQUEST_NOT_PROCESSED"` and the message
"the daily threshold for total number of requests allocated to the user with
registration key has been reached", with the key name left blank because there
is no key. The status code is 200, so a client that only checks the code treats
an exhausted allowance as data.

Two things worked as they should. The client retried four times and then failed
with the source's own sentence rather than a stack trace, and `pnpm oracle:once`
failed before the compute step, so nothing was published and nothing was
submitted. The fallback is `--source archive` or `--source cache`: the same
pipeline over the committed snapshot, and the source hash in every message says
which rows were used.

The allowance is pooled across everything sharing the address, so a second
process on the same host spends it too. Register a key before relying on the
live path on demonstration day.

### A replay from 2019-01 trips the jump gate on April 2020, and rightly

`pnpm oracle:replay --from 2019-01` is the command the ticket's acceptance text
names. It does not replay historical months: it stops at 2020-04 with

    jump: management_business_financial moved 2.17 against 0.95,
          service moved 4.03 against 0.99,
          computer_math moved 3.03 against 2.00,
          legal moved 2.67 against 1.67,
          business_financial_ops moved 2.26 against 1.17

Five groups past five standard deviations of their own trailing 24 months, in
the month United States unemployment went from 4.4 to 14.7 percent. The gate is
doing exactly what docs/INDEX-SPEC.md section 8 asks of it, and the frozen
calibration already excludes 2020 and 2021 from the sigma window for the same
reason. Nothing here is a bug in the gate or in the data.

What was a bug is what the worker did about it. The gates originally ran period
by period as the walk proceeded, so this run published fifteen months to the
settlement topic and then exited 1 on the sixteenth. An HCS message cannot be
retracted, and the first value published for a period settles it forever, so
half a window on the topic is not a state anything can recover from.

The gates now run over the whole window before the first message is published. A
window that cannot finish publishes nothing, and the command names the month it
stopped at and the longest window that would have run, which for 2019-01 is
`--to 2020-03`. The gates stayed non-overridable: there is no flag that
publishes a month that failed one, because a settlement value that a gate
rejected is worse than no value.

The windows that do complete are in README.md. The lesson generalises past this
build: any pipeline that writes to an append-only log a period at a time has to
validate the whole run first, because per-item validation plus an unretractable
write is a partial-failure mode with no cleanup.

### There is no transaction spanning an HCS submit and an EVM call, and the ordering has to carry the whole recovery

An observation is two writes to the same network: a `TopicMessageSubmitTransaction`
that publishes the signed message, and a `submitObservation` call through the
relay that carries the sequence number the first one returned. They cannot be
one transaction. The consensus service and the EVM are separate services, the
second write needs a value only the first can produce, and neither can be
rolled back once it lands.

That leaves the ordering as the only recovery mechanism, and it is easy to get
wrong in a way that looks fine. This build originally wrote its local record of
a published observation after both network calls returned. A contract call that
threw, an RPC timeout or an unexpected revert, then left a message permanently
on the settlement topic with nothing recording that it existed, and the next run
over the same window republished the period. Two messages for one month, and if
the source had been revised between the attempts they would carry different
values with nothing linking them.

The record is now written between the two calls, as soon as the topic receipt is
in hand and before anything that can throw. A run that dies in the contract call
leaves a row with `hcs_seq` set and `submit_tx` null, and the next run
republishes nothing and does the contract call alone, resubmitting the sequence
number and source hash of the message actually on the topic rather than
recomputing them.

One window remains and it cannot be closed on this side: a process killed
between the topic receipt and the local write leaves a message with no row. The
only fix is to read the topic back through the mirror node before republishing a
period, which needs a runs table to know which periods a previous run was in the
middle of, and that is T26's.

The general shape is worth stating for anyone integrating the two services:
**any write to HCS that a later EVM call depends on needs its durable local
record between them, not after both.** The same applies in reverse to a contract
call whose result is then published to a topic.

## T09, the Steward agent, 5 September 2026

### A schedule's own admin key public key has to be handed in, not the private key

`ScheduleCreateTransaction.setAdminKey` on the SDK's own create page shows a
public key going in, and it is easy to reach for the payer's `PrivateKey`
object instead, because `PrivateKey` also satisfies the `Key` type the setter
takes and the compiler says nothing. It still runs: the create succeeds and the
schedule is genuinely admin-keyed, so nothing looks wrong until a
`ScheduleDeleteTransaction` is tried later signed with a key that turns out not
to match what was actually recorded. Passing `key.publicKey` explicitly, as
`createPremiumSchedules` in apps/steward/src/chain.ts does, is the one line
that avoids the confusion; the page does not call out that the setter accepts
both types and only one of them is the one meant.

### The compressed demo cadence needs the schedule create itself accounted for

`--cadence demo` with a 90 second interval plans the first premium 90 seconds
out from the moment the plan is built, but three schedules are created one
after another and each create itself takes one to two seconds of consensus
time. On a run made against a busier testnet moment, the gap between "planned"
and "created" can eat into the interval enough that a naive implementation
would compute `executeAt` once and then create schedules whose due dates are
uncomfortably close to the create's own consensus timestamp. `premiumPlan`
takes one `createdAt` for the whole plan rather than re-stamping it per
schedule, which keeps the three due dates evenly spaced regardless of how long
the creates themselves take.

### An index reading that is genuinely falling is the ordinary case, not the exception

The archived history for the demo group, computer and mathematical, ends at
2026-07 with three months of ODI 0.07, -0.13, -0.07: falling. A Steward run with
no options against the live archive returns "hold" every time, honestly, which
is the correct behaviour and not a bug to work around. Proving the "buy" path
for the acceptance transcript needs an explicit `--as-of` vantage into a month
where the same published series was rising (July 2024, 0.27, 0.40, 0.60), which
is why the option exists and why the run labels it as a replay rather than
silently picking a favourable month.

## T25, the Adjuster, 5 September 2026

### The claims topic accepted its first message on the first attempt

`pnpm --filter @creance/adjuster testnet:publish` wrote sequence 1 to topic
0.0.10366473 with the adjuster account 0.0.10366452's key, derived from the
operator key with the label `creance/testnet/adjuster` and never stored. No
discrepancy: the submit key recorded in docs/HEDERA.md is the key that opens the
topic, the receipt carried the sequence number, and the mirror node returned the
message five seconds later. The version 1 `claim_decision` message comes to 258
bytes, comfortably inside the roughly 1 KB an HCS message carries.

### `output_config.effort` accepts five levels, not the three the docs list

The Claude structured outputs and models documentation describes `effort` as low,
medium and high, with high as the default. `@anthropic-ai/sdk` 0.124.0's
`OutputConfig` type declares `'low' | 'medium' | 'high' | 'xhigh' | 'max' | null`.
Nothing breaks: medium is what this build sends and it is in both lists. It is
recorded because a reader comparing the SDK's types against the prose page will
find two answers, and the SDK is the one the compiler enforces.

`effort` also sits inside `output_config`, beside `format`, rather than at the
top level of the request. That is easy to get wrong from memory and the type
catches it, which is the argument for `messages.parse` with `zodOutputFormat`
over a hand-built request body.

### `zodOutputFormat` renders a nullable string in a form the API accepts

The structured outputs schema subset forbids a good deal, so the open question
before writing the extraction schema was whether `z.string().nullable()` survives
the round trip. It does: every one of the schema's twelve nullable fields is
declared that way and the live extraction against the committed packet A letter
returned a record that parsed. No empty-string sentinel is needed and none is
used.

The subset does not support `minimum` or `maximum`, which the documentation says
plainly, so every confidence the model returns is clamped in code at the
boundary rather than assumed to be in range. That is one function and it is worth
having: a schema that cannot express a range is a schema whose ranges have to be
enforced somewhere else.

### A PDF with no `/Type` on the trailer is still read as a PDF

The fixture documents are rendered by a hand-written eighty line PDF writer
rather than a library, which produces a minimal PDF 1.4: a catalog, a pages node,
one page, a flate-compressed content stream and two Type1 font objects. It reads
correctly in `pdftotext` and the model read every field off it. The only thing
worth recording is that the magic-byte check the Adjuster does before sending a
file is on `%PDF-` and nothing more, because a stricter structural check would
reject documents that ordinary tools accept.

### The mirror node has no read-back gap worth waiting out on a topic message

The message published at consensus timestamp 1788617265.386050104 was returned by
`GET /topics/0.0.10366473/messages` about five seconds later. Earlier tickets have
recorded longer waits for contract state; a topic submit's receipt already carries
the sequence number, so nothing in this flow has to poll the mirror node at all,
and the read-back here was a check rather than a dependency.

## T13, the two-key claim flow, 5 September 2026

### No policy this build had bound could ever have been paid

`CoverPool.bind` takes `startAt` from the caller and does not validate it, and
`POST /v1/bind` sets it to the moment of binding. Every policy on the demo
series was bound on 4 or 5 September 2026, so every waiting period ends around
4 November. The loss window the replayed history opened is separations in
2026-02 to 2026-04, and the claim window closes 2026-10-05T09:04:51Z. Those two
facts cannot both be satisfied by any policy this build had: `payClaim` reverts
`SeparationInWaitingPeriod` for any separation inside the window, and no
separation after the waiting period can be inside the window before it closes.

This is not a contract fault. It is what happens when a replayed history meets
policies bound today, and it is the sort of thing a demo discovers late. The
answer was a testnet script that binds one policy with a start date in the past
and says so, recorded in docs/DECISIONS.md.

### A policy bound during ClaimsOpen raises the exposure but not the reserve

The reserve is taken and topped up inside `_openMonth`, which runs on an
observation. `bind` raises `activeExposure` and touches neither
`exposureCovered` nor the vault's reserve. So the two policies bound for this
run took `activeExposure` from 13,000,000,000 to 15,000,000,000 while
`reservedOf` stayed at 3,000,000,000, and the claim that was paid drew on a
reserve that had been taken for the three policies exposed when April opened.

The invariants hold and nothing is at risk: `exposureCovered` is decremented by
the paid policy's limit and stays non-negative, and the vault checks the reserve
covers the amount. It is written down because the numbers do not read as
obviously consistent and the next person to look at them will wonder.

### `eth_getTransactionReceipt` gas for `payClaim` is higher on a series with history

The measured figure in docs/HEDERA.md was 172,689, taken on a throwaway series
with one open month. The same call on the demo series used 189,772. The
difference is the loss window walk and the longer open month list. Both are far
under the explicit 1,500,000 limit, which is the reason to set an explicit limit
rather than trusting an estimate.

### The relay reports a contract call's transfers under a different transaction

`payClaim` moves an HTS token through the vault. The EVM transaction hash
`0x8fc85b62...` resolves through `/api/v1/contracts/results/{hash}`, but the
token transfer itself is a child `CRYPTOTRANSFER` under the relay's own
`ETHEREUMTRANSACTION`, `0.0.7314364-1788622687-466086807`. A reader looking for
the transfer on the EVM hash alone finds nothing. Both ids are recorded in
docs/HEDERA.md for that reason.

### A claim that is paid is no longer a claim that is waiting to be published

Found on the first testnet run and fixed in the same session. The Adjuster's
sweep listed the decisions whose hash had not reached the topic by looking at
`under_review`, `approved` and `declined`. An approval is paid inside the same
request it arrives in, so by the time the sweep ran the claim was `paid` and its
decision hash was invisible to it: the one decision that moved money was the one
whose hash never became public. `paid` is in the list now, and the ordering the
whole trail depends on survives the payout happening quickly.

### An open Hiero SDK client keeps a command alive after its work is done

`pnpm --filter @creance/api claims:close-windows` reads the chain, prints and
ends, and it hung. `buildServices` constructs a `SdkHederaGateway` whenever the
keys are present, and its gRPC connections hold the event loop open. The job
writes no topic message, so it passes `hedera: null` and exits. Any command
built on `buildServices` that does not publish should do the same.

## T21, the public deployment, 5 September 2026

### A blank line in an environment file erases a value baked into the image

`ENV GIT_SHA=$GIT_SHA` in a Dockerfile puts the build's commit in the image.
Starting that image with `--env-file` pointed at a file carrying `GIT_SHA=`
replaces it with the empty string, not with the image's value: the file wins and
a blank entry is still an entry. Measured directly:

    printf 'GIT_SHA=\n' > /tmp/probe.list
    podman run --rm --env-file /tmp/probe.list creance-api \
      node -e 'console.log(JSON.stringify(process.env.GIT_SHA))'
    ""

`.env.example` shipped `GIT_SHA=` blank, so every deployment reading the
repository's own file would have served a health endpoint with an empty commit,
which is the one field the endpoint exists for.

The first fix was wrong in an instructive way. Re-setting `GIT_SHA` in the
service's `environment:` block does beat `env_file`, so the blank stopped
winning, but a runtime value beats the image's own `ENV` too, and what the
endpoint then reported was the commit the deploying shell was standing on rather
than the commit the running image was built from. Those agree after every deploy
that rebuilds and disagree after exactly the deploy worth catching, so the
endpoint was confidently answering the wrong question. What is in now: the name
is a build argument and nothing else, no service sets it at runtime, the name is
gone from `.env.example`, and `deploy/deploy.sh` refuses a configuration file
that carries it. The API still reads a blank value as `unknown`, so any
remaining path to the failure is legible rather than silent.

### `.env.example` cannot be copied verbatim: a blank there is a value, not an absence

Copying `.env.example` unedited into a deployment and starting the API gives

    Error: no deployment record at : run pnpm contracts:deploy first

`loadApiConfig` reads `process.env.CREANCE_DEPLOYMENT_RECORD ?? <the default>`,
and `??` only falls back on `undefined`. A file that carries the name with an
empty value hands the process an empty string, which is a path, so the documented
default never applies. The comment beside it in `.env.example` says the value
defaults to `contracts/deployments/testnet.json` and that you set it only to
point somewhere else, so the file and the code disagree about what blank means.

The same shape is all over that function: `HEDERA_COVERPOOL_ADDRESS`,
`HEDERA_SETTLEMENT_TOKEN_ID`, `HEDERA_SERIES_ID` and the topic ids all read
`process.env.X ?? <the record>`, and a blank line for any of them shadows the
deployment record the same way. It is not specific to the deployment and it is
not new here, so nothing in T21 changed it: fixing two of a dozen would suggest a
blank file works right up until the next one. What T21 does is stop relying on
it. `deploy/README.md` says the production file is `.env.example` filled in, and
`GIT_SHA` was removed from `.env.example` outright rather than left blank, which
is the one case where a blank line would have overridden a value baked into an
image rather than a value read from a committed file.

### podman-compose runs no build at all for `up -d --build` when the containers exist

A redeploy at a new commit came back reporting the old one:

    deploy: http://localhost:13000 at 9e406cfd7bafea9ed8a65cbdebae6ea82ef73118
    deploy: GET /health reports a32b63573fe6bcc3a268ca04c235b33d15c0c33a, not
    9e406cfd7bafea9ed8a65cbdebae6ea82ef73118. A stale image is running.

The build log for that run has zero `STEP` lines in it. podman-compose 1.0.6
with containers already present does not build and does not recreate; it starts
what is there, and `--build` is ignored. Docker Compose rebuilds and replaces the
container when the image changes, so this is a difference between the two
runtimes and not a compose file mistake.

Adding `--force-recreate` fixes it, and the same run then reports the new commit
and exits 0. `deploy/deploy.sh` passes it on every rebuilding deploy and the
README shows it in the compose command, because a second `up -d --build` in a
session is exactly when the flag matters and exactly when it is easy to omit.

Worth saying separately: the stale image was caught rather than shipped. The
check that compares `GET /health` against `git rev-parse HEAD` is what turned an
invisible no-op redeploy into a non-zero exit with both commits printed.

### podman does not invalidate an `ENV` layer when its build argument changes

The Dockerfile reference is explicit that an `ARG` whose value changes
invalidates the cache for the instructions after it that use the value. podman
4.9.3 does not do that for `ENV`. With

    ARG GIT_SHA=unknown
    ENV GIT_SHA=$GIT_SHA

two builds of the same source at different commits produce two images carrying
the same commit, the first one:

    podman build --build-arg GIT_SHA=aaaabbbbccccdddd -t probe .
    podman inspect probe --format '{{range .Config.Env}}{{println .}}{{end}}' | grep GIT_SHA
    GIT_SHA=e639a0ba2747e2c801478f7a855b07b5a81ae97d

That is worse than a blank value: the health endpoint answers with a real commit
that is not the commit in the image, and nothing about the output looks wrong.
A `RUN` carrying the value in its command text does have the value in its cache
key, so putting one in front of the `ENV` rebuilds the `ENV` and everything after
it. Both images now do:

    ARG GIT_SHA=unknown
    RUN echo "$GIT_SHA" > /repo/.git-sha
    ENV GIT_SHA=$GIT_SHA

and two builds at two commits produce two different baked values.

### A `.dockerignore` pattern without `**/` matches the context root only

A bare `node_modules` line excludes `/node_modules` and nothing else. In a pnpm
workspace that leaves `apps/api/node_modules` and `packages/*/node_modules` in
the context, and the `COPY apps/api apps/api` that follows the install
overwrites the `node_modules` the install had just created with the host's tree
of symlinks. The image built and started, and the damage was one missing binary
in `node_modules/.bin`, which would have surfaced as an unrelated failure later.
Every pattern that can appear inside a workspace needs `**/`, and the way to
check is to look inside the image rather than at the build log:

    podman run --rm creance-oracle ls /repo/apps/oracle/node_modules/.bin

### Turbopack reports a missing root tsconfig as one that "doesn't resolve correctly"

`next build` inside a container whose context did not include
`tsconfig.base.json` fails with:

    ./apps/web/tsconfig.json
    Error: An issue occurred while parsing a tsconfig.json file.
    extends: "../../tsconfig.base.json" doesn't resolve correctly

The file it names is the one that is present. Nothing in the message says the
extended file is absent, which sends you looking at path aliases and module
resolution rather than at the copy list. Any image that builds one workspace of
a repository with a shared base config has to copy that base config in.

### podman-compose lets the project's configuration file shadow the shell

The compose specification is explicit that values in the shell take precedence
over those in the project's environment file. podman-compose 1.0.6 does the
opposite. `compose.yaml` carried `GIT_SHA: ${GIT_SHA:-unknown}` and
`deploy/deploy.sh` exported `GIT_SHA` from `git rev-parse HEAD`; the deployment
came up reporting

    {"status":"ok","sha":"unknown", ...}

because the file being read for substitution carried `GIT_SHA=` blank, which
`:-` then treated as absent. The exported value was never consulted. The same
compose file against a configuration that does not mention `GIT_SHA` at all does
read the shell, so this is precedence and not a missing feature.

Renaming the substitution to a name no configuration file defines,
`CREANCE_GIT_SHA`, fixes it, and fixes it on both runtimes rather than depending
on which one the host has. The lesson generalises: a compose substitution that
has to come from the deploy command rather than from the operator's
configuration needs a name that configuration never uses.

### podman-compose flattens an exec form health check and loses the quoting

    healthcheck:
      test: ['CMD', 'node', '-e', "fetch('http://127.0.0.1:3210/health')..."]

is an exec form test, which the compose specification says is run without a
shell. podman-compose 1.0.6 joins the array back into one string and hands it to
`/bin/sh -c`, and the quotes do not survive the trip:

    podman inspect creance_api_1 --format '{{json .State.Health}}'
    ..."ExitCode":1,"Output":"/bin/sh: 1: Syntax error: \"(\" unexpected"

The container answered `GET /health` with 200 throughout. Only the check was
broken, and the symptom is a service stuck at `starting` with a rising failing
streak, which reads like a slow boot rather than a mangled command. Anything
depending on `condition: service_healthy` waits forever.

The fix is a health check with no shell metacharacters in it at all:
`apps/api/scripts/healthcheck.mjs` does the fetch and the compose test is
`['CMD', 'node', '/repo/apps/api/scripts/healthcheck.mjs']`. That works on both
runtimes, whether or not the array is flattened.

### A configuration file value keeps an inline comment

A value written as `FOO=bar   # trailing note` reaches the process as
`"bar   # trailing note"`, comment and all, measured by starting the API image
against a one line probe file and printing what the process saw. A `.env`
written by hand with the comment beside the value, which is a natural thing to
do, would have given the API a `PUBLIC_SITE_URL` with a comment in it, and that
origin goes into every issued credential and every x402 resource URL.
`.env.example` keeps comments on their own lines and `deploy/deploy.sh` refuses
to deploy a file that does not.

## T16, the claim screens, 5 September 2026

Four disagreements between what a document says and what the running system
does, all four found by building the screens that read them and all four
reproduced on this host against the local API and Hedera testnet.

### `testnet:bind-backdated` printed the waiting period and stored the start date

`pnpm --filter @creance/api testnet:bind-backdated` computes
`payableFrom = startAt + waitingPeriodSeconds`, prints it as "claims payable
from 2026-01-30", and then wrote `startAt` into the `claims_payable_from`
column. `POST /v1/bind` writes the computed value, so the two paths disagreed
about the same field.

Measured on the first policy this ticket bound:

    script output      claims payable from 2026-01-30
    GET /v1/policy/:id "claims_payable_from": "2025-12-01"

Nothing on chain was wrong: `payClaim` reads the waiting period from
`CoverPool` and would still have reverted for a separation inside it. What was
wrong was the screen. Home's Claims open state prints "If you lost your job on
or after {claims_payable_from}, you can claim {limit}", so the app invited a
claim from a date on which no claim could have been paid, and C1's "in the
first {n} days of cover" read 0 days. Fixed in the script, and the two policies
this ticket bound afterwards read 2026-01-30.

### A series stays open for claims after its index falls back under the line

The demo series opened in April 2026 and the claim window runs to 5 October
2026. The latest published month is July 2026, which reads 0.69 points short of
the level line. So `GET /v1/policy/:id` answers `claims.open: true` and
`claims.reading.open: false` at the same time, and both are correct: the chain's
`seriesOf` status is the index key and the reading is the latest month.

That is not a bug in either, but a screen that prints the amber "Claims open"
pill over the words "Points from opening claims" contradicts itself. Home now
prints the reading as it stands and takes the caption from the cover's own
answer. Anything else that pairs a pill with a reading has the same choice to
make.

### `GET /v1/replay` labels a replay REPLAY, and the copy deck says "Replay: Jul 2026"

The endpoint's `badge.label` is the single word `REPLAY`; `badgeFor` in
apps/api/src/replay/state.ts composes it and carries no month.
docs/DESIGN-TOKENS.md section 8 fixes the string as "Replay: Jul 2026". The
month is in the same payload as `current_period`, so the web app composes the
deck's label from the two rather than printing the endpoint's. Measured:

    GET /v1/replay -> {"mode":"replay","current_period":"2026-07",
                       "badge":{"show":true,"label":"REPLAY"}}
    screen         -> Replay: Jul 2026

In scenario mode the label is the scenario's own name and is printed as it
stands, which is what the endpoint already intends.

### A soft rule's sentence reads as a referral on a screen that says no

The Adjuster composes one sentence per reason code, and the sentence for a soft
rule is "Someone will look at your claim." Packet B declines on
`separation_type_not_covered` and also carries `evidence_seen_before`, because
the committed fixture had been submitted before, so the decline arrives with
two sentences:

    Resigning isn't covered. This cover pays when your employer ends your job.
    Someone will look at your claim.

The second is true of the rule and false of the decision. The web app prints
`reason_lines` verbatim, as docs/CLAIMS.md requires, so this was not fixed on
the screen: the composition belongs to the Adjuster, and a decided claim should
not compose the referral sentence for a rule that did not decide it.

### The api account ran out of HBAR for `payClaim` and the failure is a decode of the raw transaction

The approval's payout refused with `insufficient funds for intrinsic
transaction cost` and a 500 byte hex transaction in the message. The account
held 2.14 HBAR and the call carries an explicit 1,500,000 gas limit, which at
the relay's quoted price is about 3.3 HBAR reserved before execution, so the
check fails before any gas is spent. The decision stood, the authorisation was
stored, and pressing Approve again after the account was funded paid it, which
is the retry path `POST /v1/admin/claims/:id/decide` is written for. Worth
knowing twice over: the error names neither the account nor the shortfall, and
a payout that refuses for an environmental reason is not a payout that failed.

## T19, the Bazantic gateway and the index topic, 5 September 2026

Read while writing the two recipes, which consume the index topic through the
mirror node and the same months again through the paid feed. Every measurement
below is from the live testnet topic 0.0.10366470 and the running API on
5 September 2026.

### A published observation can carry a status the specification does not list

docs/INDEX-SPEC.md section 7 gives `status` as `final | insufficient_history |
revision`. The topic also carries `no_source`:

    sequence 10, computer_math 2025-10
    {"status":"no_source","u_g":null,"u_all":null,"e":null,"ebar":null,"odi":null,...}

October 2025 was never collected by the source, so the month is published with
nulls and a status that says why, which is the right behaviour and the right
message to publish. The specification is what is out of date, not the oracle. A
consumer written from section 7 alone would treat `no_source` as an unknown
status or, worse, read the nulls as zeroes.

Both recipes therefore check `status === 'final'` rather than checking that the
message is present, and say what the other statuses mean.

### The newest message on the topic is not the newest month

The mirror node returns topic messages ordered by consensus timestamp, which is
what its documentation says it does
(https://docs.hedera.com/hedera/sdks-and-apis/rest-api). The trap is on our
side: the oracle publishes a backfill in the order it computes months, so
consensus order and period order are different orders on the same topic.

    sequence 27  computer_math  2026-07
    sequence 33  computer_math  2026-06     published six messages later

An agent that filters by group and takes the first message of an `order=desc`
page gets 2026-06 and believes it is current. Both recipes sort the group's
messages by the decoded `period` and take the last one, and say why in the step
rather than in a footnote.

### One topic carries all fifteen groups, so a page is about six months deep

There is no server-side filter on message content. `limit` is capped at 100, so
one page holds roughly six months of any single group once every group is
publishing monthly. `links.next` pages backwards with a `timestamp=lt:` filter,
and `sequencenumber=lt:{n}` also works on this collection and is easier to
reason about when the caller is walking one group backwards. Both were measured:

    GET /api/v1/topics/0.0.10366470/messages?limit=5&order=desc
      -> links.next = ...&timestamp=lt:1788599782.975896253
    GET /api/v1/topics/0.0.10366470/messages?limit=3&order=desc&sequencenumber=lt:20
      -> sequence 19, 18, 17
    GET /api/v1/topics/0.0.10366470/messages/27
      -> 200, the single message

### The same reading is a number on the topic and a decimal string on the API

The observation on the topic carries JSON numbers (`"ebar":-1.37`). The API
carries decimal strings (`"ebar":"-1.37"`), deliberately, because the thresholds
are int64 scaled by 1e4 on chain and a float round trip through JSON is how a
build publishes a number the contract did not compare against.

A month with claims closed also differs: `open_reason` is `"none"` on the topic
and `null` from the API, which is the column's own convention
(`open_reason text CHECK (open_reason IN ('shock','level','both'))`, null when
closed, in apps/api/migrations/001_init.sql).

Neither is a fault, and both are exactly the sort of difference that makes a
naive cross-check between two surfaces fail on a correct pair of answers. The
recipes compare numerically and treat `"none"` and `null` as the same answer.

### The x402 gate runs before the route, so a bad group is refused with 402

    GET /v1/index/nonsense   ->  402, PAYMENT-REQUIRED, not 400 group_unknown

The gate is an `onRequest` hook and the handler validates the group, so an
unknown group is a paid mistake rather than a free one. That is the right order,
because a free validity oracle in front of a metered feed is a way to avoid
paying for it, but it is not what a reader of the OpenAPI document would assume
from a documented 400. The document now says so on the operation.

## T23, the clean clone run-through, 5 September 2026

### The observation store cannot tell a clean clone what already settled

`pnpm oracle:replay` guards against publishing a period twice by looking it up
in the observation store, which is `var/oracle/observations.json` and is
gitignored. A clone has no such file, so on a fresh machine every month of the
demo window looks unpublished and the run would put a second message on the
shared index topic for each one. Measured: the topic carried the demo series
from 2025-01 to 2026-04, and a clean clone's replay walked all nineteen months
reporting `skipped 0 already published`.

docs/INDEX-SPEC.md says the first value published for a period settles it
forever, so a second message for a settled month is the failure the whole
specification is written against, and the on chain guard does not catch it: the
contract refuses the duplicate submission, but HCS has already taken the
message and an HCS message cannot be retracted.

The pipeline's own header comment named this and deferred it to T26 as a job
needing the runs table. It does not need the runs table. The commands now read
the topic back through the mirror node before the walk starts and pass the group
months they find into the pipeline, which skips them. Verified from the clean
clone against topic 0.0.10366470: `published 0 messages, skipped 19 already
published`, with the local store deleted first so nothing but the topic could
have supplied the answer.

Skipping the publish must not also skip the settlement. A month can reach the
topic without its contract call, which is exactly the state a run interrupted
between the two leaves behind, and the message on the topic carries the value
and the sequence number the call needs. So a month found on the topic and not on
chain gets its contract call from the topic's own message.

### A blank line in the environment shadowed the deployment record

The T21 finding, measured again from the judge's own path rather than from a
deployment. `cp .env.example .env`, fill in the operator key and `DATABASE_URL`,
`pnpm dev`, and the API exits with

    Error: no deployment record at : run pnpm contracts:deploy first

`??` falls back only on `undefined`, and a name present with nothing after it is
the empty string. Twenty one reads in `loadApiConfig`, seven in the investor
configuration and nine in the oracle's had the same shape, so a copied example
also erased the settlement token, the four topic ids, both contract addresses
and the submission gas limit, which `Number('')` turns into 0. All of them now
go through a reader that treats blank as absent. The example environment says so
in its header, and `apps/api/test/config.test.ts` loads the real `.env.example`
with every line blank and asserts the configuration still resolves, so the file
and the code cannot drift apart again.

### Next.js dev refuses its own dev resources to an origin it was not opened on

`pnpm dev` serves the web app on localhost. Opening it on `http://127.0.0.1:3001`
instead loads every page and hydrates nothing: the search box does not filter,
the occupation rows do not select, and the only console message is a failed
websocket handshake to `/_next/hmr`. The reason is in `.next/dev/logs`, not in
the browser:

    Blocked cross-origin request to Next.js dev resource /_next/hmr from
    "127.0.0.1". Cross-origin access to Next.js dev resources is blocked by
    default for safety.

127.0.0.1 and localhost are the same host and a different origin. Nothing in the
page says so, and a half-hydrated screen looks like a product bug. Open the web
app on the address the command prints, or add `allowedDevOrigins` to the Next
configuration. Nothing in this repository needed changing; the run-through
section of the README names localhost for this reason.

### The demo replay window was three months short of the topic

Reading the index topic back showed 2025-01 to 2026-04 for the demo series and
then the fifteen groups of the live 2026-07 run, with 2026-05 and 2026-06
missing. The demo narrative turns on May 2026 being an open month, so the gap
mattered. The clean clone's replay published both, with `--no-submit`, so the
topic now carries the whole window; their contract calls have not been made and
the next submitting run will make them.

## T28, the agentified index feed, 5 September 2026

### A trailing wildcard in an x402 route pattern also matches the bare prefix

The route map key `GET /v1/index/*` reads as "every path under `/v1/index/`".
It is not. `parseRoutePattern` in `@x402/core` 2.25.0 strips the trailing `/*`
and appends `(?:/.*?)?`, so the pattern compiles to `^/v1/index(?:/.*?)?$` and
the optional group makes the bare prefix match too:

    pattern  GET /v1/index/*
    regex    /^\/v1\/index(?:\/.*?)?$/is
    /v1/index/computer_math   ->  metered, correct
    /v1/index                 ->  metered, 402, not intended

Measured on a running server: the free catalogue at `GET /v1/index` answered 402
with the gate configured, and 200 with it off. The route map is the only place
that decided this, and nothing in the package README or the x402 documentation
says a trailing wildcard is optional rather than required.

The fix is one character class rather than a carve-out: the pattern is now
`GET /v1/index/:group`, which the same function compiles to `[^/]+` for the
segment and so matches one non-empty segment and nothing else. A test in
`apps/api/test/x402-routes.test.ts` holds the catalogue open with the gate on,
because this is a failure that only appears when payments are configured, which
is not the state most tests run in.

https://docs.x402.org/servers/quickstart

## T24, the demonstration seed and the shot list, 5 September 2026

### `closeWindow` emits no `Released` event when the reserve was spent

The last beat of DESIGN.md section 7 is the unclaimed reserve going back to the
noteholders, and the first run of `pnpm --filter @creance/contracts demo:release`
produced a `closeWindow` that succeeded, cost 45,063 gas and released nothing.

The cause is the contract behaving correctly and the run asking the wrong
question. `CoverPool.closeWindow` reads `vault.reservedOf(seriesId)` and calls
`vault.release` only when the remainder is greater than zero, so a series where
one policy was bound, its limit reserved and then paid out in full closes with a
remainder of zero, emits `WindowClosed(seriesId, 0, lastOpenPeriod)` and never
touches the vault. A consumer waiting for `Released` to confirm that a window
closed will wait forever on a series that paid out everything it reserved.
`WindowClosed` is the event to watch, and its `released` argument is where the
number is.

The run now binds two policies and claims on one of them, which is the shape the
demonstration actually has: the reserve is taken against every exposed limit
when a month opens, and what the claims do not use comes back.

### `pnpm exec` did not load the environment file that `pnpm run` loads

The root `pnpm demo:seed` was first written as `pnpm --filter @creance/api exec
tsx --env-file-if-exists=../../<the environment file> scripts/...`, on the
grounds that it needs no new line in the package's own manifest. `pnpm --filter
@creance/api exec pwd` prints the package directory, and the file is two levels
above it, so the relative path is right. tsx still reported it as not found and
the script ran with no credentials.

The identical tsx command line, declared as a script in the package manifest and
invoked through `pnpm --filter @creance/api run`, finds the same file from the
same directory and reaches both the database and testnet. The cause was not
established, and the working form is the one every other testnet command in this
repository already uses, so `pnpm demo:seed` delegates to a package script.
Anyone reaching for `pnpm exec` to avoid adding a line should check that the
environment actually arrived before believing a run that does nothing.

### `--filter` and a stage argument pass through, `--plan` does not need quoting

`pnpm demo:seed status` and `pnpm demo:seed --plan` both reach the script
through two layers of pnpm without any argument escaping. This is written down
because the surrounding commands are all single word scripts and it was not
obvious that a positional stage survives the hop; it does.

## T27, the World App Mini App surface, 5 September 2026

Everything this ticket met where World's documentation and its SDK disagree is in
the feedback document kept with the event record, which is where World friction
belongs. What follows is the one discrepancy that is not World's.

### `pnpm --filter <workspace> add` leaves every other workspace without dependencies

Adding one dependency to one workspace,

    pnpm --filter @creance/web add @worldcoin/minikit-js@2.0.3 --save-exact

resolved and linked that workspace and left the other eight projects with no
`node_modules` at all. Measured immediately afterwards: `apps/web/node_modules`
had 14 entries and `apps/api`, `packages/client`, `packages/index-model` and
`contracts` had none. The first thing that noticed was `tsc`, which failed in the
web app with `TS2307: Cannot find module 'ethers'` pointing at
`packages/client/src/claim.ts`, an error with nothing to do with the change and
no obvious link to the install.

A plain `pnpm install` afterwards restored all nine projects in seven seconds and
reported the lockfile already up to date, so nothing about the resolution was
wrong and only the linking was partial. Run `pnpm install` after any filtered
`add` in this repository before believing a typecheck or a test run.

## T26, index operations, 5 September 2026

### An x402 route pattern cannot express an exemption, and getRouteConfig is private

The reading route is metered as `GET /v1/index/:group`, which `@x402/core`
2.25.0 compiles to `[^/]+` for the segment. `health` is one non-empty segment, so
`GET /v1/index/health` is metered by the same pattern that meters
`GET /v1/index/computer_math`, and docs/INDEX-SPEC.md section 9 puts the
operations endpoint at exactly that path.

There is no way to write the exemption as a pattern. `parseRoutePattern` escapes
`[$()+.?^{|}]` before it builds the regex, so a negative lookahead is escaped
into a literal, and `*` becomes `.*?` rather than passing through.

The obvious extension point is not usable either. `getRouteConfig(path, method)`
is the function that decides, and it is declared `private` in the package's own
type declarations, so a subclass cannot override it without a type error.

What does work: `requiresPayment(context)` is public, it is the first thing the
Fastify middleware calls on every request, and the middleware returns
immediately when it answers false. Registering with `paymentMiddlewareFromHTTPServer`
and a subclass of `x402HTTPResourceServer` that overrides `requiresPayment` is
therefore the whole carve-out, and it is four lines:

    class CarveOutResourceServer extends x402HTTPResourceServer {
      override requiresPayment(context: HTTPRequestContext): boolean {
        const method = context.method ?? context.adapter.getMethod();
        if (isFreeUnderMeteredPrefix(method, context.path)) return false;
        return super.requiresPayment(context);
      }
    }

`context.method` is optional on the type and the middleware itself falls back to
`context.adapter.getMethod()`, so the override does the same.

Fastify's own router is not the problem: find-my-way matches a static segment
before a parameter, so `/v1/index/health` reaches its own handler and never the
reading handler. Both facts have a test.

https://docs.x402.org/servers/quickstart

### pnpm run passes a bare -- through to the script's arguments

`pnpm oracle:schedule -- --source archive` does not work. pnpm 11 forwards the
`--` itself, so the command becomes `tsx src/cli/schedule.ts -- --source archive`
and the parser sees `--` as an unknown argument and exits 1. The form that works
is `pnpm oracle:schedule --source archive`, with no separator, which is what
docs/INDEX-OPS.md and the usage text show.

## T29, the landing page, 6 September 2026

### Tailwind v4 resolves `text-*` against two namespaces, so one name cannot be both a size and a colour

The v4 theme documentation describes `--text-*` and `--color-*` as separate
namespaces and lists the utilities each one drives.
https://tailwindcss.com/docs/theme

What it does not say is that `text-<name>` is generated from both, so a theme
that declares `--text-landing-numeral` and `--color-landing-numeral` produces one
utility name with two meanings and the class silently sets whichever the
compiler resolved last. Measured against this build's own stylesheet: with both
declared, `text-landing-numeral` compiled to the font size and the colour never
appeared.

The fix is naming rather than configuration. The size is `--text-landing-step`
and the colour stays `--color-landing-numeral`, so the two utilities are
`text-landing-step` and `text-landing-numeral` and neither is ambiguous. Nothing
in the framework warns about the collision, which is why it is written down.

## T30, the three home card directions, 6 September 2026

The three directions change the card treatment and the typeface together, so the
gallery has to show three families in one build while the product ships one.
Both notes below come out of that.

### A custom property that substitutes another one resolves where it is declared

The token sheet declares the two type roles once, at the root:

    --font-display: var(--font-display-family), Inter, ...;
    --font-text:    var(--font-text-family), ...;

and each font option points the two family slots at its own family. That is why
the switch is applied on `<html>`: the layout puts the option's class on the same
element the roles are declared on.

Pointing a slot at a different family further down the tree does nothing. A
wrapper carrying `--font-display-family: "General Sans"` left the card in Inter
Tight, because `--font-display` is substituted at computed-value time on the
element that declares it, and descendants inherit the already substituted value.
The custom properties page describes substitution but not where it happens
(https://developer.mozilla.org/en-US/docs/Web/CSS/--*, read 6 September 2026);
the specification is explicit and the page is not
(https://www.w3.org/TR/css-variables-1/#substitute-a-var).

The fix is to redeclare the roles wherever the slots are redirected. The gallery
wrapper class `.type-specimen` sets `--font-display` and `--font-text` beside the
slots, so the substitution happens on the wrapper.

### A next/font module in one route's graph still emits @font-face for every route

The note above at "A font module in the bundle graph is fetched whether or not it
is used" says a conditional import in the root layout ships both families. The
obvious reading is that the problem is the root layout, and that importing the
inactive families from a single route keeps them to that route. It does not.

Measured on the Option B build, with the gallery importing the Option A and
Option C font modules directly. The preload links behaved as hoped and appeared
in the `/gallery` HTML only. The font files did not: the `@font-face` rules land
in a stylesheet chunk that every route loads, and a browser opening the landing
or Home fetched three woff2 files rather than one.

    /                    Geist_Variable-s.p...woff2, 83afe278...woff2, ab57efd0...woff2
    /home?demo=covered   the same three
    /gallery             the same three

So preload links are the wrong thing to grep for. What settles it is what the
browser requests, and the answer is every family whose `@font-face` reaches the
shared chunk.

The gallery therefore links its three specimen families as stylesheets, from
Google Fonts and from Fontshare, rather than importing them through next/font. A
link element rendered by one page is loaded by that page and by no other. The
same measurement on the rebuilt Option B tree:

    /                    Geist_Variable-s.p...woff2
    /home?demo=covered   Geist_Variable-s.p...woff2
    /gallery             the Geist file, plus Inter, Inter Tight, Geist and
                         General Sans from their own CDNs

and the Option A build ships no Geist file at all, which is the property the
switch exists to keep.

## Turbopack does not apply TypeScript's `.js` to `.ts` resolution to workspace source

Next 16.3.4, `next build` and `next dev`, on the T32 branch.

The TypeScript documentation for `moduleResolution: nodenext` requires a
relative import to name the emitted file, so every module inside
packages/index-model imports its neighbours as `./dataset.js` and the compiler
maps that back to `./dataset.ts`. Node with tsx does the same, and so does
Vite, which is why the workspace's own tests import these modules without a
word about it.

Turbopack does not. Importing `@creance/index-model/src/pricing` from either a
client component or a server component fails the build with six
`Module not found: Can't resolve './dataset.js'` errors, one per relative
import in that file. Three documented knobs were tried and none of them
changes it:

    transpilePackages: ['@creance/index-model']
    experimental.extensionAlias: { '.js': ['.ts', '.tsx', '.js'] }
    turbopack.resolveExtensions

`extensionAlias` is a webpack resolve option that Next accepts in its
configuration type and Turbopack ignores; `resolveExtensions` only affects an
import written without an extension, which is not this case.

The comment at the top of apps/web/src/lib/payer.ts had already met this and
worked around it by importing only modules from @creance/client that import
nothing of their own. The same rule applies here and is the whole fix: a
workspace module the web app imports must be a leaf, or the bundler will not
resolve it. See docs/DECISIONS.md, "The explorer imports the index model's
pricing, which meant splitting it".

## `Number.prototype.toFixed` rounds 0.85 down to 0.8

Node 22. Not a documentation disagreement so much as one worth writing down
once, because the explorer prints distances to one decimal and a test asserted
the wrong thing first. `(0.85).toFixed(1)` is `"0.8"`, because the double
nearest 0.85 is slightly below it; `(0.92).toFixed(1)` is `"0.9"` as expected.
Nothing on the index explorer depends on a half-point boundary, so the figures
stand, but an expectation written on a `.x5` value will look like a bug in the
code rather than in the expectation.

## The Turbopack dev server did not hydrate on this host, and `next start` did

Next 16.3.4. `pnpm dev` served the landing page correctly but no client
component ever hydrated: no `__reactFiber$` property on any element, no effect
ran, the card never took an angle and the count-up never started. Nothing failed
in the network log and no error reached `pageerror`. The only thing the console
carried was the development client's own hot reload socket, failing over and
over:

    WebSocket connection to 'ws://127.0.0.1:PORT/_next/hmr?id=...' failed:
    Error during WebSocket handshake: net::ERR_INVALID_HTTP_RESPONSE

The same pages hydrate normally from `pnpm build` followed by `pnpm start`, so
this is the development server on this host rather than the application. It is
worth knowing because it makes the development server useless for checking
anything that only happens after hydration, and the failure is silent: the page
looks finished and simply does nothing.

Verify a client behaviour against a production build.

### Corrected under T35: it is the origin the browser used, not the host

The conclusion above is wrong and the workaround is not needed. The cause is the
address the browser was pointed at. `next dev` treats anything other than the
host it was started for as a cross origin request for its development resources
and refuses to serve them, so a browser opened on `http://127.0.0.1:PORT` gets
the page but not the development client, and the hot reload socket fails exactly
as above while nothing else in the network log does. The server prints the
reason itself, in the terminal rather than in the browser, which is why it was
missed:

    Blocked cross-origin request to Next.js dev resource /_next/hmr from
    "127.0.0.1". Cross-origin access to Next.js dev resources is blocked by
    default for safety.

Open `http://localhost:PORT` instead and everything hydrates. If a tool has to
use the numeric address, the server names the other fix in the same message:
`allowedDevOrigins: ['127.0.0.1']` in next.config.ts.

Met again under T35, driving the landing page's inline quote with Playwright:
on `127.0.0.1` no client component reacted to a click and no element carried a
`__react*` property; on `localhost`, unchanged in every other way, the whole
quote ran. `next dev` is usable for client behaviour on this host.

https://nextjs.org/docs/app/api-reference/config/next-config-js/allowedDevOrigins

## `backface-visibility` does not hide a face's `preserve-3d` descendants

Building a two sided card with `backface-visibility: hidden` on both faces is
the usual recipe and it is not enough when the faces have three dimensional
contents of their own. The property applies to the element that carries it. It
does not apply down a `transform-style: preserve-3d` subtree, and every element
in that subtree decides for itself.

Met on T36, turning the landing hero card over to show the quote on its other
face. The card's thickness sits at `translateZ(-14px)` and its contents sit on
planes at 16, 24 and 40, all inside a `preserve-3d` card inside the face. Past
ninety degrees the face itself stopped painting, exactly as asked, and its
thickness and its lifted content carried on: at 1440 the half turn showed a grey
slab where the card had been with a line of the next step's caption hanging
below it. Chromium 148, and the specification says this is correct.

Hiding the face outright with `visibility: hidden` takes the whole subtree with
it and behaves the same in every engine. The one cost is that it has to be timed:
the face is hidden and shown at the moment the rotation reaches ninety degrees,
which is where the card has no width and the swap cannot be seen. That moment is
not half the duration unless the easing is symmetric, and with the ease-out the
rest of this page uses it is at 0.17 of it.

Two smaller things from the same ticket. `Element.focus()` does nothing on an
element inside a `visibility: hidden` subtree, so focus cannot be moved to a face
before that face is shown. And jsdom implements no layout, so it has no
`Element.prototype.scrollIntoView`: calling it unguarded throws inside a layout
effect and takes the render with it, which surfaces as every query in the test
failing rather than as the missing method.

https://drafts.csswg.org/css-transforms-2/#backface-visibility-property

## WebKit cannot be launched on this host, so iOS Safari was not reached

`npx playwright install webkit` downloads WebKit 26.6 without complaint and it
will not start: the host is missing `libgtk-4.so.1`, `libgraphene-1.0.so.0` and
`libevent-2.1.so.7`, and `playwright install-deps` needs root. The browser sits
in `~/.cache/ms-playwright/webkit-2359` unusable until those are installed.

So anything an acceptance asks to be confirmed on iOS Safari cannot be confirmed
by an agent on this host, and Playwright's WebKit would not have settled it
anyway: it does not reproduce iOS viewport height behaviour or the mobile
compositor. T36 needed this and left it to Root on a real device.

## The x402 gate's settle is the whole latency of a paid call, 10 September 2026

The Hedera exact scheme is documented as verify, then the handler, then settle,
and nothing in the scheme or in the facilitator's reference says what settle
costs in wall clock. It costs consensus, on the response path, every time.

Measured against this build's own API on Hedera testnet, from the API's own
`responseTime` and from curl on the same host:

    unpaid 402 challenge, GET /v1/index/{group}   0.7 ms median, n=36
    free route, GET /v1/replay                    1.4 to 2.3 ms
    free route, GET /v1/index (catalogue)         18.6 ms
    paid 200, GET /v1/index/{group}               3,833 ms median, n=38
    paid 201, POST /v1/quote                      4,175 ms median, n=2

The unpaid challenge and the free routes are the same server doing the same
work. Everything above three seconds is the settle, and it gets worse rather
than better under concurrency: the same paid read was 2,468 ms when one client
was measured on its own and 3,833 ms with five in flight through the same
facilitator.

The consequence for anything built on it is a client side rule, not a server
side one. A paid call cannot be made fast, so a page that makes one per visitor
is a page that is three seconds slow per visitor, and the only two things that
help are buying once for a window rather than once per visitor, and never
putting a person behind the call at all. Both are in
apps/web/src/lib/held-read.ts and apps/web/src/app/page.tsx, and together they
took this build's front door from 4.12 seconds to first byte to 12 milliseconds
without removing a single real payment.
## The ERC-20 `approve` on an HTS token costs 730,000 gas, and drains the api account

Funding a series is three calls: the operator transfers the settlement token to
the api account, the api account approves the vault, and the api account calls
`subscribe`. The transfer is 39,647 gas and the subscribe 124,218, both
unremarkable. The `approve` is **729,787 gas**, about 1.7 HBAR, because it is a
token service call priced by converting a USD cost to gas rather than a storage
write. It is not in the measured gas table in docs/HEDERA.md, which records
`subscribe` at 141,378 and says nothing about the approve that has to precede
it, so a run budgeted from that table is budgeted eighteen times short.

The api account holds no HBAR of its own on this deployment: every other path
it is on is paid for by somebody else. Topping it up to twelve HBAR once at the
start of a fifteen series run is enough for seven series, and the eighth dies
with `INSUFFICIENT_FUNDS` from the relay in the middle of the approve, with the
25,000 already transferred to it. `pnpm series:capacity` therefore checks the
balance before every series rather than once, against a floor below the target
so a run that does nothing else sends nothing.

The approve figure is now in the measured gas table.

## docs/HEDERA.md's operator balance line is stale and cannot be corrected by hand

The generated block says "Operator balance when this file was last changed:
974.83002702 HBAR." The mirror node said 859.74 HBAR before this ticket spent
anything. The line is inside the `pnpm hedera:setup` markers, so editing it
would be deleted by the next setup run and it is left alone. Read the balance
from the mirror node, not from the file.

## The payments topic carries every settlement, so a bind's two messages are not adjacent

`apps/api/scripts/testnet/bind.ts` read the bind outcome message by asking for
the receipt's sequence number plus one, with the comment "because nothing else
writes to this topic during the run". That holds only when one process is
running. With a second API on the host paying for index reads, seventeen x402
settlement messages landed between the two halves of one bind, and the
assertion failed on a bind that had in fact succeeded: receipt at 4622, outcome
at 4640.

`MirrorClient.topicMessagesFrom` already exists for exactly this and its own
comment says so. The script now reads the window forward from the receipt and
matches on the policy id.

## The settlement token's decimals are not on its ERC-20 facade

`contracts/coupons/abi.ts` carries `transfer`, `approve`, `allowance` and
`balanceOf` for the settlement token and no `decimals`, and calling it through
ethers fails client side with `no matching function` rather than reverting. The
decimals live on the mirror node's token record, `GET /api/v1/tokens/{id}`,
which is where the runner reads them and checks them against
`docs/hedera.testnet.json` before scaling any amount.

https://docs.hedera.com/hedera/sdks-and-apis/rest-api

## One test in `pnpm test` reaches the JSON-RPC relay, and did before this ticket

`pnpm test` is meant to run from a clean clone with no network. It nearly does.
`apps/api/test/openapi.test.ts`, "promises nothing on the free reads the server
does not send", builds a server through `buildTestServer` and asks it for
`/v1/series/ODI-COMP-2026-01`. `buildServer` registers `investorRoutes` with no
options, and the plugin then builds its own `EthersChainReader(config.rpcUrl)`,
so that one case reads the vault and the note over the relay.

Point `HEDERA_RPC_URL` at a dead port and it is the only failure in 1,494. The
same command fails the same way on `main`, so it is not a regression; it is
recorded here because the acceptance line for T39 asks whether the suite still
runs without network and the honest answer is "as well as it did before, which
is all but this one case". The fix is to thread a stub reader through
`buildTestServer` the way `investor-routes.test.ts` already does, and it is a
change to a shared fixture rather than to anything T39 touches.

## `next dev` blocks its own dev resources over 127.0.0.1, so the page never hydrates

Not Hedera, and recorded because it cost time verifying the landing page in a
browser and will cost the next person the same.

`next dev` prints its address as `http://localhost:3000` and Next's own docs
describe `allowedDevOrigins` as being about other hosts on the network.
https://nextjs.org/docs/app/api-reference/config/next-config-js/allowedDevOrigins

Read on 10 September 2026 with Next 16.3.4. Loading the same server over
`http://127.0.0.1:<port>` rather than `http://localhost:<port>` is treated as a
cross origin request for `/_next/` resources and is refused:

    ⚠ Blocked cross-origin request to Next.js dev resource /_next/hmr from "127.0.0.1".

The server still answers the document with HTTP 200 and the full server rendered
HTML, so anything that reads the markup looks healthy. What does not happen is
hydration, so every client component is inert: on the landing page "Get a quote"
does nothing at all and the card never turns. The two addresses are the same
socket and the distinction is the literal host string.

Verify a page over `localhost`, or add the address to `allowedDevOrigins`. This
affects the dev server only; `next start` does not do it.

## The simulator answers with an orb credential, so a Selfie Check deployment refuses it

The credentials page says the `selfieCheckLegacy` preset returns `selfie`, with
the historical `face` still accepted as an alias, and that is what
`apps/api/src/world/config.ts` accepts by default.
https://docs.world.org/world-id/idkit/credentials

Read on 5 September 2026. On 10 September 2026 a check run through the World
simulator against the deployment came back with `orb` on the one response item.
World's verify endpoint answered 200 and confirmed the proof, so the refusal was
entirely ours: the identifier was not in the accepted list. The deployment now
sets `WORLD_IDENTIFIERS=selfie,face,orb` so the simulator can complete the flow,
and .env.example says so.

Two things follow for anyone integrating. The identifier a preset returns is not
a constant of the preset; it depends on what the person verified with, and a
simulator verifies with whatever it has. And a proof World confirms can still be
refused by the relying party for a reason World never sees, which is why that
reason has to be said locally: until T42 this refusal wrote nothing to the log at
all, so the deployment showed a request going in, a 403 coming out, and no way to
tell this apart from a failed proof. Every local refusal in
`apps/api/src/world/verify.ts` now reports its reason on a warn line carrying the
request id, with no proof, nullifier, signal or wallet on it.

## The Hedera WalletConnect package's ESM build cannot be imported by node

`@hashgraph/hedera-wallet-connect` 2.1.3 is published as ESM: `"type": "module"`
in its manifest and `./dist/index.js` as its entry. Its own emitted code imports
directories rather than files, `export * from './lib'` and `export * from './reown'`,
which is a resolution TypeScript's compiler will emit and node's ESM loader will
not follow. Importing the package in plain node fails with:

    Directory import '.../dist/lib' is not supported resolving ES modules

Read and reproduced on 10 September 2026 against node 22.23.1. The
documentation, https://github.com/hashgraph/hedera-wallet-connect, gives an
`npm install` and an import and says nothing about this, because the audience it
is written for is bundled: Turbopack, webpack and Vite all resolve a directory
import to its `index.js` and the package builds and runs perfectly inside a
Next application, which is what this build does with it.

What it costs is that the package cannot be reached from a vitest file, which
runs in node. It is not a problem here for a reason worth stating rather than
discovering: the module that imports it, `apps/web/src/lib/wallet-connect.ts`,
is loaded by a dynamic `import()` inside the connect path and by nothing else,
so no test file reaches it. The parts of the connection this build owns, the
CAIP account parsing and the provider factory, are in `apps/web/src/lib/wallet.ts`,
which imports nothing.

## A public variable in the repository root environment file never reaches a web build

Recorded because it cost days once already and the same trap was in front of
T43. `next build` runs with `apps/web` as its working directory, and the
framework reads an environment file from the application directory only. A
`NEXT_PUBLIC_` name set in the repository root `.env` is inlined into nothing:
`NEXT_PUBLIC_SITE_URL` was set there for days and never reached a build.

So `NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID` lives in the web application's own
environment file, and the root `.env.example` documents it by saying where it
goes rather than by carrying it. `apps/web/src/lib/server-env.ts` exists for the
other half of the same fact: private variables are read from the root file by
node's own loader, in the module that needs them, because the framework will not
read that file either.

## A directory import in .dockerignore excludes the root environment file only

Related, and found while removing a build argument that no longer does anything.
`.dockerignore` writes every workspace pattern with `**/`, deliberately and with
a comment saying why, except the three environment lines: `.env`, `.env.*` and
`!.env.example`. A pattern without `**/` matches at the root of the context only,
so the repository root environment file is excluded from the image and the web
application's own one, which `COPY apps/web apps/web` brings in, is not.

That is what makes the WalletConnect project id reach a container build with no
build argument, so it is useful rather than broken. It is written down because it
is an accident of a pattern that reads as though it excludes both, and because
the file it copies must stay public only. Anything secret in a web application
environment file would be in the image.

## Turbopack did not code split a plain dynamic import out of a client module

Next 16.3.4, measured on 10 September 2026 against the built output rather than
inferred. `await import('./heavy-module')` inside a module that a client
component imports did not produce a separate chunk: the whole tree went into the
page's own chunk and was served as a `<script async>` on the landing document.

The tree in question is `@reown/appkit` with `@hashgraph/hedera-wallet-connect`,
3.5MB. On origin/main the web app builds 130 chunks totalling 1.4MB with the
largest at 224kB. With the plain dynamic import it built 8.5MB with the largest
at 3.5MB, and the landing page loaded that one.

Three shapes were tried and all three produced a chunk of identical name and
size: the imported module with `'use client'`, the same module without it, and
the factory moved out of a module that server code also imports into a client
only one.

`next/dynamic` on a component splits correctly, and this repository already
depended on that: `src/components/landing/quote-panel.tsx` loads the IDKit
widget that way, and IDKit is nowhere near the landing chunk in the baseline
above. So the rule to work to here is that a component is the only reliable
split boundary, and a module behind `await import()` should be assumed to be in
the bundle until the built output says otherwise.

Worth measuring rather than trusting either way. `ls -S apps/web/.next/static/chunks`
after a build, and the script tags in the served landing document, are the two
things that answer it.


## The three description URLs 404 at the web origin while the API serves them

Measured 10 September 2026 at 19:30 UTC from this machine, with curl. The three
URLs `recipes/bazantic/agentify/README.md` states as live all answer 404:

    https://creance.co/llms.txt            404 text/html   12719 bytes
    https://creance.co/skill.md            404 text/html   12719 bytes
    https://creance.co/openapi/index.json  404 text/html   12719 bytes

The bytes are the Next.js not-found page, not a proxy error: the response
carries `x-powered-by: Next.js`, `x-nextjs-cache: HIT` and Next's `vary` list,
behind Cloudflare. So the web app is answering those paths and has no route for
them, and nothing in front of it sends them anywhere else.

The same paths on the API origin answer, from the same commit:

    https://api.creance.co/llms.txt            200 text/plain       5911 bytes
    https://api.creance.co/skill.md            200 text/markdown    9772 bytes
    https://api.creance.co/openapi/index.json  200 application/json 23226 bytes

Every other path the description files link to behaves the same way: `/v1/index`,
`/v1/replay`, `/v1/attribution`, `/v1/index/computer_math` and `/health` are 404
on `https://creance.co` and 200 on `https://api.creance.co`.

So the deployment is two origins, and `deploy/Caddyfile`, which routes `/v1/*`,
`/health`, `/healthz`, `/.well-known/jwks.json`, `/llms.txt`, `/skill.md` and
`/openapi/*` to the API on one origin, is not what is in front of the live host.
`https://creance.co/openapi.json` is the exception at 200, because that one is a
real file in `apps/web/public/`.

The rule this breaks is the one docs/DECISIONS.md sets under "The description
files are served, not only committed": the description files carry the public
origin in every URL, so an agent that reads them is taught addresses which do
not answer. T46 closes it inside the web app rather than at the edge.

## The vitest DOM tests time out at twenty seconds when this host is oversubscribed

Measured 10 September 2026. `pnpm test` failed four times in a row on this box
with between four and nine failures, every one of them
`Error: Test timed out in 20000ms` in `apps/web`, and once with
`Error: [vitest-worker]: Timeout calling "onTaskUpdate"`, which is the worker
losing its RPC rather than a test failing at all.

Which tests fail changes between runs, and none of them fails on its own. The
same two files that failed the first run passed 46 of 46 when they were the only
thing running, and the whole web project passed 680 of 680 in 130 seconds a few
minutes later. The difference is the load average, which was between 20 and 213
on four cores while other work was building on the same machine, and under 10
when the suite went green.

So a timeout in `apps/web` is worth re-running before it is worth reading. The
suite passes on this branch: `pnpm test` exits 0 with the machine quiet, and
`pnpm --filter @creance/web test` is the quickest way to check the web project
without waiting for the rest.
