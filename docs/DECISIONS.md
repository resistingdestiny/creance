# Decisions

Every deviation from DESIGN.md, and every choice DESIGN.md left open that later
work depends on. One row per decision, with the reason.

## Before kick-off

These were settled before the first commit, from the design work and the
adversarial review of the archive. They are recorded here because later tickets
depend on them and there is no other copy.

### The typeface is Option A, Inter Tight for display and numbers, Inter for text

Affects T10 and T15. Option B, Geist, is dropped.

The whole scale in docs/DESIGN-TOKENS.md, including every tracking value, was
specified against Inter Tight. Swapping the family would mean retuning the
display sizes for no gain, and the hero only holds together at 104px because of
Inter Tight's tighter tracking.

### The marketing surface may use a dark ground, the product may not

Affects T10, T15 and T17.

The landing page is a different job from the app: it argues, the app reassures.
The token sheet's light only rule stays binding for every worker and investor
screen. See the addendum for the two tokens this adds.

### One elevation token exists, and only the landing hero card may use it

Affects T10. Everywhere else depth is hairline and grouping, as specified.

A card floating over a dark ground needs separation that a hairline cannot give.
Permitting it once, by name, is safer than leaving builders to invent shadows.

### The headline index figure is whichever form is nearer its line, chosen server side

Affects T15 and T16. It is returned as a field.

The index has two forms and two thresholds. One number cannot say which is
nearer to opening, and for the demo series it is the level form. If two screens
chose independently they would eventually disagree. This resolves the open item
in the web note.

### A consumer is never shown a signed index value

Affects T15, T16 and T17. Position is expressed as points better or worse than
average, the headline is the distance to a payout, and a distance under 0.05
reads as sitting on the line rather than 0.0 points away.

A negative level line is correct and unreadable. Framing the same number as a
distance removes the sign without changing the maths.

### Premium is a guide price from the index multiplied by a capacity term

Affects T02, T04 and T07.

    guide rate  = max(0.005, h(d) * 0.167 * 0.60 * 1.30)
    market rate = guide * (1 + utilisation), capped at three times guide

where h is the fitted hazard on the distance to the level line.

The formula in DESIGN.md section 3.4 puts thirteen of the fifteen offered
occupations on the floor, because the per series attachment deliberately
equalises shock risk. Only proximity to the level line differentiates, so the
guide price must be conditioned on it.

### Capacity is committed per occupation at subscription, not allocated pro rata

Affects T04, T06 and T07. Cover cannot be bound for an occupation with no
capacity behind it, and the picker says so rather than quoting a price nobody
can buy.

Pro rata allocation collapses the capacity term to a single pool number, which
would make the market half of the price meaningless. The cost is per series
accounting and the risk of thin series, which is a real market behaviour rather
than a bug.

### The product is called Creance

Affects every ticket. The investor instrument keeps the descriptive name
Displacement Bond Note, and the index keeps the name Occupation Displacement
Index.

Root's decision, taken before the first commit so the repository has no rename
in its history. DESIGN.md always treated the project name and the instrument
name as separate, and the instrument name describes what the security is, which
is worth keeping in front of judges on the tokenization track.

### The canonical public origin is https://creance.co

Affects T21, T11 and T19. Local development stays on localhost, and
`PUBLIC_SITE_URL` in the environment carries the production origin.

The origin is baked into three things that are painful to change later: the
World Developer Portal's allowed origins and the rp_context the backend signs,
the x402 resource URLs an agent pays against, and the Bazantic gateway's base
URL. Fixing it before anything is built avoids a rename across all three mid
event. Note for whoever builds the web app: framework public environment
variables are inlined at build time, so the origin must be present in the
environment before the production build runs, not after.

### The level line is computed per calendar month, not once per series

Affects T02, T12 and T26. The October 2025 collection gap has a stated rule,
tested both ways. An opening on the shock form alone requires that the base
period was not itself an open month.

An adversarial review against the committed archive found that the level form
opens on seasonality rather than displacement (every education opening falls in
August, every farming opening between February and April), that the gap has two
honest readings which settle different months for computer and mathematical, and
that the shock form has base effects in both directions. See
docs/INDEX-FINDINGS.md section 6.

Overtaken in part by later work. The T02 section below freezes the single line
per series for version 1 and publishes the month matched line beside it, and the
T04 decision "The level line on chain is one value per series, not one per
calendar month" is what the deployed contract does.

### A replay window that crosses January 2026 is recomputed on pre revision values

Affects T24.

Not seasonally adjusted household data is not revised after first print, which
is why the backtest is trustworthy, but January 2026 is the one exception found
and the demo window crosses it.

## T02, the index model, 4 September 2026

### The series universe is fifteen bindable series plus the all-occupation rate

INDEX-SPEC section 3's resolution procedure now names the fifteen bindable
series plus LNU04000000, sixteen in all, and the example mapping row uses the
group key `office_admin_support`.

The spec still said "the eleven A-13 group labels", which predates DESIGN.md
section 3.3 and INDEX-FINDINGS section 1. The catalogue publishes no armed
forces series, and the picker carries the ten sub-groups plus five detailed
groups, so eleven names nothing that exists. `office_admin` is not the key the
rest of the system uses.

### A period's availability is two independent checks, and the published ODI is computed from the published ebar values

INDEX-SPEC section 4 replaces "a period needs months t-14 through t present"
with a level check on t, t-1 and t-2 and a shock check on those plus t-12, t-13
and t-14, and defines the published ODI as
`pub(pub(ebar_t) - pub(ebar_t-12))`.

Read literally, the fifteen month rule makes April 2026 uncomputable, because it
demands October 2025, which the source never collected. That is the month the
demo turns on. Splitting the checks publishes the level form when the shock form
is not evaluable, which is the honest reading and the only one that survives the
gap. The ODI definition was left open and the two paths differ on 1,006 of the
4,530 historical values, so the message and a reader's recomputation would
disagree about one time in four and a half.

### The completeness gate counts sixteen series, not twelve

INDEX-SPEC section 8 is corrected.

The trigger universe is the fifteen bindable series plus LNU04000000. Twelve was
never the size of any list in the design.

### Version 1 freezes the single level line per series, and publishes the month matched line beside it

The month matched line required by the pre kick-off decision above is
implemented and tested as a second calibration mode, and both open month tables
are published side by side in docs/INDEX.md. Which one a future version binds is
Root's call.

The two are not equivalent and the difference is a product decision, not an
implementation detail. Under month matched lines, computer_math has been level
open in 21 of the computable months since April 2023 rather than opening in
April 2026, which rewrites the demo narrative, the pricing and the copy. The
acceptance line, the reference vectors and the DESIGN.md section 3.4 demo all
assume the single line, so version 1 ships it and the comparison is published
rather than buried.

### The October 2025 gap rule is the strict calendar window

The hop-over reading is implemented only as a test that asserts the
implementation does not take it.

Sliding the smoothing window over a hole changes the definition of the index
after issuance. The two readings settle different months: hop-over opens
computer_math in December 2025 and strict does not. Strict is the one that can
be defended to a noteholder.

## T03, Hedera resources, 4 September 2026

### The SDK is @hiero-ledger/sdk, never @hashgraph/sdk

`@hiero-ledger/sdk` 2.87.0 is the maintained package; `@hashgraph/sdk` is the
same repository under the old namespace, six versions and five months behind.
The two must never both be installed in one process, because two copies of the
protobuf runtime give confusing `instanceof` failures. Every Hedera snippet a
judge reads will say `@hashgraph`, so this is worth stating plainly: the imports
are the new namespace and the code is otherwise the same.

### Account keys are derived from the operator key, not generated and stored

The nine accounts this build creates are not random. Each key is
HKDF-SHA256 over the operator private key with the label
`creance/testnet/<role>`, so the whole account list is recoverable from the
operator key alone.

Why: DESIGN.md needs ten accounts whose ids and EVM addresses end up inside
contracts, `.env` files and `docs/HEDERA.md`. Generating them randomly means
nine new secrets that have to be moved between sessions and machines, and a
lost file means the accounts are unreachable and the contract roles have to be
re-issued. Derivation makes the setup script idempotent across machines with no
new secret at all.

The cost: every derived key is exactly as secret as the operator key, and
anyone with the operator key has all ten accounts. That is acceptable because
this is testnet only, with no real funds, and the operator key already pays for
and controls every one of those accounts. It would not be acceptable on
mainnet, and MISSION rule 1 says there is no mainnet.

### The settlement asset is tUSD, not testnet USDC

DESIGN.md section 2 allows either: testnet USDC "if the token and a faucet are
usable on day 0; otherwise mint an HTS token tUSD with 6 decimals". No USDC
faucet is available to this build, so a Circle-issued token would give balances
nobody can top up and a demo that stops when they run out. The script mints
`Creance Test USD` (TUSD, 6 decimals, token 0.0.10366463) with the operator as
treasury, and hands the demo accounts working balances.

Six decimals matches the USDC convention and the unit the x402 exact scheme
settles in, so nothing downstream has to change if a real USDC becomes usable:
setting `TESTNET_USDC_TOKEN_ID` makes the script adopt that token instead of
creating one.

An HTS token in the settlement path is also a named criterion for the Hedera
prize, which a Circle token would not satisfy in the same way.

### The policy NFT collection has no default freeze

DESIGN.md section 2 asks for "One HTS NFT per policy, non-transferable (freeze
on mint)". The intended pattern was `freezeDefault` true on the collection, so
that a holder is frozen between binds and unfrozen only for the length of a
bind.

It does not work. Measured on testnet: an account with unlimited automatic
token associations cannot receive the first serial of a collection whose
default freeze status is frozen. The transfer fails with
`ACCOUNT_FROZEN_FOR_TOKEN`. See docs/harness-notes.md for the probe.

So collection 0.0.10366468 is created without `freezeDefault`, and
non-transferability is enforced the other way round: associate, transfer,
freeze. The end state is the same, a holder who cannot move the receipt, and
the difference is one extra transaction at bind and an unfreeze before a second
policy for the same holder. The outcome DESIGN.md asked for is unchanged; only
the mechanism is.

### Nine accounts are created, not ten

DESIGN.md section 4 lists "operator, oracle, api, steward, adjuster, three
policyholder and two investor accounts". The operator already exists and funds
the rest, so the script creates the other nine. Some planning notes count this
as ten or eleven; the list in DESIGN.md is the one that was built.

### docs/HEDERA.md is generated between markers

The setup script owns the block between
`<!-- begin generated by pnpm hedera:setup -->` and its closing marker, and
rewrites it from `docs/hedera.testnet.json` on every run. Everything outside
the markers is left alone, so T04, T05 and T06 can fill in their own sections
without a later setup run overwriting them.

The consequence is that the operator balance in that file is the balance when
the file last changed, not a live figure. A live figure would make every run
dirty the working tree, which would break the "re-running the script changes
nothing" acceptance line. The live balance is printed to standard output
instead.

## T04, CoverPool and CollateralVault, 4 September 2026

### A reserve is an earmark inside the vault, not a transfer to the pool

DESIGN.md 3.2 says the vault "reserves the sum of the limits of the exposed
policies in the CoverPool", which reads as a token transfer from one contract to
the other. It is an accounting counter inside the vault instead, and CoverPool
never holds a balance.

Why: only one contract account then has to be associated with the settlement
token, which is a deploy step that can fail; there is one balance to reconcile
rather than two; and `release` becomes the exact arithmetic inverse of
`reserve` rather than a second transfer that can half succeed. The product
behaviour is identical.

### The contract decides whether a month is open, not the oracle

DESIGN.md 4 gives `submitObservation(group, period, odi, hcsSequence)`, and the
HCS message in 3.3 carries `"open":true,"open_reason":"level"`. Read literally
the contract would be told the answer. It is
`submitObservation(seriesId, period, odi, ebar, hcsSequence, sourceHash)`
instead, and the contract computes `open` and `openReason` from the attachment
and level line frozen at registration.

Why: a wrong ODI is visible and disputable against the published source file,
but a correct ODI with a wrong open flag is not. The dual form rule then lives
in one place rather than in the oracle, the API, the web app and the contract.
The oracle still publishes `open` in the HCS message, because the message has to
read standalone, and the API compares the two.

Also, the parameter is `seriesId` and not `group`: attachments and level lines
are per series and frozen at issuance (docs/INDEX-FINDINGS.md 4), so a single
group wide threshold would be wrong. `group` stays on the series as a label and
is never used in a control flow decision.

### The level line on chain is one value per series, not one per calendar month

docs/INDEX-FINDINGS.md 6.1 requires the level line to be computed per calendar
month, because these series are not seasonally adjusted and a whole-series line
reads the school year peak as displacement. The contract holds one `levelLine`.

Why: the twelve lines are a property of the index, and putting them on chain
would mean the contract also has to hold the month matched selection rule and
the October 2025 gap rule from 6.2. The frozen value in the contract is the line
for the demo series' opening month, and a series whose lines differ by month is
registered as the calibration for the month it settles in. If T02's month
matched lines change the demo opening, the series is re-registered with the
right number rather than the contract learning a calendar. Recorded here because
it is a real narrowing: the on chain check is the published line for that
series, and the published table is what a buyer can recompute.

### The claim authorisation is EIP-712 typed data with three extra fields

DESIGN.md 3.6 lists policy id, claim id, packet hash, decision hash, amount and
separation month. The signed struct adds `nullifierHash`, `payee` and
`deadline`, and signs `separationAt` as a timestamp rather than the month.

Why: the nullifier binds the authorisation to the World ID identity that both
bought the cover and re-verified at claim, so a signature cannot be moved to
another policy with the same amount; the payee puts the destination inside the
signed material; the deadline makes a leaked signature useless after thirty
minutes, which matches the eligibility credential lifetime. The contract derives
the separation month from the timestamp, so signing the month as well would
create two sources of truth. Typed data rather than a packed hash because the
domain separator binds a signature to this contract on chain 296, so an
authorisation from the local test deployment cannot be replayed on testnet.

The exact type string is in docs/HEDERA.md under Contracts, ABI conventions.

### The payee must equal the policy holder

The payee is a signed field so that an assignment of benefit could be added
later without a new signature scheme, but `payClaim` requires it to equal
`policy.holder` today. DESIGN.md 3.6 is explicit that the payout goes to the
principal's wallet and not an agent's, and a free choice of destination on the
money path is a degree of freedom with no current use.

### An indexed series refuses to pay when the qualifying month opened on the level form

DESIGN.md 3.2 gives the indexed payout as
`limit * min(1, (ODI - attachment) / (exhaustion - attachment))`. That formula
is defined against the shock form only: a month that opened because the smoothed
excess crossed the level line can have an ODI well below the attachment, and the
numerator is then negative.

`registerSeries` rejects an indexed series unless exhaustion is above
attachment, and `payClaim` on an indexed series whose qualifying month opened on
the level form reverts with `IndexedModeNeedsShockOpening`. Refusing to pay a
wrong number is better than inventing one. A series that wants an indexed payout
on the level form needs a second exhaustion line set at issuance, which is a
design change and not a patch. The demo series is full payout, so nothing in the
demo touches this.

### Lapse and expire are blocked while a claim window is open

DESIGN.md 3.2 lapses a policy fifteen days after a missed premium. That still
happens, but `lapse` and `expire` revert while the series is `ClaimsOpen`.

Why: without the guard, whoever can lapse a policy can remove an exposed
policyholder from the reserve in the middle of the claim window, which is the
one transition in this design that could be used to avoid paying a valid claim.
With it, no policy leaves the reserve except by being paid. The cost is a few
days of premium accrual in the worst case; the lapse can be poked as soon as the
window closes. Both are permissionless pokes for the same reason: no keeper to
fail and no stuck state to explain.

### Settling is an admin status near maturity, not the state after a window

DESIGN.md 3.5 lists Settling between ClaimsOpen and Matured. The claim window's
own cycle is `Active -> ClaimsOpen -> Active` and it can go round more than once
inside a twelve month term, so `closeWindow` returns the series to whatever it
was before the window opened. `Settling` is what an admin sets when a series
stops accepting new policies near maturity: `bind` is refused in it,
`submitObservation` is not.

### A second open month tops the reserve up, it does not reserve again

DESIGN.md leaves this open. On the first open month the vault reserves the whole
`activeExposure`. On every later open month in the same window the pool reserves
only the difference between the current exposure and what the reserve already
covers, which is zero when nothing has been bound since. Reserving the exposure
again would double count and quietly refuse later binds; reserving nothing would
leave the reserve short of policies bound during the window, which is the more
dangerous direction.

### The settlement token is reached through IERC20, not the HTS system contract

Both contracts consume the settlement asset through `IERC20` and OpenZeppelin's
`SafeERC20`. Every HTS fungible token is callable through its ERC-20 facade, so
the same bytecode runs against a six decimal mock locally and against TUSD on
testnet.

Why: the local Hardhat network has no token service, so a vault written against
the 0x167 system contract could not be unit tested at all and every assertion
would cost HBAR and could not warp time. `SafeERC20` also reverts on failure,
where the raw `HederaTokenService` helper returns a response code that a caller
can ignore, which in CoverPool would mean marking a claim paid after a failed
payout.

The one HTS specific call that remains is `associateSettlementToken`, which
opts the vault in to holding the token through the HIP-719 facade. It is admin
gated, runs once at deploy, and is on no money path. The HTS native operations
the Hedera prize asks about live in the SDK layer: the token's own key set, the
policy NFT freeze and the ATS compliance surface.

### CLAIMS_ROLE is held by the api account in this deployment

The prep design for these contracts wants ADMIN, ORACLE, BINDER and CLAIMS on
four distinct keys. DESIGN.md 3.6 and docs/HEDERA.md both say the API signs the
claim authorisation, and the api account is also the binder, so this deployment
has three distinct addresses and not four: operator as admin, oracle, and api as
binder, claims, subscription and treasury.

The separation that matters is preserved and asserted at deploy time: the
account that publishes the index cannot authorise the payout it triggers, and
the account that administers the contracts is neither. `CLAIMS_ROLE` is a
separate role rather than a hard coded address precisely so that a dedicated
signing key can be granted and the api key revoked without a redeploy, which is
a `grantRole` and a `revokeRole`.

### A pause stops new exposure and never traps money

`pause` blocks `bind`, `submitObservation`, `payClaim`, `subscribe`,
`attributePremium` and `fundCoupon`. It deliberately does not block
`closeWindow`, `reserve`, `release` or `redeemAtMaturity`: a pause that also
traps money is a worse failure than the one it protects against.

### There are no proxies and no upgrade path

Both contracts are deployed once and are not upgradeable. New terms mean a new
series; a code change means a new deployment. A proxy would add a storage layout
hazard and a verification complication for no benefit here, and the Hedera EVM
forbids `delegatecall` into system contracts, which is the pattern an
upgradeable HTS consumer would reach for.
## T05, Scheduled Transactions, 4 September 2026

### The long-term expiry window is 62 days, so the premium chain is one schedule per month

Measured on testnet by bisection, not read off a page. A `ScheduleCreate` is
accepted when the expiration time is at most **5,356,800 seconds, exactly 62.0
days, after the consensus timestamp of the create**, and rejected one second
later with `SCHEDULE_EXPIRATION_TIME_TOO_FAR_IN_FUTURE`. The bisection and the
exact bracket are in docs/harness-notes.md.

A month fits inside that window with a month to spare, so the contingency in
DESIGN.md section 8, "compress cadence with the demo clock and create the next
transaction on each execution", is **not needed** for correctness. It stays in
the demo path for a different reason: the demo clock runs a month every ten
seconds, so every expiry is seconds away and the whole chain is visible inside a
video. Both cadences run the same code, because the helper takes an `executeAt`
and never a duration.

Consequence for T09 and T14: a premium schedule is one Scheduled Transaction per
month with `waitForExpiry` true, created ahead of time. Creating all twelve at
bind is possible within the window but is twelve fees and twelve failure points
inside the bind path, so the Steward creates the first few and tops up on each
execution.

### The helper lives in packages/client, not contracts/scripts

The backlog offered either. It went to `packages/client/src/hedera/schedule.ts`
because T09 (apps/steward) and T14 (apps/api) both import it, and neither can
import from the contracts workspace without dragging Hardhat and ethers behind
it.

That means `packages/client` now has its first dependency, `@hiero-ledger/sdk`
pinned to exactly 2.87.0, the same version the contracts workspace pins. Both
resolve to one installed copy, so there is one protobuf runtime in a process
that loads both, which is the condition the T03 entry above sets. The helper
imports nothing from `contracts/scripts`: it takes a `Client`, an account id and
a `PrivateKey`, and the spike script does the key derivation.

### The payer pays the creation fee, the execution fee and the premium

`scheduleTransfer(payer, to, amount, executeAt)` names one payer and it pays for
everything: the `ScheduleCreate` fee, the fee for the scheduled transfer when it
executes, and the transfer itself. The create is charged to the payer by
generating the transaction id against the payer account rather than the client
operator, and the execution is charged to it by `setPayerAccountId`. The payer's
signature on the frozen create is therefore the only signature the whole
arrangement needs, so a premium is pre-signed at bind in one round trip.

The acceptance line does not say who pays what, and the alternative, letting the
Steward or the API pay the fees for the policyholder's transfer, would put a
second signature and a second funded account on the money path for no benefit.

The other shape DESIGN.md 3.7 offers, where the API creates the schedules and
returns them for the Steward to sign, is supported by the same helper: pass no
payer key, set `preSign` false, and finish the schedule later with
`signSchedule`. Then the creator pays the create fee and the payer named by
`setPayerAccountId` still pays the execution. Both paths are proved on testnet
in docs/HEDERA.md. Pre-signing is the default because it is one round trip and
one fee payer.

### Every premium schedule carries an admin key

Without an admin key a schedule is immutable, and DESIGN.md 3.5 lapses a policy
15 days past a missed premium. The only way to stop the premiums a lapsed policy
has already pre-signed is `ScheduleDeleteTransaction` signed by the admin key,
so the helper takes one and the spike proved the delete path on testnet.

### The accounting month comes from the memo, never from the execution timestamp

Execution is best effort at the earliest consensus time after the expiry, so the
executed transfer's timestamp is later than the due time by an amount the
network chooses. Every premium schedule carries the memo
`creance premium <policyId> <YYYYMM>`, and `parsePremiumMemo` reads the policy
and the period back out of it. The period is the `YYYYMM` `uint32` CoverPool
takes, so an execution maps to `recordPremium(policyId, period)` with no date
arithmetic at the boundary.

### scheduleNext is a watcher, not an on-chain loop

A Hedera schedule cannot create another schedule: `ScheduleCreateTransaction` is
not on the list of transactions that can be scheduled. So "creates the following
month's transfer when one executes" is a process that polls the mirror node for
`executed_timestamp` and then creates the next one. `scheduleNext` returns
`(scheduleId, policyId, period, executed transaction id)` through its callback,
which is what T09 needs for `CoverPool.recordPremium` from the api account and
T18 needs for the payments topic entry. If nobody makes that call, `lapse()`
becomes callable once the 15 day grace past `paidThroughMonth` has run out, and
a paid premium looks exactly like a missed one.

### The watcher reports a premium only when the transfer settled

An execution is not a payment. A schedule executes whether or not the transfer
inside it succeeds, and the docs say so about the underfunded payer, so
`executed_timestamp` on its own cannot be the signal that a month was paid.
`scheduleNext` splits the two: `onExecuted` fires only on `SUCCESS`, everything
else goes to `onFailed`, and the returned outcome carries `settled` for a caller
that uses neither.

The asymmetry is deliberate. Missing a real payment delays a `recordPremium`
call, which the next cycle can repair. Reporting a payment that never happened
marks an unpaid month as paid in CoverPool, and `lapse()` can then never become
callable on that policy. So the `UNKNOWN` case, an execution whose transfer the
mirror node would not return, counts as unsettled rather than assumed good.

### The premium chain is anchored on the due day, not on the last execution date

A policy due on the 31st has to run on 28 February and then on 31 March. Feeding
each clamped date back into the next step instead moves the whole rest of the
term to the 28th, which quietly shortens the cover the policyholder bought. Each
slot therefore carries the unclamped `dueDay` and the clamp is recomputed from
it every month.

## T06, the note series in ATS, 4 September 2026

### The series is ODI-COMP-2026-01, and Office stays a picker entry

The T06 ticket names `ODI-OFFICE-2026-01`; DESIGN.md 3.4 names
`ODI-COMP-2026-01` for the computer and mathematical group, with the principal,
the coupon and the attachment that go with it, and the backtest that opens
claims in April 2026 on the level form. MISSION says DESIGN.md wins on product.
The vault and the pool already carry `ODI-COMP-2026-01`, frozen at deploy time
with its thresholds and its maturity, and there is no setter for either. Issuing
the note under the other id would have left the two halves of the same
instrument disagreeing about which series they are.

So the note is `ODI-COMP-2026-01`, and its maturity is the vault's own
`1820082162` rather than a fresh twelve months from the issuance, so the day the
note matures and the day the vault returns principal are the same day. Office
and administrative support stays what DESIGN.md 3.4 makes it: the first entry in
the web picker, with the honest line that its cover has never been triggerable
since 2010.

### The note is issued through the ATS contracts, not through the ATS SDK

DESIGN.md 3.8 and the ticket both accept the SDK or the web application. Neither
is usable from a session with no browser: `SupportedWallets` at 8.0.0 is
Metamask, WalletConnect, DFNS, Fireblocks and AWS KMS, and the Metamask adapter
reads `globalThis.window.ethereum`. The web application path needs the same
extension plus a person to click through the wizard.

The note is therefore deployed by an `ethers` call to `IFactory.deployBond` on
the ATS testnet factory, with the ABIs taken from
`@hashgraph/asset-tokenization-contracts@8.0.0`, the package the SDK itself
depends on, and every later call goes to the bond proxy through the `IAsset`
ABI from the same package. The factory, the resolver, the bond configuration,
the request fields, the single partition and the credential library are all the
ones the SDK would have used. What is lost is the SDK's client side validation,
which this build replaces where it matters: the ISIN check digit the SDK never
runs, and the credential signature the SDK does run and the contract does not.

What is gained, beyond being able to run at all, is that `pnpm ats:issue` is a
real command a judge can run, rather than a description of a wizard.

### ERC-3643 here means the ATS compliance stack, not external T-REX modules

DESIGN.md 3.8 asks for "the ERC-3643 configuration: identity registry, KYC list
of investor test accounts, transfer restrictions, pause and freeze roles". In
ATS 8.0.0 that phrase splits in two. ATS bonds are ERC-3643 compatible out of
the box through their own facets, and the wizard's optional step 4, which is
`complianceId` and `identityRegistryId` on the request, is for wiring an
**external** T-REX compliance module and identity registry that have to be
deployed first.

This note takes the native path and passes the zero address for both. The
identity layer is the SSI issuer registry plus the per account KYC records, the
compliance layer is the internal KYC gate with the control list facets
available, and the restrictions are `ROLE_PAUSER` and `ROLE_FREEZE_MANAGER`.
Every behaviour DESIGN.md asks for is demonstrated in docs/ATS.md and enforced
by the note itself. Deploying a T-REX compliance module and identity registry
would have been a second contract project on the day allocated to this one, and
would not have changed a single thing a judge can see.

### The KYC mechanism is internal KYC, and it is the only one

Internal KYC and external KYC lists combine as an AND, not the OR the compliance
guide describes, so registering an external list as a fallback would have made
the gate stricter rather than safer. The note is deployed with
`internalKycActivated` true, which cannot be undone, and with no external KYC
list. Each grant carries a real `EcdsaSecp256k1Signature2019` credential signed
by the operator key, verified off chain before the call, with its id and
validity window written on chain.

The fallback, ATS's `MockedExternalKycList`, was not needed: the credential path
took under an hour end to end against the hour it was time boxed to.

Note for anyone reading the contract: `grantKyc` stores the credential id as an
opaque string and verifies nothing. The signature check is the caller's job, and
this build does it in `contracts/ats/credential.ts`.

### A coupon is declared by ATS and paid by a Scheduled Transaction

DESIGN.md 3.5 reads as though the ATS coupon action or the ATS mass payout
module moves the money. The coupon facet has no settlement token in it at all:
`setCoupon` records a rate and a window, snapshots the holders at the record
date and exposes each holder's entitlement as an exact fraction, and
`executionDate` is when the coupon becomes payable, not when anything is paid.

So the two halves stay separate on purpose. ATS declares, and a Hedera Scheduled
Transaction of the settlement token from the vault's premium account pays. The
link between them is recorded rather than inferred: the coupon id, the
numerator, the denominator, the computed amount and the settlement transaction
are stored together and published to the payments topic. That is T14.

Mass Payout was evaluated and cut. It is a NestJS backend, a PostgreSQL
database, a second frontend and a second Node major version, for two
noteholders.

### The demo coupon's record date is minutes out, not a month out

A live coupon takes its holder snapshot at the end of the month it pays for. The
first coupon on this series accrues over a real calendar month, 4 September to 4
October 2026, but its record date is five minutes after the declaration and its
execution date ten, so the declaration and the settlement can both be shown
inside the event. The accrual window, which is what the amount is computed from,
is real; only the snapshot instant is brought forward. Anything published about
the coupon says so.

### The ISIN is a generated test value under a user assigned country code

The factory validates the ISIN on chain and reverts an empty or wrong one, and
there is no registered ISIN for a demo instrument. The value is derived from the
series label under the `ZZ` prefix, which is user assigned in ISO 3166 and can
never be issued by a national numbering agency, so it cannot collide with a real
security. The rule and its tests are in `contracts/ats/isin.ts`.

### The vault's atsToken field stays zero, and the note address lives in the record

`CollateralVault.openSeries` stored `atsToken` as the zero address for
`ODI-COMP-2026-01`, because the note did not exist when the series was opened.
`openSeries` reverts `SeriesExists` on a second call and there is no setter, so
the field cannot be filled without redeploying the vault, which is out of scope
for this ticket and would invalidate every link already published for T04.

The field is therefore informational and zero in this deployment. The note
address of record is `series.ats.note` in
`contracts/deployments/testnet.json`, which is where T07 and the web app read
it. On any future deployment, `openSeries` is called with the note address and
the field carries it.

For T07: the series column should be `ats_contract_address` plus
`ats_contract_id`, not `ats_token`. The note is a contract and has no token id.

### The ATS scripts live in the contracts workspace and load no Hedera SDK

T03 fixed that `@hiero-ledger/sdk` and `@hashgraph/sdk` must never both be
loaded in one process. The ATS SDK pulls `@hashgraph/sdk@2.64.5`, so it would
have needed a workspace of its own. Going to the contracts directly removes the
question: `contracts/ats/` needs `ethers`, the ATS contracts package for its
ABIs and the credential libraries, and speaks to Hedera over the JSON-RPC relay
and the mirror node REST API only. The one Hedera SDK import in its graph is the
existing key derivation in `contracts/scripts/hedera/derive.ts`, which is
`@hiero-ledger/sdk` and is reused rather than copied so there is one derivation
in the build.

## T14, coupons and maturity, 4 September 2026

### A coupon is paid by scheduling the vault's own fundCoupon call

T06 settled the halves: the Asset Tokenization Studio coupon action declares the
rate, the accrual window and each holder's entitlement, and it never moves
money, because there is no settlement token anywhere in the coupon facet. This
is the other half, and it decides how the money moves.

The premium account is a balance inside `CollateralVault`, and a contract has no
key with which to sign the transfer inside a Scheduled Transaction. Two shapes
were available. The vault could pay the treasury account and a scheduled
transfer from there could pay the holder, which is two moves and leaves a
noteholder's coupon sitting in an operational account in between. Or the
schedule could carry the vault call itself, if a contract call can be scheduled
at all and if the vault sees the schedule payer as the caller.

Both halves of that condition were measured before anything was relied on. A
`ScheduleCreate` carrying a `ContractExecuteTransaction` was accepted on
testnet, executed at its expiry, and a scheduled `fundCoupon` with a zero amount
reverted `ZeroAmount` rather than on the role, which is only possible if the
caller was the api account holding `TREASURY_ROLE`. The evidence is in
docs/harness-notes.md.

So a coupon is one Scheduled Transaction per noteholder, carrying
`fundCoupon(seriesId, couponRef, holder, amount)`, created by the api account
with `waitForExpiry` true, an admin key and the memo
`creance coupon <series> <couponId> <holderRole>`. The settlement token goes
straight from the premium account to the noteholder and no intermediate account
ever holds it. `fundCoupon` pays only from `premiumBalance`, so the rule that a
coupon is never paid out of principal is enforced by the contract and not by the
script.

The acceptance line asks for "the ATS coupon action or mass payout module".
The answer is the coupon action, as the declaration half; Mass Payout was
evaluated and cut in T06 as a NestJS backend, a PostgreSQL database and a second
frontend for two noteholders. The scheduled `fundCoupon` call is the payment
half, and the link between the two is recorded rather than inferred.

The two step shape stays as the fallback and needs no new code:
`fundCoupon` to the treasury account and `scheduleTransfer` from there, both of
which already exist. It is what a network without schedulable contract calls
would need.

### The settlement amount is floor(numerator * 10^6 / denominator), and the remainder stays in the premium account

The entitlement ATS returns is an exact fraction in **whole currency units**,
because the on chain formula divides out both the token decimals and the nominal
value decimals. The settlement amount is that fraction times the settlement
token's own scale, truncated. Rounding up would pay out more than the note owes
across a holder list, so the remainder, `907200000000000` of a denominator of
`3153600000000000` for each holder of the first coupon, stays in the premium
account and is recorded next to the amount.

### The premium was seeded for the demonstration, and the live path is the watcher

The first coupon had to be paid out of a premium account holding nothing. No
policy has been bound against the demo series, because binding is T07 and T07 is
blocked behind T02, so there was no premium inflow to pay from.

`pnpm coupons:pay seed` therefore sends the coupon's own cost, 657.534246 TUSD,
from a policyholder account to the vault as a stand-in premium and attributes it
to the series with `attributePremium` from the api account, which holds
`TREASURY_ROLE`. Both halves are real: a native token transfer into the vault,
and the same attribution call the live path makes. What is missing is only the
policy that would have produced the premium.

The live path is unchanged and already specified: the premium schedule watcher
reads a settled premium and the api account calls `attributePremium` for it,
exactly as this step does. The 20 TUSD left in the vault by the T04 run through
belongs to the throwaway series and was deliberately not attributed;
`attributePremium` names a series, so only what this step sent was credited.

### Both noteholders were subscribed, so the note and the vault agree on the principal

Before this ticket the note had 100 units minted against a vault holding
nothing: `principalFunded` was zero for the demo series, so every principal
figure on an investor screen would have read zero against a note claiming
100,000 of principal. The two would have contradicted each other on camera.

`pnpm coupons:pay subscribe` moves 50,000 TUSD from each investor to the api
account and subscribes it on the investor's behalf, which is the flow DESIGN.md
3.8 describes, the API paying after the ATS mint. The vault now holds 100,000
TUSD against 100 units of 1,000, and `subscriptionOf` names each investor for
the redemption at maturity.

### Maturity is shown on a second, short dated series

Neither maturity date on the demo series can be brought into the event. The
vault froze 4 September 2027 at `openSeries` and has no setter, and the note's
`updateMaturityDate` only ever moves the date forward.

`pnpm coupons:mature` therefore opens a short dated series in the vault,
deploys a matching short dated ATS bond, subscribes both noteholders, waits and
redeems both sides: `fullRedeemAtMaturity` burns each note holding under
`ROLE_MATURITY_REDEEMER`, and `redeemAtMaturity` returns the principal from the
vault. It is labelled a maturity demonstration everywhere it appears, in the
series label itself, and nothing reads it as the demo series.

### Principal reduction after a payout is read from the T04 series, not paid again

"Principal reduced by payouts after a trigger" is already on chain: the T04 run
through paid one 10,000 claim against a 30,000 principal on a throwaway series,
and `principalRemaining` has read 20,000 ever since. `pnpm coupons:mature payout`
reads those three numbers off testnet and records them.

Paying a second real claim to show the same arithmetic belongs to T13, which
owns the claim path, and the rounding cases are covered exhaustively in
contracts/test/hardhat/collateral-vault.ts, including the 47,500 each after a
5,000 claim that DESIGN.md 3.4 sets out.

### The coupon settlement message on the payments topic, version 1

T06 assigned the payments topic entry for a coupon to this ticket and T18 builds
the read side, so the shape is fixed here and versioned.

    {"v":1,"kind":"coupon","series":"ODI-COMP-2026-01","seriesId":"0x4f44...",
     "couponId":"1","holder":"0.0.10366460","holderAddress":"0xb6c2...",
     "numerator":"1036800000000000000","denominator":"3153600000000000",
     "amount":"328767123","token":"0.0.10366463","scheduleId":"0.0.10368878",
     "transactionId":"0.0.10366450-1788556746-724064738","result":"SUCCESS",
     "paidAt":"1788556871.150984988"}

Every amount is an integer string in the settlement token's minor units, and the
fraction the amount came from travels with it so a reader can redo the
arithmetic against the note rather than trusting the publisher. `kind` is there
because premiums land on the same topic. A message is written only after the
transfer settled: a schedule executes whether or not the transaction inside it
succeeded, and publishing an unsettled execution would put a payment that never
happened into the audit trail.

### The investor endpoints stand alone in apps/api/src/investor

apps/api is still the T01 placeholder: no Fastify, no Postgres, no dependencies,
because building it is T07 and T07 is blocked behind T02. The two endpoints this
ticket owes cannot wait for that.

They are a self contained Fastify plugin that reads chain state directly, vault
views and the note over the JSON-RPC relay through ethers, and the coupon
settlements from `contracts/deployments/testnet.json`, which `pnpm coupons:pay`
writes. No database and no Postgres dependency. T07 registers the same plugin
and swaps the reader behind the `ChainReader` interface when the database
exists.

The plugin does not import from the contracts workspace, which would pull
Hardhat into the API: the ABI fragments it needs are written out in
`apps/api/src/investor/abi.ts`, narrow and all views. It reads the deployment
record as a data file, and every value in it can be overridden from the
environment.

Conventions follow what the rest of the API will use: snake_case fields, every
amount as `{amount, asset, decimals, display}` with `display` never parsed,
RFC 3339 timestamps in UTC, and RFC 9457 problem documents for errors. The
amount conversion lives in `packages/client/src/units.ts` so the API, the
Steward and the web app share one implementation.

## T10, web scaffold, 4 September 2026

### Design tokens live in @theme, not in a JS config

The acceptance line asks for "the tokens in tailwind config". Tailwind 4.3.3
has no `tailwind.config.js`: theme variables live in CSS, and a JS config is
only read if a stylesheet pulls it in with an explicit `@config` directive.
Keeping one would work and would keep the handoff's snippet copy-pasteable, and
it would buy a second place where a colour can be defined. So the `@theme`
block in `apps/web/src/app/globals.css` is the config, and the handoff's v3
`theme.extend.colors` snippet is translated there.

The default palette is dropped with `--color-*: initial`, so `bg-red-500` and
`text-gray-500` do not exist and cannot be typed by accident into a design that
has no brand accent. The cost is that any colour genuinely needed later has to
be added to the theme first, which is the point.

The block is `@theme static`. Tailwind emits only the theme variables some
utility used unless told otherwise, and a token sheet that silently loses
`--radius-hero` in the week nothing happens to use it is not a token sheet.

The utility source set is pinned to `src/` with `source(none)` and one
`@source`. Tailwind reads every file it can reach as a list of class name
candidates, prose included, and emits the matching utility for any word that is
one. See docs/harness-notes.md: a sentence about focus rings put the only
box-shadow in this build into the stylesheet.

The cost of all of this is that the token sheet's section 1 no longer matches
the code line for line. The sheet stays the source of the values and the
stylesheet is the form that ships.

### One elevation token exists, for the landing page, and nothing here uses it

`--elevation-hero` is declared once, in the global stylesheet, and no rule
applies it. The landing hero card is the only place it is ever permitted; a
card floating over a dark ground needs a separation a hairline cannot give.
Naming it once is safer than leaving a builder to invent a shadow. The two
marketing ground colours, `night` and `night-2`, are in the theme for the same
reason and are equally unused by any worker or investor screen. A test asserts
that no rule in the built CSS sets a box-shadow to anything but `none`.

### The typeface is Option A, and the switch removes the other family entirely

Inter Tight for display and numbers, Inter for text, at the weights the scale
uses and no others. Both families and all three weights resolve in
`next/font/google` at Next 16.3.4, which was the open question; Option B is not
needed.

Both options stay buildable behind `NEXT_PUBLIC_FONT_OPTION`, which defaults to
A. The switch is applied at module resolution in `apps/web/next.config.ts`
rather than as a branch in the layout. A conditional import is not enough: any
font module left in the bundle graph gets its `@font-face` and its preload link
emitted whether the branch runs or not, and building it that way shipped Geist
alongside Inter. Aliasing the specifier means the inactive family leaves the
build. Verified both ways: with A active the output has no Geist file, with B
active it has no Inter file.

Tabular figures are set once on `<body>` and removed where a running sentence
would look wrong, rather than added per figure. That is how "everywhere a
figure appears" is met without hunting.

### State colours are indicators, not text; axis and inactive tab labels move from ink-3 to ink-2

The sheet declares a contrast floor of 4.5:1 and asserts the palette clears it.
Computed WCAG 2.x ratios say otherwise in three places: `covered` is 4.41:1 on
canvas and 4.04:1 on surface, `watch` is 3.38:1 and 3.10:1, `triggered` is
4.77:1 on canvas but 4.38:1 on surface, and `ink-3` is 2.41:1 and 2.21:1. The
sheet's own component list puts `ink-3` on chart axis labels and the inactive
tab label, which are information.

So, applied throughout:

- the status pill's dot is the state colour and its label is `ink`. A 6px dot
  is a non-text indicator, needs 3:1, and all three state colours clear that on
  the near-white pill;
- chart axis labels and the inactive tab bar label are `ink-2`, not `ink-3`.
  Two greys still read as a clear active state;
- placeholders and disabled button text stay `ink-3`. Neither ever carries
  information, and disabled controls are exempt from WCAG 1.4.3;
- the cover card's occupation label is `ink`, not `ink-2`. The gradient's
  darkest stop is `#DFE2E7`, where `ink-2` is 3.89:1 and black is 16.17:1;
- the inline field error renders on canvas, outside a surface fill, where
  `triggered` is 4.77:1;
- hairlines at 1.25:1 stay. They are decorative separators, exempt under WCAG
  1.4.11, and nothing depends on perceiving one to operate anything.

The one state-coloured string in the product is the Index screen's display-xl
reading in the triggered state: 64px at weight 600 is large text, the floor is
3:1, and `triggered` on canvas is 4.77:1.

No darker grey was invented. Darkening `ink-3` until it reaches 4.5:1 lands on
`#73767B`, which is `ink-2` with extra steps. The gallery prints every token
with both computed ratios beside the swatch so this cannot be quietly undone.

### The wallet is a labelled demo mode behind a provider interface

Demo mode presents policyholder-1 from docs/HEDERA.md, account 0.0.10366453,
and says "Demo wallet. Testnet only." in `ink-2` wherever the wallet shows. The
mode comes from `NEXT_PUBLIC_WALLET_MODE` and defaults to demo.

Screens read one small interface: connect, disconnect, account id, EVM address,
mode. DESIGN.md section 3.6 makes the account id the signal a Selfie Check
binds to, so the account id is on the interface rather than hidden behind a
connection object. HashPack over WalletConnect can be added later without a
screen changing.

HashPack was not wired because it needs a Reown (WalletConnect) project id that
does not exist yet, and the Hedera testnet chain id 296, `hedera:testnet` in
CAIP form. Asking for `hashpack` today throws rather than falling back to the
demo account, because a demo that silently looks like a real connection is
worse than one that says what it is. No private key reaches the browser in
either mode; signing belongs to the API in T07.

### The worker flow at 1280 is the 390 frame centred on canvas

The sheet's tab bar is 80px high with a hairline top and two tabs, which is a
mobile pattern, and nothing in the sheet says what the worker flow looks like on
a desktop. The frame is centred on canvas with hairline sides above the `sm`
breakpoint. The alternative, a separate desktop worker layout, is a day of
design this event does not have, and the investor screens that genuinely need
desktop are already specified as desktop.

### The index chart is hand-rolled SVG with a local data shape

The sheet's chart rules switch off gridlines, dots, legends, area fills and all
but two axis labels, so a chart library would be mostly configuration to remove
things, and the band above a threshold with a one pixel lower edge is a custom
shape either way. It is about forty lines of SVG with the data mapped to pixels
in TypeScript.

The props type is local to the web app: points of period and value, threshold,
state and label, with `null` for a month with no observation. The API's index
payload does not exist yet, so T15 maps the endpoint onto this type rather than
this component learning about an endpoint. The y domain spans the data and the
threshold together with a tenth of the range as padding, and is never anchored
to zero: an occupation whose unemployment is usually below average has a
negative line and a negative threshold, and both have to draw.

### Dates are formatted in en-GB, in UTC, and September abbreviates to four letters

The locale is hard-coded, never the browser's, because the copy deck is British
English and a screen that reorders a date because a judge's laptop is set to
en-US is a defect. Every date the API sends is date-only, and
`new Date("2026-10-04")` is UTC midnight, which a browser west of Greenwich
renders as 3 October, so every date is built with `Date.UTC` and formatted with
an explicit UTC time zone. All of it lives in `apps/web/src/lib/format.ts` and
nothing else in the app formats a figure.

One consequence is visible: en-GB abbreviates September to "Sept", so a chart
axis label reads "Sept 2024" and not "Sep 2024". The four letter form is
correct British English and is kept. See docs/harness-notes.md.

### The public origin is carried by a second, public variable

`PUBLIC_SITE_URL` stays the canonical origin for the API, the World Developer
Portal and the x402 resource URLs. The web app reads `NEXT_PUBLIC_SITE_URL` for
the same value, because framework public variables are inlined at build time and
only a prefixed name reaches the browser bundle. Both are in `.env.example` with
the same default, and both must be set to `https://creance.co` before the
production build runs, not after.

## T07, the API, 5 September 2026

### The bind receipt goes to the payments topic, not the index topic

The acceptance for T07 asks for the receipt on the index topic. It cannot go
there: the index topic's submit key is the oracle's, and the api account cannot
write to it. Creating a fifth topic would be a change to `pnpm hedera:setup` in
the contracts workspace, outside this ticket's scope, and would give the read
side two places to look for a settlement record.

So the receipt goes to the payments topic, whose submit key the api account
holds. T14 already writes versioned messages there with a `kind` field, so a
`{"v":1,"kind":"policy",...}` message sits beside the coupons and the premiums
and one reader parses all three. The policy id travels in the message, so the
link from a payment to a policy exists in the direction that matters.

### A bind writes two topic messages, not one

`BindParams.hcsReceiptSeq` is an input to `CoverPool.bind`, so the receipt has
to be on the topic before the contract call. A call that then reverts would
leave a message on a public settlement record claiming a policy that does not
exist, and a message cannot be withdrawn.

So the first message carries `status: "binding"` and the second carries
`status: "bound"` or `status: "failed"` with the reason, the bind transaction
and the NFT serial, and quotes the first message's sequence number in
`receiptSeq`. A reader takes the second message as the outcome and the first
only as the sequence number the chain recorded. The alternative, a single
message written after the bind, cannot exist: its sequence number is the thing
the bind needs.

### The policy NFT is minted and frozen with the operator key

The CPOL collection's treasury, admin, supply and freeze keys are all the
operator's, set that way by `pnpm hedera:setup`. The api account, which holds
BINDER_ROLE, cannot mint a serial or freeze a holder against it.

The two ways out were a `TokenUpdate` rotating the supply and freeze keys to the
api key, signed by the operator admin key, or letting the API process hold the
operator key. The API process holds the operator key. This is testnet only, the
operator key already funds every account in the build and is already required by
`pnpm contracts:deploy`, and a key rotation on the collection would have to be
undone before any later ticket that mints outside the API. The API pays for the
mint from the api account and adds the operator signature only where the token's
own keys demand it, so the fee accounting still reads as the API's.

If this ever leaves testnet the rotation is the answer, and it is one
transaction.

### Every account key is derived from the operator key, including the API's

`HEDERA_API_KEY` is in the example environment and may be left blank. When it is
blank the API derives the key with HKDF-SHA256 over the operator key and the
label `creance/testnet/api`, which is exactly what `pnpm hedera:setup` did when
it created the account. A clone that has the operator key therefore has every
account, and no derived secret is ever written down. An explicit value wins,
which is what a rotation would look like.

The derivation moved from `contracts/scripts/hedera/derive.ts` to
`packages/client/src/hedera/keys.ts` so that the API can use it without pulling
Hardhat into its dependency graph. The contracts module re-exports it, so there
is one implementation and the day 0 setup and the API cannot derive different
keys for the same role.

### The API writes the observations table until the oracle exists

docs/INDEX-SPEC.md section 6.4 of the API note says the API never writes
`observations` and the oracle never writes anything else. That is the end state.
Today the oracle is T12 and does not exist, nothing has been published to the
index topic, and `GET /v1/index/:group` has to answer.

So the API loads the whole history from the committed archive under `data/bls`
at boot, through `packages/index-model`, and writes it into `observations` with
`ON CONFLICT DO NOTHING`, because the first published value settles forever. The
rows carry no HCS sequence number and no on-chain submission id, which is
honest: nothing was published. When T12 arrives it becomes the writer and this
becomes the path a clone takes before it has ever run the oracle.

### The observations table follows INDEX-SPEC, not the API note

Two shapes were on offer: the API note's `observations`, keyed on
`(series_id, period)`, and docs/INDEX-SPEC.md section 10's, keyed on
`(group_key, period, status)`. The second one is used, because the oracle owns
this table and the specification the oracle is built to is the one that has to
be satisfied. The consequence is that a revision arrives as a second row with
`status = 'revised'` beside the value that settled, rather than as an update.

A and L are not columns on it. They are frozen at issuance, they live in the
published calibration and on chain in `SeriesTerms`, and the API reads them
from the calibration so that all fifteen groups have them and not only the one
with a series behind it.

### The interim eligibility issuer, replaced by T11

`POST /v1/demo/eligibility` mints an eligibility credential without a World
Selfie Check. It exists so that `POST /v1/bind` can take a real credential and
enforce every rule around it today, rather than being built twice. It is
labelled in its own response body, it is not in the Bazantic OpenAPI document,
and `DEMO_ELIGIBILITY_ISSUER=false` turns it off.

T11 replaces the issuer and nothing else: the credential shape, the JWKS, the
audience check, the single-use `jti` and the wallet, group and series checks at
bind are all already here and already tested.

The credential is EdDSA over Ed25519 rather than an HMAC over a shared secret,
so that the Steward and the Bazantic gateway can verify a credential they are
carrying without holding a key that could also mint one. The public half is at
`GET /.well-known/jwks.json`.

### A quote takes no capacity hold

A quote reports the capacity as it stands and expires in fifteen minutes;
`POST /v1/bind` rechecks it under a row lock and against the chain, and
`CoverPool.bind` rechecks it again. Holding capacity would mean expiring holds,
and a hold that leaks is a series that cannot be filled. With one series and
three policyholders in the demo, a contended failure at bind is the better
trade.

### The premium comes from the DECISIONS formula, and it is not 15 to 30

The price is the guide rate from the distance to the level line multiplied by
the capacity term, which is the formula of record. Priced against the archive's
latest month, July 2026, the demo series quotes 96 basis points, which is 4.00 a
month for a 5,000 limit and not the 15 to 30 DESIGN.md 3.4 gives as the demo
number. The premium is a function of the month, and across the demo window it
runs from 4.00 in July 2026 to 50.42 in April 2026. The numbers are in
docs/harness-notes.md.

### The first premium is written as uncollected

There is no x402 gate in this ticket, so `POST /v1/bind` cannot collect the
first premium. It writes a `payments` row with `status = 'uncollected'` and a
null `facilitator_tx` all the same, so that T08 settles a row that already
exists rather than adding a second write path. The row carries the payments
topic sequence number of the bind receipt, which is the link the audit trail
needs.

### Plain SQL migrations, not an ORM

apps/oracle writes `observations`, `runs` and `source_files` in the same
database from T12. A schema owned by one application's model classes is a
schema the other has to guess at, so the schema is plain SQL files applied in
name order and recorded in `schema_migrations`, and the typed access is hand
written queries behind a repository interface. The interface has a memory
implementation so that `pnpm test` needs no database, and it enforces the two
rules that matter, the one active policy per nullifier per series and the
capacity check, so those are tested rather than assumed.

### recordPremium has a wrapper and no caller

`CoverPool.recordPremium(policyId, period)` is on the chain gateway, because
T09 needs it and writing it here cost nothing. Nothing in T07 calls it: a
premium has to settle before it can be recorded, and nothing settles until T08.

## T17, web investor screens, 5 September 2026

### The web app reads the API on the server, so there is no CORS plugin and no proxy

The two investor endpoints are read only and every figure on the investor
screens comes from them, so the screens are server components that fetch in
their own render. Nothing on either screen fetches from the browser.

That removes the choice the ticket set up. A CORS plugin on the API and a Next
rewrite in front of it are both answers to a browser making the request, and no
browser makes it. The origin therefore lives in `CREANCE_API_URL`, a private
variable rather than a `NEXT_PUBLIC_` one, so it is not inlined into the bundle
and a public deployment need not expose the API at all. It defaults to
`http://127.0.0.1:3210`, which is what `pnpm api:dev` listens on with no
configuration, so the two commands in the README work together out of a clean
clone with no environment file.

Both routes are `force-dynamic` with `cache: 'no-store'`. The principal, the
reserve and the coupons are live chain state and a prerendered principal would
be a wrong number rather than a stale one. When the API does not answer, the
route renders the error state instead of a figure.

### Two fields the T14 endpoints did not carry are added to the series view

Both are reads the screens need and neither existed. They are added to
`apps/api/src/investor` rather than derived in the web app, so two surfaces
cannot compute a different answer from the same chain.

**KYC.** The "KYC approved" and "Verification needed" pill is the note's own
internal KYC register, `getKycStatusFor(address)`, added to the note fragments
and reported per holder as `kyc: {status, granted}`. `granted` is false when
there is no note to ask: a holder nothing has approved is not an approved
holder, and null is not a state a pill can render.

**Capacity and the term.** The capacity rule of DESIGN.md 3.2 is the sum of the
active cover limits over the principal, and that sum lives in the CoverPool's
`SeriesTerms.activeExposure`, not in the vault. `seriesOf` returns the whole
struct in one call, so the term comes back with it, and the vault does not
store a term at all. Both are in a new `cover_pool` block. `capacity_used_percent`
is a whole number computed server side, so the screen never divides.

The term is stored in seconds and said in months. 365 days is not a whole
number of months, so `term_months` rounds against the average Gregorian month
and 31,536,000 seconds reads as 12. A series the CoverPool never registered
reads back as a zeroed struct, so `registered` carries that and the term and
the capacity rows do not render for it. The maturity demonstration series is
exactly that case.

### "If triggered" renders only while a reserve is held

The copy deck's "Principal at risk" block is "Currently 100,000, 100 percent
intact" and "92,500 if triggered". The first line is `principal_remaining` and
its share of `principal_funded`. The second is that figure less the CoverPool
reserve, and it renders only when the reserve is above nought.

The deck's 92,500 came from subtracting the bound cover limits, which is the
worst case a series could reach rather than a state it is in. The two figures
have since come apart on testnet: T07 has bound policies, so `activeExposure`
reads 2,000 TUSD while the reserve is still nought, and the screen shows
"Capacity used 2 percent" against a principal that is wholly intact. That is
the right pair of readings. A cover limit that is bound is capacity taken, and
capacity taken is what the capacity row measures; it is not principal at risk,
because no month is open and the vault has earmarked nothing. The worst case
line appears the moment `submitObservation` opens a month and the vault takes a
reserve, which is the moment there is a worst case to name.

### The copy deck's em dash becomes a comma, and a zero clause is dropped

Two copy changes, both mechanical, neither needing sign off.

The deck writes "Currently 100,000 — 100 percent intact". CLAUDE.md and the
addendum's house style rule both forbid an em dash in the product, so it is
"Currently 100,000, 100 percent intact".

The addendum's bar caption is "100,000 principal. 15,000 reserved while claims
are open. 5,000 paid so far." with the figures interpolated. A clause whose
figure is nought is dropped rather than rendered as a zero: "0 reserved while
claims are open" says a reserve is being held during a claim window for a
series whose claims are not open, which is false. With both at nought the
caption reads "100,000 principal. None reserved, none paid.", which is the one
string on these screens that is not in either sheet.

### The subscribe screen does not sign, and says so before the press

DESIGN.md 3.8 makes a subscription two calls by two roles: the operator issues
the note through the Asset Tokenization Studio under `ROLE_ISSUER`, and the api
account pays the vault on the investor's behalf under `SUBSCRIPTION_ROLE`,
which is what `pnpm coupons:pay subscribe` did. Neither key is in the browser,
the demo wallet holds an account id and an address and nothing that can move
value, and no subscribe endpoint exists. Both noteholders are already fully
subscribed on chain at 50,000 TUSD each.

So the screen is built and the flow is real up to the point where a signature
would be needed, and there it says what happens instead of pretending. The
amount step and the confirm sheet both carry the sentence naming the two calls
and the two roles, before the press and not after it. The screen that follows
reports `subscriptionOf` and the note position for the connected noteholder,
which is why "You're subscribed" is a true sentence, together with the first
coupon that actually settled and a link to its transaction. It never reports
the amount on the slider as having moved. MISSION rule 8: a screen that claims
a transaction it did not make is the thing that rule exists to stop.

### The investor screens present a noteholder, from the wallet module

The demo wallet was policyholder-1, which is deliberately not on the note's KYC
list, so an investor screen wired to it would show "Verification needed" and no
position. `src/lib/wallet.ts` now holds all three demo accounts and
`demoInvestorAccount()` returns investor-1, or investor-2 when
`NEXT_PUBLIC_DEMO_INVESTOR` says so. The account stays in the wallet module,
so no screen holds an address.

The screens read that function rather than running the connect flow through
`WalletContextProvider`. There is nothing to connect to and nothing to sign;
the wallet on these screens is the account id, the shortened address and the
demo label, which is what prep and the sheet ask for and all of which are
known without a session. The provider stays the route for the worker flow,
where a connection is a real step.

### A coupon in the history table is two decimals, and the exact figure is one click away

The first coupon settled 328.767123 TUSD to each noteholder. The table renders
it through `formatMoney` as 328.77, because the sheet's rule is two decimals
for money and the whole app formats every figure through one module. The exact
minor units are in the endpoint's own `amount`, and the row links the executed
transaction on HashScan, so nothing is hidden and no second money format is
invented for one column.

The principal figures next to it use a new `formatWholeMoney`, which drops the
decimals only when the amount is exactly whole. The copy deck writes a
principal as "100,000" and never as "100,000.00"; a part payment of 92,500.25
still renders in full rather than being rounded into a figure that looks whole.

### The overview shows the demo series and reaches the other one by query

`/invest` shows ODI-COMP-2026-01. `?series=` names another, which is how the
short dated maturity demonstration is read through the same screen. It is not
linked from anywhere: the endpoint has no series list to build a link from, and
the demonstration is a demonstration. The label on the screen is always the
series' own, so the two can never be confused.
## T08, x402 gating, 5 September 2026

### The three metered prices are 0.01 and 0.05 TUSD, and the bind is the quote's premium

DESIGN.md 3.7 fixes the index feed at "0.01 in the settlement asset or the HBAR
equivalent" and calls the quote fee "a small fee" without naming it. It is
0.05. The settlement asset is TUSD (0.0.10366463, six decimals), so the wire
amounts are 10000 and 50000, and both are configurable through
`X402_PRICE_INDEX` and `X402_PRICE_QUOTE`.

The HBAR alternative is not taken. Blocky402's testnet facilitator settles an
arbitrary HTS token, proved by a real settlement of TUSD, so nothing forces the
fallback; an HTS token in the settlement path is a named criterion for the
Hedera prize; and the Hedera exact scheme's own Money conversion refuses HBAR,
so pricing in HBAR would mean the explicit tinybar form everywhere for no gain.

`POST /v1/bind` has no price of its own. It costs the first month's premium
from the quote, which is a different number for every quote.

### The bind gate is a route handler, not an entry in the payment map

The other two endpoints are gated by `paymentMiddleware` from `@x402/fastify`
and its route map. `POST /v1/bind` is not, because its price depends on the
quote id in the request body and the middleware runs on Fastify's `onRequest`
hook, which is before the body is parsed. A dynamic price function there is
handed an undefined body. The measurement is in docs/harness-notes.md.

So `apps/api/src/x402/bind.ts` does the same sequence in the route handler, but
against the same `x402ResourceServer` object: the same requirements builder, the
same facilitator client, the same verify and settle calls, the same lifecycle
hooks and therefore the same `payments` row and the same topic message. What is
ours is the ordering, and the ordering is the library's `authorization` flow:
price, verify, bind, settle.

The alternative was moving the quote id into the query string so the price
function could reach it. An API shape should not be decided by a hook's
ordering.

### The x402 settlement message on the payments topic, version 1

The payments topic already carries `kind: "coupon"` from T14 and
`kind: "policy"` from T07. A settled x402 payment is a third kind, fixed here
and versioned, because T18 builds the read side from it.

    {"v":1,"kind":"settlement","endpoint":"GET /v1/index/:group","x402":2,
     "scheme":"exact","network":"hedera:testnet","payer":"0.0.10366451",
     "payTo":"0.0.10366450","amount":"10000","asset":"0.0.10366463","decimals":6,
     "tx":"0.0.7162784@1788602043.272119725",
     "facilitator":"api.testnet.blocky402.com","ref":"qte_01M1...",
     "at":"2026-09-05T09:54:13.000Z"}

`endpoint` is the route with its parameter rather than the concrete path, so
the messages group. `amount` is an integer string in the asset's minor units and
`decimals` travels with it, matching the coupon message, so a reader can render
the figure without knowing our token. `tx` is the facilitator's own transaction
id and it is the whole point of the message: a message is written only after the
facilitator reported a settled transfer, and a settlement with no transaction id
is logged rather than published. `ref` is the quote id or the policy id the
payment bought, and there is nothing else on the message: the topic is public,
so no nullifier, no credential and no wallet beyond the account that paid, which
is already visible in the transfer.

The row carries the topic id and the sequence number, so a payment points at its
own receipt.

### A settlement that fails after the bind leaves the policy bound and the premium failed

Settling after the handler is what makes a reverted bind free. The other side of
it is a bind that succeeded and a settlement that then failed: the policy is in
CoverPool, the exposure is committed and neither can be withdrawn.

The request still answers 201 with the policy, because the cover is real and
telling the caller otherwise would send them to retry a bind that would be
refused as `already_covered`. The `payments` row goes to `failed`, the failure
is logged with the facilitator's own `errorMessage`, which is the Hedera receipt
status, and nothing is published to the payments topic, because the audit trail
may not carry a payment that did not happen.

The policy status is not changed. `payment_failed` and `lapse` belong to the
premium schedule watcher, which is T09's, and a policy whose first premium never
settled reaches the same place by that route: `paidThroughMonth` is the month it
started in and the next unpaid month lapses it after the grace period.

### The first premium settled over x402 does not call recordPremium

The open question T07 left. It does not, and it should not:
`CoverPool.bind` already sets `paidThroughMonth` to the month the policy starts
in, so `recordPremium(policyId, period)` for that same month is a no-op by its
own `if (m > p.paidThroughMonth)` guard.

`recordPremium` gets its first caller in T09, from the premium schedule watcher,
for month two onwards.

### A settled payment whose topic message fails is a row, not a lost payment

The publish is retried three times with a doubling delay and every failure is
logged with the facilitator transaction id. If all three fail the `payments` row
is still `settled` and carries the transaction id, with a null `hcs_seq`, so the
reconciliation list is a query rather than a hunt through the log. The retries
are in process and do not survive a restart, which is the same trade the bind
receipt already makes; what does survive is the row.

### The payer sets its spend controls rather than taking the defaults

`@x402/core`'s client refuses, before any network call, an asset it does not
recognise as a network default, and caps a payment at one dollar. On
`hedera:testnet` the only recognised asset is USDC, and a first premium is more
than a dollar, so both defaults would refuse every payment this build makes.
`packages/client/src/x402/payer.ts` allows the settlement token explicitly and
takes a ceiling in minor units, which is a real control rather than an
inherited one: the server names the price and the payer refuses anything above
its own ceiling.

### Blocky402's testnet facilitator was used as it is, with no self-hosting

DESIGN.md section 8 offers self-hosting Blocky402 with Docker if the testnet
instance is unavailable. It was not needed: `https://api.testnet.blocky402.com`
answered `GET /health` and advertised `exact` on `hedera:testnet` with fee payer
0.0.7162784 throughout, and settled every payment this ticket made. No API key
and no account, which its own testnet documentation says is deliberate.

## T18, the audit trail, 5 September 2026

### The audit endpoint answers from the topic, and says where every entry came from

DESIGN.md 3.7 asks for an audit trail "verifiable independently of our
database". An endpoint that reads its own rows and formats them is not that, so
`GET /v1/audit/:policyId` uses the database only as the index into the topics:
the rows carry the sequence numbers, the mirror node carries the messages, and
the message body is what the response reports.

That leaves four honest answers rather than one, and each entry says which it
is in `source`:

    topic               read back from the mirror node, body and all
    awaiting_mirror     published, sequence number known, the mirror node has
                        not caught up; it lags consensus by seconds
    not_yet_on_topic    a row and no message, which is exactly the settled
                        payment whose publish failed, above
    mirror_unavailable  the mirror node could not be read at all

A trail that quietly showed a database row as a topic message would be worse
than no trail, because the whole claim being made is that the reader does not
have to trust us.

### The entries are free, so the fields of each message kind are named one by one

The endpoint is free, like `GET /v1/policy/:id`, and for the same reason it is
a whitelist rather than a copy of the message. Each kind contributes named
fields under `detail`. The holder's EVM address is on two of the messages the
payments topic carries and is dropped by exactly this; the nullifier is on no
message anywhere. The Hedera account ids that remain, the payer and the holder,
are already visible in the transfers on chain.

`detail` is an object rather than the kind's fields spread over the top level,
because five kinds put five different things behind names like `amount` and
`at`. Keeping them one level down means the top of every entry is the same
shape whatever the kind, which is what a list renderer needs.

### The premium, payout and claim messages are fixed now, before their flows exist

Acceptance line one names four kinds of payments topic entry and two claims
topic entries. Three of them have writers: `coupon` from T14, `policy` from T07
and `settlement` from T08. The recurring premium belongs to T09's watcher loop,
the payout to T13's `payClaim`, and the two claims messages to T13 and T25.
None of those flows exists yet.

So this ticket settles the shapes rather than leaving three later tickets to
invent them: `apps/api/src/audit/messages.ts` builds them, publishes them
through T08's outbox and tests them, and the ticket that grows the flow calls
the helper. Version 1 of each:

    premium        policy, period (YYYYMM), scheduleId, tx, amount, asset,
                   decimals, payer, at
    payout         policy, claimId, packetHash, decisionHash, amount, asset,
                   decimals, tx, at
    claim_packet   policy, claimId, packetHash, evidence (sha256 per file), at
    claim_decision policy, claimId, decisionHash, decision, at

An append-only topic cannot be corrected afterwards, which is what makes
agreeing the field names cheaper now than later.

### The claims publisher takes the key it is given

The claims topic's submit key is the adjuster account's, not the api account's,
so this API cannot write that topic at all. The publishers therefore take a
writer rather than reaching for a global one: apps/adjuster builds a client
with its own key and hands it in. The API reads the claims topic and never
writes it.

### A payout is written as a payments row as well, so the trail can find it

`claims` has `hcs_submitted_seq` and `hcs_decision_seq`, the two claims topic
pointers, and no column for a payout message on the payments topic. Rather than
adding one, T13 writes the payout as a `payments` row with the policy id as its
`ref`, which is what a payout is: a payment. The audit trail then picks it up
through the same path as every other payment, with a sequence number of its
own, and `claims.paid_tx` stays what it is, the on-chain transaction.

### An uncollected first premium points at the binding receipt, so the reader checks the kind

`POST /v1/bind` writes the first premium as `uncollected` and sets its
`hcs_seq` to the binding receipt's sequence number, because at that moment the
receipt is the only message on the topic; the settlement hook overwrites the
pointer when the transfer settles. So a payments row's sequence number is only
a payment message once the payment has settled.

The audit trail reads the message and looks at its `kind` rather than trusting
the pointer: anything that is not a payment leaves the entry on the row, marked
`not_yet_on_topic`, and the policy receipt is not reported twice.

### Timestamps are normalised, because the coupon writer stamps a consensus timestamp

The settlement, policy, premium and payout messages carry an RFC 3339 instant.
The coupon message carries `paidAt` as the consensus timestamp of the transfer,
`seconds.nanos`, which is the form the mirror node handed the coupon run. Both
are read here and both come out of the endpoint as RFC 3339 UTC, the form every
other endpoint uses. The `policy` binding message carries no written-at field at
all, so its entry uses the consensus timestamp the mirror node reports, which
is the better answer anyway.

### The parser lives in packages/client and tolerates a writer newer than itself

Three writers live in apps/api and contracts and this ticket does not move
them. The reader is one parser in `packages/client/src/audit.ts`, which apps/api
and apps/web both import, with a test that round-trips each writer's own output
and a second test against messages read back off the live topic.

It refuses to throw on anything. An unknown `kind` comes back as `unknown` with
its fields, and a `v` above 1 is read through its version 1 fields, because a
topic is append-only and shared: a later ticket adds a kind, and every deployed
reader has to keep rendering the history around it.

### The receipt screen's copy, chosen here because there is no deck for it

docs/DESIGN-TOKENS.md section 8 puts "View receipt" on the paid state and has
no screen behind it. The screen is built from the components the sheet already
specifies, a surface group of list rows in the 390 frame, and the words follow
the section 8 voice rules: payment, payout, receipt, and never bind, settle,
parametric or nullifier.

    Receipt
    Every payment on this cover, written to Hedera as it happened.
    Cover / Covered          Reference / pol_...FXA8
    Cover receipt            View on HashScan
    Payments
      Price quote            5 September 2026 - Recorded on Hedera
      Cover requested        Cover started        First payment
      Monthly payment        Payout               Coupon
      Claim sent             Claim decision
    View every payment on HashScan

An entry the API could not find on the topic reads "Not recorded yet", one it
is still waiting for reads "Recording on Hedera", and one it could not check
reads "Cannot reach Hedera". A receipt that showed a payment as recorded when
the message never arrived would be the one lie this screen must not tell.
Dates are en-GB in UTC, per the T10 decision.

## T15, web worker screens, 5 September 2026

### The Start screen stays at the root and the landing page is still nobody's

Affects T15 and whoever builds the landing page.

docs/DESIGN-TOKENS.md has two first screens: the app's Start and the marketing
Landing v2. T10 put Start at `/` as a holding page and this ticket wired it
rather than moving it, because moving it would break every link a reviewer
already has and the landing page has no owner. When the landing page lands it
takes `/` and Start moves to `/start`; nothing else in the flow changes.

### The purchase is a server side session, and the credential never reaches the browser

Affects T15 and T11.

The eligibility credential is a bearer token that binds a policy in the holder's
name. DESIGN.md 3.6 makes it single use and thirty minutes long. It is held in
`apps/web/src/lib/purchase-session.ts`, in the web process's own memory, keyed by
an opaque id in an httpOnly cookie, and the browser never sees it. The occupation,
the amount and the quote id sit beside it, so a reload in the middle of the flow
loses nothing.

Memory rather than a store, deliberately. The credential must not outlive the
process that minted it, and a purchase that survived a restart would present a
quote whose capacity check is long gone. The cost is that one web process serves
the demo, which is what a public deployment of this build runs anyway.

### The picker knows which occupations have capacity from a table in the web app

Affects T15 and T16.

Capacity is committed per occupation, so fourteen of the fifteen have no series
behind them and the picker says so rather than quoting a price nobody can buy.
There is no endpoint that lists series: `GET /v1/series/:id` answers for an id
you already know, and the only way to learn that a group has no capacity is to
ask for a quote and read the 409. So `apps/web/src/lib/occupations.ts` carries
the series behind each group, from docs/HEDERA.md, "The demo series", exactly as
the investor screens already carry `DEFAULT_SERIES_ID`. A `GET /v1/series` list
would replace both.

The same table carries the last month the index opened claims for each group,
from the backtest in docs/INDEX.md. Two of the fifteen have never opened since
2010, and the picker says that under the row: it is the one fact a buyer most
needs and it belongs on the first screen that offers them anything.

### The exhaustion in the Amount screen's sentence comes from the series of record

Affects T15 and T07.

"Full payout at 4 points" needs the series exhaustion, and the quote view carries
the attachment and the level line and not the exhaustion. It is read from
docs/HEDERA.md, "The demo series", which publishes E as 4.0 points for
ODI-COMP-2026-01, and the clause is dropped rather than guessed for a series with
no published exhaustion. The field belongs in the quote view.

The sentence itself is shipped as the copy deck writes it. It describes the shock
form only, and it names an exhaustion that matters only when `payout_mode` is
`indexed`, while the demo series is `full` and opens on the level form. That is a
disagreement between the copy deck and the product as DESIGN.md 3.2 and
docs/INDEX.md now define it, and the copy is Root's. It is flagged here rather
than rewritten.

### "Pays from" is the Hedera account id, not a shortened EVM address

Affects T15.

The quote's `pays_from` is a Hedera account id and docs/DESIGN-TOKENS.md section
9 shows a shortened `0x` address in the same row. The wallet interface carries
both, so this is a choice: the account id, tabular, unshortened.

It is eleven characters, so there is nothing to shorten and shortening it would
invent a format. It is also what the binding receipt, the policy NFT and HashScan
all name for the holder, so a judge who copies it out of the sheet finds the same
account everywhere. `shortenAddress` stays in the formatter for the EVM address,
which no worker screen shows.

### A negative level line is said as a distance from average, never as a signed number

Affects T15 and T16.

The pre kick-off decision "a consumer is never shown a signed index value" leaves
one place a signed number would still reach the screen: the chart's band label,
which docs/DESIGN-TOKENS.md fixes as "Pays out above 2.0". For the demo series
the line is -0.68, and "Pays out above -0.68" is both the signed value the
decision forbids and, read plainly, wrong.

The label is now interpolated by form and sign. The shock form keeps the deck's
string, because a shock attachment is a change against a year ago and is
positive. A negative level line reads "Pays out within 0.68 of average", because
a level line below zero means claims open when the gap to the all occupation rate
narrows to that many points. A positive level line reads "Pays out above 2.28
worse than average". `IndexChart` gained two optional props for this, `bandLabel`
and `description`, both defaulting to what T10 shipped.

### The trend word is computed in the web app, at a tenth of a point over three published months

Affects T15 and T16.

The copy deck's Home row is "1.1, steady" and the API's headline block carries the
form, the distance and whether it is open, and no trend. The trend is computed in
`apps/web/src/lib/worker-model.ts` from the same payload, over the last three
published months of the form the headline names: the index is rising when its
distance to the line fell by 0.10 or more, falling when it grew by 0.10 or more,
steady otherwise.

It is in the web app rather than the API only because the whole history is in the
one response, so two screens reading the same payload through the same function
cannot disagree. The 0.10 threshold is a decision, not a fact: CPS sampling noise
at the detailed occupation level is large enough that a smaller one would flip the
word most months. The months are published months and not calendar months, so the
October 2025 collection gap shortens the window rather than breaking it.

### The Verify screen ships the interim issuer, labelled, and does not imitate IDKit

Affects T15 and T11.

`WORLD_APP_ID` is blank in the environment, so there is no Selfie Check to run.
The screen keeps every string docs/DESIGN-TOKENS.md section 8 gives it, including
"Verify with World ID", and calls `POST /v1/demo/eligibility`. Under the two deck
sentences it carries one more, in ink-2, the same way the wallet says it is a
demo: the check is interim, it is testnet only, and it issues the credential
without running a World Selfie Check yet.

It does not imitate the IDKit widget. A screen that looks like a Selfie Check and
is not one is the one thing this state must not be.

"Waiting for the World app" is not rendered. It is the state where the check has
left for another application, and the interim issuer answers in one request
without leaving the device, so the button carries its own loading state instead.
T11 restores the wait along with the widget. The issuer sits behind one interface
in `apps/web/src/lib/eligibility.ts` so T11 replaces that file and no screen.

### The pay step is settled by a server side payer, and the sheet says so before the press

Affects T15, T08 and T09.

T08 put the x402 gate in front of all three endpoints the worker flow reads, so
the web app is a paying client of its own API: 0.01 for an index read, 0.05 for
a quote and the first month's premium for the bind. There is no wallet in the
browser that can sign, so the payment is made on the server by a payer holding
the key of the same account the cover is bound to and the NFT is minted to,
standing in for a wallet signature until HashPack is wired.

That is why every call in this flow was already made on the server. No key ever
reaches the browser, and the eligibility credential the bind carries as a bearer
token never leaves the server either.

The key is derived from the operator key with the same HKDF label the API uses
for its own account, `creance/testnet/policyholder-1`, so a clone with the
operator key can run the flow and no new secret is stored anywhere. The asset is
read from the 402's own price rather than configured, so the web app carries no
token id. The ceiling is 100 in the settlement asset: a premium runs from under
one to about fifty in an open month, so the ceiling is clear of a real price and
well under the account's balance.

The sheet carries a line above the button saying the first payment leaves the
wallet as soon as it is pressed. Before the press, not after it, which is the
same rule the subscribe screen follows.

The environment file is read by `apps/web/src/lib/payer.ts` rather than by the
framework, because the framework reads environment files from the application
directory and this repository keeps one at the root. It is done in that module
rather than at server startup: it is the only thing in the web app that needs a
secret, it is only ever loaded on the server, and node's loader does not
overwrite a variable that is already set, so a deployment that puts them in the
process environment is unaffected.

### The orchestrated moment is a CSS animation, so reduced motion is an instant state change

Affects T15 and T16.

docs/DESIGN-TOKENS.md section 6 has one orchestrated moment: after a payment
confirms the card slides up over 420ms while the amount counts up over 600ms,
and under `prefers-reduced-motion` both are replaced by an instant state change.

The slide is a keyframe animation in the stylesheet with
`motion-reduce:animate-none` on the element. A scripted transition would have to
render the card out of place and move it a frame later, and under reduced motion
that first frame is a visible jump rather than an instant state change. The
count up is the half CSS cannot express and `DisplayNumber` already skips it under
the same preference.

The moment runs on arriving from the Pay sheet and never again. `/home?bound=1`
is what says so and the query is dropped from the address as soon as it has been
read, so a reload is a plain Home rather than a second performance. Nothing polls
after the bind: the bind is settled by the time it responds, and polling for a
policy that already exists is how the moment gets minted twice.

### "What would have happened" is the twenty four months the feed carries

Affects T15 and T16.

The backtest runs from 2010, which is two hundred months and unreadable at 390
wide. `GET /v1/index/:group` carries twenty four months with an `open` flag on
each, so the strip is one mark per published month, hairline for closed and
`triggered` for open, with the two period labels and a two item key. Every mark
is a month the index actually published rather than a figure typed into the web
app.

The key is the only legend in the whole design. It earns its place: the marks are
otherwise unreadable and the alternative is a second axis on a phone.

The sentence the addendum asks for where a series has never opened, "This cover
has never paid for this occupation since 2010", needs the whole backtest and not
twenty four months, so it comes from the table in
`apps/web/src/lib/occupations.ts` described above.

### Six strings on these screens are in neither sheet

Affects T15. Each says what happened and what to do next, without apology, which
is the sheet's rule for every error in this product.

- Occupation picker, a group with no series: "No cover behind this occupation
  yet." The copy deck has nothing for it because it was written before capacity
  was committed per occupation.
- Occupation picker, a group whose claims have never opened: "Claims have never
  opened for this occupation since 2010."
- Occupation picker, self declaration, which DESIGN.md 3.6 asks to be said: "You
  tell us your occupation. We do not check it against an employer."
- Amount screen, a series at capacity: "This series is full. Choose a smaller
  amount or try again later."
- Index row caption: "Points from opening claims." with the figure beside it,
  because the deck's "1.1, steady" carries no unit and the distance framing needs
  one.
- Every screen, the API unreachable: "We can't reach the index right now." with
  the command that starts it, which is the worker flow's copy of what the
  investor screens already say.

## T20, the Harness contribution, 5 September 2026

### The contribution is the mirror node read the harness promises and does not ship

Of everything in docs/harness-notes.md, the candidate chosen is the mirror node.
Tier 3.5 CHAIN says it "verifies effects via mirror node" in src/types.ts and in
docs/authoring-a-recipe.md, and the validator prompt tells the evaluator agent to
treat the mirror node as keyless ground truth, but the harness ships no
mirror-node code at all: the only fetch in src/ is the dev-server health probe.
So an endpoint list and the sentence "poll up to ~30s for mirror lag" is the
whole of it, and four things our notes measured are left to a non-deterministic
agent to rediscover on every run: entity endpoints answer 404 for a second or
two after consensus and then 200 (T03 and T07 notes), /topics/{id}/messages
answers 200 with an empty list for a topic that does not exist so it cannot
answer existence at all (T03 note), the SDK's transaction id form is rejected
where the mirror form resolves (T08 and T18 notes), and the error text a real
Hashio outage emits matches none of the patterns in src/evalInfra.ts (T04 note),
so a transient outage is graded as an app defect and burns the repair budget,
which is the same defect class the maintainers fixed for the missing browser in
1.2.1. The other candidates were rejected as duplicates or as too thin: the
association and ED25519 points our notes carry are already open PRs #15 and #16
against the same files, the HOL Guard validator is open issue #8, and the DER
secret-pattern gap in src/specDefaults.ts is real but is a four-line regex change
with no developer-experience story to show. The PR targets dev rather than
master because dev is 2.0.0-rc.4 and every maintainer merge since 26 August went
there, so a PR against master would be against code that has already moved:
schema v3, Claude as the default agent, @hiero-ledger/sdk and playwright shipped
with the harness, src/evalInfra.ts and src/preflight.ts. It is
https://github.com/hedera-dev/hedera-harness/pull/39, and it adds
src/validation/mirrorNode.ts with 18 offline tests, makes provisionChainSigner
wait for the ephemeral signer on the mirror node before the run is graded,
extends the infrastructure classifier, and corrects the validator prompt.

### The harness fork is not vendored into this repository

The contribution lives in the fork at
https://github.com/resistingdestiny/hedera-harness, cloned outside this
repository. Nothing from the harness is copied in and this repository does not
depend on it, so T20 touches only the four documentation files in its scope. The
one piece of our own code that crossed over is the transaction id conversion
that hashscanTransactionUrl in packages/client already does, rewritten there as
normalizeTransactionId; it is recorded in docs/STARTERS.md.

## T12, the oracle worker, 5 September 2026

### The replay publishes to the index topic, not to a second replay topic

The demo clock replays real published BLS months for real periods. The messages
it produces are byte for byte the messages the live path would produce for those
periods: the same source rows, the same source hash, the same numbers, the same
signature. There is nothing about them to quarantine.

A second topic was considered and rejected. The index topic is the settlement
record and it had zero messages before this run; publishing the real history
somewhere else would have left the settlement topic empty while the settled
months sat on a topic labelled as a rehearsal, which is the wrong way round. The
replay is also the only path that will ever publish the months before the event,
because the live path starts from the newest month the source carries, so a
separate topic would mean the settlement record could never carry its own
history.

The mode is not lost. Every stored observation carries `mode` and a `replay`
boolean, which is the column T07's schema adds, and the run state the API serves
carries it too. What is deliberately not in the message is a replay flag: the
message is a statement about a month, and that statement is identical whichever
command made it.

Scenario mode is the opposite case and is treated as such: see below.

### A scenario never writes the index topic and never calls the contract

A scenario carries synthetic rates. Two rules follow, and neither is a flag a
hurried operator can pass by accident.

It never calls `submitObservation`. A synthetic observation on the demo series
would move `lastObservedMonth`, could open a month, could take a reserve, and
would sit in the settlement history of a real series permanently. There is no
argument that turns this on; the code path does not exist.

It never writes the index topic. A first published value settles forever, and a
synthetic message on the settlement topic could not be told from a real one by a
reader who has only the topic. A scenario publishes to `HEDERA_TOPIC_SCENARIO`
when one is configured and otherwise to the local observation store alone, which
is enough for the screen: the run state carries the scenario label and the web
app shows it in place of the REPLAY badge.

A scenario is an overlay on the real archive rather than a file of invented
rows: it names one group and replaces that group's published rate in a few
months, and every other series, the all-occupation rate and every other month
stay the real source. docs/INDEX-SPEC.md section 5 says replay and scenario
bypass fetch and still pass qa, and a one-group file could not: the completeness
gate needs all sixteen series and the consistency gate needs the aggregate. An
overlay passes or fails the same gates a live month does. Overriding a month the
source never published is refused, because a fabricated row would sail through
the completeness gate that exists to catch exactly that. The source hash is
taken over the rows the computation used, so a scenario's hash never matches the
archive's and no reader can mistake one for the other.

The committed scenario is `apps/oracle/scenarios/comp-shock-2026.json`, which
raises the computer and mathematical rate for February to April 2026 so those
months open on the shock form instead of the level form. It is not needed for
the demo: DESIGN.md 3.4's window opens on real data.

### The message carries `source` and `source_hash`, not `source_files`

docs/INDEX-SPEC.md section 7 offers an array of source file objects; DESIGN.md
3.3 offers a single `source` string with a `source_hash`. This build publishes
the compact pair. The archive path uses seven source files, and the array form
with a url, a sha256 and a row count for each pushes the message past the 1 KB
cap that keeps an HCS message a single chunk. The published messages are 553 to
571 bytes with the compact form.

Nothing is lost. The full file list, with a sha256 and a byte count for each, is
stored beside the message in the observation store, and it is what the
provenance QA gate reads. `source_hash` is not the hash of a response body: it
is the sha256 of the JCS form of the extracted source rows for the six calendar
months the computation used, t to t-2 and t-12 to t-14, so two runs over the
same published data produce the same hash even though the two response bodies
differ in a timestamp.

### The signature is secp256k1 over sha256 of the canonical JSON, without a prefix

Stated exactly, because T07's API and a judge both have to reproduce it.

    1. take the message bytes off the topic and parse them as JSON
    2. remove the "sig" member
    3. canonicalise what is left with JCS, RFC 8785
    4. sha256 those bytes; that 32 byte digest is what was signed
    5. recover the secp256k1 address from "sig", which is 65 bytes, r then s then v,
       hex with an 0x prefix
    6. it must equal the oracle account's EVM address,
       0x8aaf5b093842dc2e32f56bad9534d12a83861301

There is no EIP-191 personal message prefix and no EIP-712 domain: the digest is
the plain hash of the canonical bytes. A prefix would have been the more
conventional choice, and it was rejected because it makes the digest depend on a
convention a non-JavaScript verifier has to know about, where the plain hash
depends only on RFC 8785 and sha256. The address form was chosen over a raw
public key because the oracle's EVM address is already published in
docs/HEDERA.md and is the same identity the ORACLE role holds on CoverPool, so
one value verifies both halves of an observation.

`pnpm oracle:verify` is that procedure as runnable code. It also checks that the
bytes on the topic are their own canonical form, so a reader cannot be shown one
key ordering and a signature over another.

### A month with no evaluable ODI is submitted as the smallest int64

docs/INDEX-SPEC.md section 4 publishes `"odi":null` when the months t-12 to t-14
are missing, and the contract's `odi` is an `int64` with no null. The value sent
is `-9223372036854775808`, the smallest int64.

It cannot satisfy `odi >= attachmentShock` for any attachment the calibration
produces, the smallest being 1.5 points or 15000, so a null ODI can never open
the shock form. It is not a value the index can produce: the archive's extremes
since 2000 are inside ten points. It is unmistakable in an event log, which a
sentinel like zero would not be, and zero would additionally be a plausible
reading. The only arithmetic the contract does on `odi` is the indexed payout
formula, and that runs only on a shock opening, which this value can never
produce; it is widened to `int256` there in any case.

The published message still carries `"odi":null`. The sentinel exists only at
the contract boundary.

### `no_source` is a fourth published status

docs/INDEX-SPEC.md section 7 lists three statuses: final, insufficient_history
and revision. This build publishes a fourth, `no_source`, for a month the source
never collected.

October 2025 is that month for every LN series: value `-`, footnote code 9, the
2025 lapse in appropriations. A month with no source value at all is a different
fact from a month whose smoothing window happens to be incomplete, and flattening
the two into one word would tell a reader the November 2025 story about October.
Both are published, neither is submitted on chain, and the index page can say
which is which. The status appears in the published run as sequence 10 on the
index topic.

### The jump gate keeps a 24 month calendar window and a minimum of 12 values

docs/INDEX-SPEC.md section 8 sets the jump gate at five standard deviations of
the trailing 24 months. The collection gap means no group has 24 smoothed values
in that window for any target month from October 2025 to September 2026:
`ebar` is undefined for 2025-10, 2025-11 and 2025-12.

Demanding all 24 would have switched the gate off for fifteen consecutive
months, including the two the demo settles on, and a gate that abstains exactly
when the data are most disturbed is worse than no gate. The window therefore
stays 24 calendar months and the gate runs on whatever those months collected,
provided at least twelve values exist. Below twelve it abstains and says so in
the gate's detail line, because a standard deviation over a short window is not
a tighter test, it is a noisier one.

### The mapping gate hashes the canonical form of the mapping, not the file bytes

The gate compares sha256 of the JCS form of `series-map.json` against a constant
frozen in `apps/oracle/src/qa.ts`. Hashing the canonical form rather than the
file means reformatting the file is not a settlement event while changing a
series id is. The gate also checks that the mapping and the frozen calibration
name the same catalogue file and the same series id for every group, which is
the drift that would actually matter: a calibration computed against one mapping
and applied to another.

Changing `FROZEN_SERIES_MAP_SHA256` means the trigger universe moved, which
docs/INDEX-SPEC.md section 3 forbids once anything has settled, so a change to
it needs its own entry here.

### The run state is a JSON file, and the API reads it rather than importing the oracle

T07's Postgres schema is not merged. The oracle writes
`var/oracle/replay-state.json` and the API reads it, both through
`ORACLE_STATE_PATH`, and the observations go to `var/oracle/observations.json`
behind an `ObservationWriter` interface that a Postgres writer replaces without
the pipeline noticing. Both paths are gitignored.

The reader is duplicated in `apps/api/src/replay/state.ts` rather than imported
from `apps/oracle`: an API that imports a worker in order to render a badge has
the dependency the wrong way round, and the file is a contract between them
thirty lines wide. Every field is coerced on read, so a half written or hand
edited file cannot make a request throw; the badge is decoration and the topic
is the record.

`readReplayState` is exported separately from the route, because T21's
`GET /health` and T26's `GET /v1/index/health` both have to include this state
and neither should have to call an endpoint to get it. The endpoint itself is
`GET /v1/replay`, a standalone Fastify plugin in its own directory registered
from `server.ts` with one line, exactly as `investorRoutes` is.

### The run state is served from /v1/replay, outside the metered prefix

It was `GET /v1/index/replay` while this branch was written against a main that
had no payment gate. T08 landed one, and its index route is metered on the glob
`GET /v1/index/*` with a `matches` test of `path.startsWith('/v1/index/')`, so
the badge answered 402 the moment payments were configured. Measured on the
merged branch before the move: 402 with a `PAYMENT-REQUIRED` header quoting
10000 units of TUSD, for a thirty line JSON file that reads no chain and no
database.

The endpoint moved out from under the prefix rather than being carved out of it.
A carve-out would have had to hold in two places that cannot be kept in step by
the type system, the `matches` predicate and the glob handed to the x402
middleware, and every later free route under `/v1/index/` would have had to
remember both. The path a payer meters is now exactly the prefix, with no
exceptions to read.

Nothing consumed the old path. The web app reads the `replay` boolean on the
index view, not this endpoint.

T26's `GET /v1/index/health` has the same problem and needs the same answer: a
health reading is not an index reading and must not sit under the metered
prefix. `GET /v1/health` or a carve-out proved by a test, and the first is
smaller.

### The HKDF key derivation is copied into apps/oracle, then imported once T07 landed

`contracts/scripts/hedera/derive.ts` holds the same loop. Importing it would
drag Hardhat and its plugins into the dependency graph of a worker that makes
one contract call. The oracle reads `HEDERA_ORACLE_KEY` first and derives from
`HEDERA_OPERATOR_KEY` only as a fallback, so the copy was on the path a clone
with one key takes, not the normal one.

T07 has since moved the same code to `packages/client/src/hedera/keys.ts`, and
merging main into this branch made that package a dependency the oracle already
had. The copy is gone: `apps/oracle/src/keys.ts` now imports `roleKeyHex` and
`normaliseRawKeyHex` from there and re-exports them, and holds only the
environment reading that is the oracle's own. Two implementations of a key
derivation is two chances to derive a different account for the same operator
key, and this one signs settlement values.

### The replay proof run stopped at April 2026, and the demo needs a fresh series

The run recorded in docs/HEDERA.md walked January 2025 to April 2026 for
ODI-COMP-2026-01. That series now has `lastObservedMonth` 24315, status
ClaimsOpen and a reserve of 3,000 TUSD taken.

Those months can never be replayed on that series again. `submitObservation`
reverts `PeriodNotAfterLast` for any month at or before the last observed one,
which is the rule that stops a backfilled month moving a loss window a claim was
already judged against. The run stopped at April rather than running on to July
so that May 2026, which also opens on the level form, is still available as a
second opening if one is wanted on camera.

T24's demo replay therefore needs one of two things, and the choice is the
demo's, not the oracle's: either the admin registers a fresh series for the
recording, or the replay runs publish-only with `--no-submit` against a chain
state that already holds the April opening. The second is the cheaper take and
shows the same screens; the first is the one that shows the reserve being taken
live.

### The observation row is written between the two network calls, and resuming is the retry

Publishing an observation is two writes that cannot be one transaction: an HCS
message, and a contract call carrying the sequence number that message returned.
The local row is written between them, not after both.

The row is the only thing that stops a later run publishing a period twice, and
an HCS message cannot be retracted, so the row has to be durable before anything
that can throw runs. A run that dies in the contract call leaves the row with
`hcs_seq` set and `submit_tx` null; the next run over that window republishes
nothing and does the contract call alone, sending the sequence number and the
source hash of the message that is actually on the topic rather than recomputing
them. Recomputing would be wrong rather than merely wasteful: if the source were
revised between the two attempts, the value on chain would be one no published
message supports.

One window is left open deliberately. A process killed between the topic receipt
and the row write leaves a message with no row, and the next run would republish
that period. Closing it needs the topic read back through the mirror node before
republishing, which needs the runs table to know which periods a previous run
was in the middle of. That is T26's work, and the mirror node client already
lives in this workspace for it. It is recorded here rather than left implicit
because it is the one known gap in the first-final guarantee.
