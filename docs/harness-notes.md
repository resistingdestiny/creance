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
