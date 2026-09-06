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

Affects T15 and T11. Superseded by T11, "The World issuer replaces the interim
one and the interim one stays": `WORLD_APP_ID` is filled in now, the screen runs
the Selfie Check, and the interim state below is what a clone with no World app
still gets.

`WORLD_APP_ID` was blank in the environment when this was written, so there was
no Selfie Check to run.
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

### The published-already guard spans live and replay, and mode is only a label

The store keyed a row by run mode as well as group and period, so a period the
replay had published was invisible to the live path, which published its own
message for the same month. The two commands' defaults meet: `pnpm oracle:replay`
walks to the newest month the source carries and `pnpm oracle:once` defaults to
that same month, so the demo replay followed by the live path put two messages
for one group and month on the index topic, both with `revises_seq` null. They
also read different rows by default, `--source archive` against `--source api`,
so after a BLS revision the two messages need not even carry the same value,
with nothing on the topic linking them or saying which one settles.

The question the guard asks is whether this group and period already reached the
index topic, and the answer cannot depend on which command put it there. Live
and replay now share one namespace, `publicationScope` in apps/oracle/src/store.ts.
A scenario keeps its own, because a scenario publishes no index message at all
and its rows must never stand in the way of a real run.

`mode` stays on the record. It is what a public query filters the demo clock out
by, which is the reason it exists, and a skipped period now reports the mode that
published it rather than the mode asking. This follows docs/INDEX-SPEC.md section
10 rather than departing from it: the specification puts `mode` on the runs table
and keys observations by group and period, not by mode.

The chain call was never at risk. `submitObservation` is guarded separately by
`observationOf().present` and `lastObservedMonth`, and the contract reverts
`ObservationExists` regardless, so the duplicate was on the settlement topic
alone. T26's Postgres writer replaces this file and has to carry the same rule:
the unique index belongs on group and period, not on group, period and mode.

## T09, the Steward agent, 5 September 2026

### The decision rule, written down

DESIGN.md 3.7 gives the rule in one sentence, "buy if no active policy and the
ODI three-month trend is rising, or at annual renewal", and leaves three things
open. They are settled here and implemented as one pure function,
`apps/steward/src/rule.ts`, whose inputs and result are printed in the run and
published in the journal entry.

Which field: the `odi` on each month of the history the paid index read returns.
Not `ebar`, which is what the level form of the trigger compares, and not the
trigger status. The rule is about the direction of the displacement signal, not
about whether claims are open today.

Which three months: the vantage month and the two before it, all three
consecutive calendar months with a published ODI. The source has real holes in
it, October 2025 was never collected, and three readings that are not three
consecutive months are not a trend; the rule reports `incomplete_window` instead
of calling them one.

What counts as rising: strictly increasing across the three, compared as
decimals rather than as floats, because the endpoint publishes decimal strings
for the reason docs/DECISIONS.md already gives for index values. Two equal
months are not a rise.

The whole rule, in order: hold when cover is in force and is not near its
renewal; buy when the trend is rising; buy when the last policy is inside the
last 30 days of its term; hold otherwise. The renewal limb needs a policy to
renew, so it is read as "no active policy, and either the trend is rising or the
term is running out", which is the only reading in which the renewal clause does
any work.

A hold is a real outcome: the cycle still writes its journal entry and exits 0.
An agent that only ever reports buying is not running a rule.

### The rule's vantage month can be an earlier month, and it is labelled

The rule as written says nothing about which month it stands in, and the
default is the newest published reading. `--as-of YYYY-MM` stands it in an
earlier month of the same published history, which is the labelled replay
DESIGN.md 2 already gives the demo clock, and it is disclosed in three places:
the run prints `(replay, labelled)` beside the vantage, the journal entry
carries `rule.replay: true` on chain, and the transcript says so at the top.

It is needed because the demo group's own history says hold. At the newest
month in the committed archive, 2026-07, the computer and mathematical ODI runs
0.07, -0.13, -0.07: falling, so the rule refuses to buy, and it does refuse when
the command is run with no options. The transcript in docs/demo/steward.txt is a
run where the rule said buy, so it stands in July 2024, where the same published
series runs 0.27, 0.40, 0.60. Nothing is invented and no scenario file exists:
the numbers are the ones the index endpoint returned in the same run.

### The premium chain creates every month that fits the 62 day cap and defers the rest

The acceptance line asks for the next three premiums as Scheduled Transactions.
At a real monthly cadence they fall about 30, 61 and 91 days out, and a
`ScheduleCreate` is rejected with `SCHEDULE_EXPIRATION_TIME_TOO_FAR_IN_FUTURE`
more than 5,356,800 seconds, 62.0 days, past the consensus timestamp of the
create (T05 above). So the third cannot be created at bind and the second sits
inside the last day of the window.

`premiumPlan` therefore plans all three, creates the ones inside the cap less a
five minute margin, and reports the rest as deferred rather than failing. The
deferred months are the watcher's: `scheduleNext` in packages/client creates the
following month when one executes, which is the shape T05 already fixed. The
periods it left behind go into the journal entry under `deferred`, so a reader
of the topic can see the gap rather than infer it.

The compressed demo cadence, `--cadence demo`, puts the due dates seconds apart
and all three then fit, which is what the transcript runs. Both cadences run the
same code: the helper takes an `executeAt` and never a duration, and the
accounting period on each slot still steps one calendar month, because the memo
is what names the month a premium is for and the execution timestamp never can.

### The agent pays for its own schedules, and holds their admin key

`scheduleTransfer` names one payer and it pays for everything: the create, the
execution and the premium itself. That payer is the Steward account, whose
purpose in docs/HEDERA.md is "buys cover over x402 and pays the premium
schedule", and the payee is the api account 0.0.10366450, the same account the
first premium settles to over x402. One signature completes the whole
arrangement, so a premium is pre-signed in one round trip.

Every schedule carries an admin key, the Steward's own, because a schedule
without one is immutable and DESIGN.md 3.5 lapses a policy 15 days past a missed
premium: the only way to stop the premiums a lapsed policy has already pre-signed
is `ScheduleDeleteTransaction` signed by that key.

### Nothing calls recordPremium yet, and the journal is what the watcher will read

`CoverPool.recordPremium` is `onlyRole(BINDER_ROLE)`, held by the api account,
so the Steward cannot call it, and no API route exposes it. T08 recorded that
the first premium needs no `recordPremium` because `bind` sets
`paidThroughMonth`, and that the call gets its first caller "in T09, from the
premium schedule watcher, for month two onwards". That watcher is not in this
ticket: apps/api is out of scope here and under another lane's ticket, and
adding a route to it would collide.

So the gap stands and is stated rather than hidden. The run prints it, and the
schedule ids, their memos and their periods go into the journal entry so the
watcher can find them from the topic alone. Until something makes that call, a
paid month two looks exactly like a missed one and `lapse()` becomes callable
once the 15 day grace past `paidThroughMonth` runs out. The backlog line this
needs is a premium watcher plus a `recordPremium` endpoint, lane B.

### The journal message is snake_case, version 1, and never carries the person

The agent-journal topic 0.0.10366475 has no submit key and is public by design,
so the Steward submits to it under its own account and anybody can read it back.
One message per cycle, whatever the cycle decided.

The fields are snake_case, unlike the payments topic messages that came before
it, which mix camelCase into the same object. The journal is a new topic with no
existing readers, snake_case is what every API payload in this build uses, and
the alternative was matching an inconsistency for the sake of it. Amounts follow
the convention that does hold everywhere: an integer string in the asset's minor
units with the asset and the scale beside it.

It carries the agent, the principal's wallet and group, where the eligibility
credential came from, the rule's inputs and its result, the quote and policy
ids, the NFT serial, the three settlement transaction ids, the schedule ids with
their periods and the periods the cap deferred. It never carries the nullifier,
the credential or anything else derived from the person. Like every other topic
message in this build it is refused rather than chunked over 1 KB; a full buying
cycle comes to about 920 bytes.

### The agent keeps one pointer file per principal, and the API decides the rest

"No active policy" needs state, and no endpoint lists a wallet's policies. So
the Steward writes the id of the last policy it bound for each principal to
`var/steward/<principal>.json` and reads the live status back from
`GET /v1/policy/:id`, which is free. The file is a pointer and never a copy: the
status, the dates and the premium always come from the API.

Losing it is not a correctness problem. The agent would buy again and the bind
would be refused with `already_covered`, because one active policy per nullifier
per series is enforced in the API and not in the agent.

### The renewal limb reads cover_ends, not term_months

The policy view carries `cover_starts` and `cover_ends` and does not carry
`term_months`, which is on the quote. So "at annual renewal" is read as
`cover_ends` falling inside the next 30 days, which is the same question and
needs one field rather than two.

## T11, the World Selfie Check, 5 September 2026

### One action or two, and what that costs the claim

Affects T11 and T13.

DESIGN.md 3.6 asks for two things that cannot both be true. It names two actions
in the Developer Portal, `occupation-cover-eligibility` and
`occupation-cover-claim`, and it says the claim's check must produce "the same
nullifier as the purchase". A nullifier is scoped to the app and the action, so
two actions produce two different identifiers for one person. No configuration
changes that.

The resolution is one registered action for both steps, told apart by the
signal: the wallet id at purchase, the policy id at claim, and
`require_user_presence` only at claim. Then the purchase and the claim return
the identical nullifier, "the same live person bought the cover and collects it"
is a check rather than a story, and "one active policy per person per series"
and "one claim per person per series" are the same key in the same column.

The Developer Portal is Root's, and this session cannot register an action in
it, so the action names stay configuration. `WORLD_ACTION_ELIGIBILITY` and
`WORLD_ACTION_CLAIM` are read separately and both are passed to the signer, so
setting both to one registered `occupation-cover` is a `.env` edit and a
restart. `GET /healthz` reports `world.continuity`, which is true exactly when
the two are the same string, so which regime is running is readable from
outside.

What T13 inherits, explicitly, so it inherits no ambiguity:

- When `world.continuity` is true, the claim check's nullifier must equal
  `policies.nullifier` and there is nothing to add to the schema.
- When it is false, the claim's nullifier is a different number and T13 adds a
  `claim_nullifier numeric(78,0)` column to enforce one claim per person per
  series on it. The continuity claim then weakens to "both were live people and
  the claimant controls the policy wallet", and the README and
  docs/FEEDBACK-WORLD.md have to say exactly that. Overclaiming a property a
  judge can check is worse than the property being absent.

### The World issuer replaces the interim one and the interim one stays

Affects T11, T07, T09 and T19.

`POST /v1/world/verify` is the real eligibility issuer: it forwards a completed
IDKit result to World, checks it against this deployment's action, environment,
signal and preset, and issues the credential from DESIGN.md 3.6 on the strength
of it. The credential shape, the EdDSA signing, the JWKS, the `urn:creance:bind`
audience and the single use `jti` are all unchanged from T07. Only how the
credential is earned changed.

`POST /v1/demo/eligibility` stays behind `DEMO_ELIGIBILITY_ISSUER`. The testnet
bind script and the Steward have no World App and no camera, and a bind test
that cannot run without a phone in someone's hand is not a test. It is labelled
in its own response, it is not in the Bazantic gateway's six operations, and the
OpenAPI text now names the World endpoint as the issuer a person uses.

`apps/web/src/lib/eligibility.ts` keeps both behind one interface and switches
on `WORLD_APP_ID` being set. Nothing else in the web app knows which issuer it
got.

### The web app holds no World configuration of its own

Affects T11 and T27.

`POST /v1/world/rp-context` returns the app id, the action, the environment, the
preset and the signal beside the signature. The browser gets all of them in one
answer, so there is one source for the values that have to agree between the
signed message and the widget, and a preset or environment change is an API
restart rather than a rebuild of the front end. It also means no `NEXT_PUBLIC_`
World variable exists to drift.

The signing key never leaves the API. The World docs are explicit that an RP
signature is never generated on the client, and the IDKit result crosses from
the browser to a server action and no further, so the credential still never
reaches a browser.

### The duplicate state says the rule, and does not offer a retry

Affects T11 and T16.

The acceptance asks for "the copy from docs/DESIGN-TOKENS.md" for the duplicate
case, and section 8 has no dedicated string for it. The nearest is the Verify
screen's own second line, which states the rule outright: "One person, one
cover. This stops bots and duplicate accounts." That line is the duplicate
state's copy. The heading is "Covered", the Home deck's word for the state the
person is actually in, and the button is "Cover" and carries them to the cover
they already hold. All three are deck strings and no new copy was invented.

There is no "Try again". A second check by the same person would be refused the
same way, so a retry button would be a loop. The rule is not a failure and does
not read as one.

The check happens at `POST /v1/world/verify`, before the pay sheet, as well as
inside the bind transaction. Under x402 the settle step only runs after the
handler succeeds, so a refusal at bind costs nothing either; refusing before the
pay step is about telling someone the truth earlier, not about money.

### The IDKit packages are pinned exactly, not with a caret

Affects T11 and T27.

`@worldcoin/idkit` 4.2.3 in the web app and `@worldcoin/idkit-core` 4.2.4 in the
API, both without a caret. The React package had 109 published versions and its
latest was two days old when this was written. A minor bump mid-event that
renames a prop is a class of failure worth one line of configuration to avoid.

`signRequest` and `computeRpSignatureMessage` are imported from
`@worldcoin/idkit-core/signing` and `hashSignal` from
`@worldcoin/idkit-core/hashing`. The same symbols are documented from three
different packages across three pages; these are the paths the integration guide
shows and they need no extra direct dependency.

## T25, the Adjuster, 5 September 2026

### The model extracts and the code decides, with nothing in between

DESIGN.md 3.9 says the Adjuster "extracts fields from the documents with a
vision-capable model" and then "checks" a list of things. The two halves are kept
strictly apart: the model returns a closed, schema-validated record of what one
document says, and a pure function turns that plus the cover, the series terms
and the observed open months into a decision. No rule outcome, no amount and no
confidence is ever produced by the model, and there is no `approve` field in the
extraction schema for an injected instruction to land in.

The cost is one more type and one more mapping. The benefit is that the whole
adjudication is testable with no network and no key, reproducible from a fixture,
and explicable line by line when somebody asks why a claim was declined. It is
also the defence that does the most work against a hostile document: the
statement is never in the prompt, so a document cannot be written to agree with
something the model has not read.

### Four rule statuses, not two

DESIGN.md 3.9 implies a rule passes or fails. The engine reports four: `pass`,
`fail_hard` which declines, `fail_soft` which refers, and `not_evaluated` when
the inputs for the rule are not present. A rule whose inputs are missing and
which is reported as a pass is the failure mode that turns a missing check into
an approval, so the status carries `required` beside it and the auto-approval
predicate refuses to approve past a required rule that could not be evaluated.

### The loss window has three outcomes and the third is a hold

DESIGN.md 3.2 says the loss window is "the two months after" the separation.
DESIGN.md 3.9, CoverPool and the backlog all say the separation month or one of
the two months before the first open month, which is a lookback rather than a
lookforward. The contract is the source of truth and the contract is what
`payClaim` checks, so the Adjuster reads `openMonths(seriesId)` and
`SeriesTerms.lastObservedMonth` off the chain and evaluates `open(m) ||
open(m+1) || open(m+2)`.

The third outcome is the one that matters. A false predicate means two different
things: some month of the window has not been observed yet, or every month has
been observed and none opened. The first is a hold, not a decline. The claim
refers with `loss_window_not_yet_open`, waits `under_review`, and is re-decided
by a later pass; the claim window is defined as 60 days from the separation or 30
days from the opening observation, whichever is later, precisely so the wait
cannot cost the claimant their deadline. Rendering that hold as a decline would
refuse a valid claim on camera.

`claim_deadline` comes from `CoverPool.claimDeadline` and is never recomputed in
TypeScript, because two implementations of "whichever ends later" is how the
screen and the chain end up disagreeing.

### The auto-approval limit and the confidence threshold are ours, not the chain's

Neither number exists in `SeriesTerms`, in the `series` table before this ticket,
or anywhere in the configuration. They are added as two columns on `series` with
defaults, and as `AUTO_APPROVAL_LIMIT` and `AUTO_APPROVAL_CONFIDENCE` for what a
new row takes. The limit defaults to the full 5,000 demo cover in minor units,
which is DESIGN.md 9 item 7's proposal; the confidence defaults to 0.900, which
DESIGN.md does not fix and somebody had to pick.

They are deliberately not on chain. `SeriesTerms` freezes the trigger and the
windows, which are the terms a policyholder is owed and which nothing off chain
may contradict. How much of the adjudication we automate is not owed to anybody:
it is an operational choice that should be changeable without a redeploy, per
series, and a chain sync never writes it back over an operator's change.

### `full_name` joins the attestation, so the name rule can be evaluated at all

DESIGN.md 3.9 asks the documents to agree with the attestation "on employer, name
and date". The claims table created in T07 carries the employer and the date and
no name, so the name rule could only ever have been reported `not_evaluated`,
which caps the confidence at 0.85 and means nothing auto-approves. That would
have made DESIGN.md 3.9's strongest fraud check, whether the letter is about this
person at all, permanently dead.

So `claimant_name_enc` and `name_hash` are added to `claims` in the T25
migration, encrypted at rest beside `employer_name_enc` and hashed rather than
carried in the clear. T13 owns the write path and the form field. Until it lands,
a claim with no name still decides: the rule reports `not_evaluated`, the
confidence renormalises over the remaining weights and records that it did, and
the claim refers to a person. The decision record shows which of the two was in
force, per claim, forever.

### The name component is weighted by the model's reading confidence

The rubric's employer term is the model's own reading confidence scaled by how
well the two names matched. The name term is defined the same way, rather than a
flat 1.0 on an exact match. A name transcribed off a blurred signature block is
weaker evidence than one printed in an address line, and there is no reason for
the two fields to be treated differently. It also keeps packet A's arithmetic at
0.940 rather than 0.950, which is the number the fixture asserts to three
decimals.

### The confidence caps are applied as a minimum and always recorded

Each cap is recorded in `caps_applied` whenever its condition holds, whether or
not it actually bound. A reviewer reading a record then sees why a packet could
not have auto-approved, rather than only that it did not. Every cap sits below
the 0.900 default threshold, which is the point: a cap is a statement that a
packet is not auto-approvable, expressed in the same number the threshold reads,
so there is one gate and not two.

### A near match on an employer name is containment as well as a ratio

Comparing two employer names by the Sorensen-Dice coefficient alone puts
"Northgate Systems (UK) Ltd" against "Northgate Systems Ltd" at 0.80, which is
below the 0.90 near-match line and would therefore decline it. That is a real
person's real uncertainty about their own employer's legal name and it is not
fraud. So a containment test sits beside the ratio: when one normalised name is
the other plus a qualifier, and the shorter has at least two words, it is a near
match and the claim refers. One shared word is a coincidence; two is a name.

### The indexed payout mode refers rather than guessing an amount

`payClaim` compares the amount for equality and not for "at most", so an amount
the Adjuster computes differently from the contract is a bug and not a discount.
The demo series pays `full`, so the expected payout is the cover limit exactly.
The indexed mode needs the qualifying month's ODI and only works on a shock
opening, which this build does not compute, so rule R31 refers an indexed series
to a person rather than inventing a number.

### Decline reasons carry both a code and a composed sentence

The API returns machine codes so that a copy change never needs an API deploy.
Several of the sentences the claim screen shows only mean anything with the dates
filled in, and templating them in the web app would put half a sentence in the
Adjuster and half in the app. So the decision carries `reasons[]` and
`reason_lines[]` in parallel. The codes are canonical and go to the topic, the
record and the queue; the lines are presentation, are shown verbatim, and never
reach the topic because they carry dates and sometimes an employer name.

The price is that a copy change now needs an Adjuster deploy rather than a web
deploy. That is smaller than the price of the same sentence existing in two
places and drifting.

### The Adjuster is an admin client and publishes the topic itself

The API is the only writer of the database, which is what the migration comments
say, so the Adjuster reads the queue over HTTP with a bearer token and posts its
decision to the same endpoint a human posts to. Building the machine path on a
different route from the human path would leave the human path untested at the
moment it is needed.

The one thing it does hold is the claims topic's submit key, because that key is
the adjuster account's and the API does not have it. It builds its own Hiero
client, publishes the decision hash, and hands the sequence number to the API
with the decision. The hash reaches the topic before the decision reaches the
row, so a claim that is decided is always a claim whose decision is already
public and a payout can never reference a sequence number that does not exist.

To do that it imports `claimDecisionMessage` and `encodeTopicMessage` from
`apps/api/src/audit`, which makes `@creance/api` a workspace dependency of
`@creance/adjuster`. Writing the fixed version 1 message a second time in the
agent is how two writers end up disagreeing about a field name on an append-only
topic, which cannot be fixed afterwards.

### The API recomputes the decision hash it is given

`POST /v1/admin/claims/:id/decide` canonicalises the posted record with JCS,
hashes it, and refuses the request when the `decision_hash` beside it differs.
The CLAIMS role signs over that hash, so a record whose hash was computed over
something else would put a signature on a decision nobody can reproduce.
Recomputing costs one canonicalisation and makes the stored preimage and the
published hash the same thing by construction.

### The admin endpoints stay out of the Bazantic document

`recipes/bazantic/openapi.yaml` describes what an agent may buy over x402. The
review queue is internal, gated by a bearer token, and is not a Bazantic
operation, so none of the four admin routes is documented there. The generated
document and its test are unchanged.

### A timeout never decides a claim

An overdue claim, meaning one that has been waiting for a person for more than a
working day, is flagged and sorted to the top of the queue. It is never declined
and never approved by the passage of time. A time-gated transition is right for
money already committed on chain, such as the reserve releasing when the window
closes, and wrong for an adjudication, because the deadline in this design is on
the claimant's filing and not on our review.

### The decision moves the cover with it

A decision writes the claim and the policy status in one transaction: approved,
declined or under_review. A claim that says approved beside a policy that still
says claims_open is a state nothing downstream can act on. The payout status
stays T13's, because it belongs after the authorisation is signed.

### Evidence is sealed with a per-file data key under an environment key

The `claim_evidence` columns created in T07 describe an envelope and there was no
implementation of one. Each file gets a fresh 256 bit data key; the file is
encrypted with AES-256-GCM under it, giving `enc_iv` and `enc_tag`; the data key
is wrapped under a key encryption key from the environment and stored in
`enc_dek`, carrying its own nonce and tag inside its bytes because the row's iv
and tag belong to the file. `enc_kek_id` names the wrapping key so a rotation is
a new id beside the old one.

The stored hash is over the plaintext, because that is what a claimant can
recompute from the file on their own machine and it is what reaches the topic.
The admin evidence route checks it again on the way out: a file whose bytes no
longer match what the topic carries is a broken store, and a silent mismatch
would be adjudicated as if it were fine.

### A human decision gets a composed record, and the Adjuster puts it on the topic

The acceptance asks for a decision endpoint that takes one plain sentence. A
decision with only a sentence has no decision record, so it has no
`decisionHash`, so the CLAIMS role has nothing to sign over and the claim cannot
be paid. That is a hole in the flow rather than a simplification, so the API
composes the record for a human decision: the same shape, `actor` as
`reviewer:<name>`, `engine.model` null, the rule results carried forward, and a
`human` block carrying the review time, the soft rules the reviewer decided
against and the hash of their sentence. The sentence is never in the record.

The API cannot publish that hash, because the claims topic's submit key is the
adjuster account's. So two small endpoints were added beside the four the
acceptance names: `GET /v1/admin/claims/unpublished` lists the decisions whose
hash has not reached the topic, and `POST /v1/admin/claims/:id/published` records
where one landed and touches no other column. The Adjuster sweeps them at the end
of every pass. Without it, "every decision is on a public topic" would be true of
the machine's decisions and quietly false of the human's.

### The fixture documents are rendered by a committed script

The two packets need documents that are clearly synthetic, small enough to
commit and reproducible. `pnpm --filter @creance/adjuster fixtures` renders them
from the text in `fixtures/letters.ts` with an eighty line PDF writer in
`apps/adjuster/src/pdf.ts`, rather than adding a rendering dependency to a
workspace whose job is adjudication. A one page text-only PDF is what the model
reads best: it converts each page to an image and extracts the text alongside it,
so a text page gives it both layers.

## T13, the two-key claim flow, 5 September 2026

### The API enforces the identity leg and the Adjuster enforces everything else

docs/CLAIMS.md draws the line and this ticket follows it exactly. Rules R01 to
R06 are the identity and eligibility leg and `POST /v1/claims` refuses on them:
a live person check was completed, the claim and the cover name the same person,
the check was made for the claim action, the claim is waiting, the cover is open
for claims, and no earlier claim exists. Everything from R07 down is
adjudication and the endpoint accepts it.

That is why a resignation is accepted by the endpoint and declined by the
Adjuster a second later. A validation error is a form telling somebody their
input is wrong; a decline is a decision with a reason they can act on, a record,
a hash on a public topic and a resubmission path. The second is what a claimant
is owed, and refusing at the door would replace it with the first.

The three exceptions are refused at the door because they are not adjudication:
an occupation that is not the cover's, a packet with no document at all, and a
file whose bytes are not something the model can read. Each of those is a person
who can fix it in ten seconds on the screen they are still looking at.

### The claim's Selfie Check earns a credential in its own audience

`POST /v1/world/verify` and `POST /v1/world/rp-context` both grew a `purpose`.
At purchase the signal is the wallet and no liveness check is asked for; at
claim the signal is the policy id, `require_user_presence` is set, and what is
earned is a claim credential rather than an eligibility credential. One pair of
endpoints rather than four, because the difference is three values and the
checks are the same checks, and two handlers would be two places for the signal
comparison to be forgotten in.

The credential carries `urn:creance:claim` as its audience, which `credentials.ts`
had already named and nothing had used. A bind credential presented at a claim
fails the audience check and a claim credential cannot buy cover.

### The claim nullifier is its own column, because this deployment runs two actions

T11 left this to be decided by configuration: with one registered action the
claim's check returns the policy's own nullifier and there is nothing to store;
with two it returns a different number for the same person. `GET /healthz`
reports `world.continuity`, and it is false here, so migration 003 adds
`claims.claim_nullifier` and a partial unique index on
`(claim_nullifier, series_id)`.

What that costs is stated rather than hidden. With two actions the continuity
claim weakens from "the same live person bought the cover and collects it" to
"both were live people, the claimant controls the wallet that holds the cover,
and one person claims once". The wallet leg is real: the attestation is signed
by the policy's own EVM address and the API recovers it. The README and
docs/FEEDBACK-WORLD.md say exactly this. Setting `WORLD_ACTION_ELIGIBILITY` and
`WORLD_ACTION_CLAIM` to one registered action restores the stronger sentence
with no code change, and `claim_nullifier` then stays null.

### "Claims aren't open" is read from the chain at every claim

On chain only the series changes status when a month opens; the policies stay
Active until one is paid. So `policies.status` and `series.status` are a cache,
and the question "are claims open for this cover" is asked of
`CoverPool.seriesOf(...).status` at `POST /v1/claims` and at
`GET /v1/policy/:id`, with the same read refreshing the cached row. A second
source of truth for that fact is how the claim screen and the contract end up
disagreeing while somebody is watching.

The refusal copy is verbatim from docs/DESIGN-TOKENS-ADDENDUM.md with the real
reading filled in, and which figure it quotes follows the before kick-off
decision "The headline index figure is whichever form is nearer its line". The
demo series trades on the level form, so the sentence is said as a distance from
average rather than as a signed number, exactly as T15 said the chart's band
label must be: "Your occupation is 1.20 better than average. Claims open within
0.68 of average. We'll tell you here if that changes."

### The packet hash reaches the topic through the Adjuster, not the API

The acceptance says the evidence SHA-256 is written to the claims topic. That
topic's submit key is the adjuster account's and T18 fixed that the API never
writes it, so the API writes the packet hash into the claim row and the Adjuster
publishes it. `GET /v1/admin/claims/unpublished` gained a `packets` list beside
its `claims` list, `POST /v1/admin/claims/:id/published` takes
`hcs_submitted_seq` as well as `hcs_decision_seq`, and the Adjuster's pass
publishes the packets first and the decisions last.

The alternative was to give the API the adjuster key, which is a role change and
a second holder of a submit key, to save one list. Publishing first is also what
keeps the ordering the whole trail depends on: a packet hash on the topic, then
the decision hash that answers it, then a payout that references both.

### The payout runs inside the approval, and never fails it

DESIGN.md 3.9 says clean claims are "decided in minutes and paid in the same
session", so the approve branch of `POST /v1/admin/claims/:id/decide` signs the
authorisation and calls `payClaim` in the same request. The decision stands
whatever the payout does. A payout can revert for reasons that have nothing to
do with the claim being valid, the realistic one on Hedera being a wallet that
has not associated the settlement token, so a failure is reported as
`payout: {paid: false, reason}` beside a decision that is already recorded and
already public.

The authorisation is stored with its deadline before the call, which is what
makes the failure recoverable: `payClaim` is permissionless and the signature is
what makes it safe, so anybody can retry it with the same signature until the
deadline. Posting the same approval again retries it, and the whole step is
idempotent on `claims.paid_tx`.

### The amount is asked of the contract and never computed twice

`payClaim` compares the amount for equality. So the pay step calls
`expectedPayout(policyId, separationAt)` and signs whatever it answers, and
refuses to call `payClaim` at all when the Adjuster's decided amount disagrees
with it. A claim that would pay less than the contract computes is a bug in the
Adjuster and not a discount to accept quietly, and finding it in a dry run is
better than finding it in a revert on the money path.

### A policy is bound with a backdated start for the demonstration, and it is said out loud

No policy this build had bound could ever be paid. `POST /v1/bind` sets
`startAt` to the moment of binding, every policy on the demo series was bound on
4 or 5 September 2026, so every waiting period ends in November, and the claim
window closes on 5 October. `payClaim` reverts `SeparationInWaitingPeriod` for
every separation the replayed April 2026 opening qualifies.

`CoverPool.bind` does not validate `startAt`: the BINDER role is trusted to
state when cover began, which is the right design for an issuer that sometimes
records cover after the fact. So the demonstration binds one policy whose cover
really did begin earlier, with `pnpm --filter @creance/api
testnet:bind-backdated`, and says here and in docs/HEDERA.md that the start date
is an artefact of a replayed history and not something a person's purchase can
choose. The route a person uses is untouched.

### The claim window job is a command, not a loop inside the API

`closeWindow` is permissionless, not blocked by a pause, and happens once per
window. A cron entry or a person running
`pnpm --filter @creance/api claims:close-windows` is the right shape for that; a
background timer inside a web process is a thing that fails silently. It reads
`seriesOf(...).windowEndsAt` and refuses before it rather than sending a
transaction that reverts `WindowNotOver`, so it prints when it will work.

It is not in `GET /health` and not in any deploy file, because those are being
edited in another lane. Wiring it into a schedule belongs with whoever owns the
deployment.

### `POST /v1/claims` is not in the Bazantic document

Recommended by the ticket and taken. `recipes/bazantic/openapi.yaml` describes
what an agent may buy over x402. A claim is a person's flow behind a camera
check, it is not metered, and an agent cannot perform it: the credential it needs
comes from a live person holding a phone. It stays out for the same reason the
review queue does.

### The canonical attestation message lives in packages/client

A signature is worth exactly what the signed bytes say, so the bytes are written
out once. They are in `@creance/client` and not in the API, because the web app,
the testnet script and the demo seed all build them and none of them may import
from `apps/api`. The API imports the builder from the client and owns the other
half: whether the policy's own wallet produced the signature.

The message is human readable rather than a hash, because the person is signing
it in a wallet that will show it to them and a prompt reading `0x9f3c...` is a
prompt nobody can refuse meaningfully.

### `unsigned_accepted` is accepted and `hedera_sign_message` is refused

The schema names three attestation methods. `eip191` is `personal_sign` and is
recovered against the policy's EVM address. `unsigned_accepted` is the honest
name for a recorded click-through with no signature behind it: it is stored as
what it is, and rule R10 refers the claim rather than declining it, because
weaker evidence is not a broken flow. `hedera_sign_message` is refused with a
501 rather than stored unchecked, because nothing in this build produces one, the
web app's wallet mode is the demo account, and an unverified signature stored as
verified is worse than no signature at all.

### Evidence arrives as base64 in the JSON body, capped at four files of 4 MB

Multipart would mean `@fastify/multipart` and a second body parser in front of
the one endpoint where a mistake hands a stranger's document to the wrong claim.
Every other route in this API takes JSON, the scripts build their requests with
`fetch` and no form library, and base64 costs a third more bytes for files that
are a page of A4. The route raises its own body limit to 24 MB and the server's
default of 64 KB is untouched everywhere else.

The content type is sniffed from the bytes and never taken from the caller, and
the evidence id is minted by the API rather than accepted, so a caller cannot
choose where its ciphertext lands in the store.

### The packet hash is the JCS hash of a manifest that names no employer

`payClaim` takes the packet hash and the claims topic carries it, so it needs a
preimage that can be shown to somebody who asks. The manifest is that preimage:
the shape of the packet, the fingerprints of its files, what the identity check
returned, and the employer, the name and the job title as
`sha256(lower(trim(value)))` rather than as themselves. Canonicalised with JCS,
the same convention the decision record and the index observation use, so there
is one canonical form in this build and not three. The manifest stays in the
`claims` row; only its hash is published.

### The reason codes are free and the reason sentences are not

`GET /v1/claims/:id` is free, like `GET /v1/policy/:id`, because a claim screen
has to poll it and a claimant holds no admin token. A claim id is public: the
claims topic carries it in every `claim_packet` and `claim_decision` message. So
the response carries the status, the decision, the reason codes, the amount and
the two hashes, and none of the employer, the name, the separation date, the
file names or the nullifier.

`reason_lines` are the exception and they are stored, in a new column, and served
only from the admin payload. docs/CLAIMS.md says they "carry dates and sometimes
an employer name", which is exactly what must not be reachable from a public id.
The claim screen in T16 gets the codes from the free endpoint and the sentences
with the decision.

## T21, the public deployment, 5 September 2026

### The public host is a fresh VPS behind Caddy, not Fly.io

The acceptance offers either. Caddy on a VPS was taken for three reasons.

Both apps have to be on one origin. `https://creance.co` is baked into the World
Developer Portal's allowed origins, into the x402 resource URLs the API
advertises in a 402, and into the Bazantic gateway's base URL. Moving the API to
an `api.` subdomain would invalidate all three, so the deployment has to route
paths, not hosts. One Caddy site block with a path matcher does that in six
lines. On Fly.io the same thing is two apps and a router in front of them, or
one machine running both processes, which is the compose file again with a
proprietary wrapper around it.

The oracle is a long-lived worker with a writable volume that the API reads. On
one host that is a named volume mounted in two containers. Fly.io volumes attach
to one machine at a time, so the same arrangement means colocating the oracle
and the API in one machine group and giving up the separation.

And the fallback matters more than the convenience. DESIGN.md section 8 answers
"a judge cannot reach the app" with a recorded fallback in the video. A compose
file and a Caddyfile run on any Linux box with an address, including a laptop
behind a tunnel, in the ten minutes before a deadline. A Fly.io deployment needs
an account, a token and a working control plane.

The cost is that certificates, updates and the host itself are ours. For a
fortnight of testnet that is the cheaper side of the trade.

### `GET /healthz` stays, as an alias of `GET /health`

The acceptance names `/health`. `/healthz` already existed, returns the same
facts, and is named in the README, in the T11 signer check and in anything an
operator has already bookmarked. Both paths are registered on one handler in
apps/api/src/routes/ops.ts, so the two bodies cannot drift, and the older name
is not a redirect: a health check that follows a 301 is testing the redirect.

The body gained one field, `replay`, the oracle's run state. It is read with
`readReplayState`, which apps/api/src/replay/state.ts exports for this, and not
by calling `GET /v1/replay`: a process that reaches itself over HTTP to answer a
health check is reporting the proxy's health rather than its own.

Both paths stay outside `/v1/index/`, which the x402 gate meters, so an uptime
check never has to pay to find out whether the site is up.

### The acceptance's `PUBLIC_BASE_URL` is `PUBLIC_SITE_URL`

The backlog line says the apps are reachable at `PUBLIC_BASE_URL`. No such
variable exists: `PUBLIC_SITE_URL` has carried the public origin since T07 and
is what the API, the World configuration and the OpenAPI document all read. A
second name for one value is a bug waiting to be introduced, so the ticket's
name is treated as a synonym and nothing was added.

### The compose file publishes nothing beyond the loopback interface

The API and the web app are bound to `127.0.0.1` on the host and Caddy proxies
to them. The only thing the internet can reach is Caddy on 80 and 443. It costs
nothing, and it means a misconfigured firewall cannot expose an unencrypted API
that issues credentials.

### The oracle service runs its daily check in a loop rather than exiting

docs/INDEX-SPEC.md section 9 asks for the oracle in schedule mode as a service
with `restart: always`. `pnpm oracle:schedule` is still the stub until T26, and
a stub that exits under `restart: always` is a container that restarts forever
and reads as broken. The image's command is therefore the schedule itself: run
`pnpm run oracle:schedule`, sleep a day, repeat. The container stays up, the
restart policy means what it says, and T26 changes the body of that one npm
script without touching the image or the compose file.

## T16, the claim screens, 5 September 2026

### The web server reads the decision sentences for a claim its own session holds

Affects T16 and T13.

Screen C9 prints plain sentences from the decision record, and T13 put those
sentences in the admin payload alone because they carry dates and sometimes an
employer's name (docs/CLAIMS.md, "The claimant's own read"). A claimant holds no
admin token, so on the face of it C9 could only print reason codes.

The web server already holds the API origin as a private variable and makes
every call from the server, so it holds `ADMIN_TOKEN` the same way and reads
`GET /v1/admin/claims/:id` for one claim id: the one in this browser's own
server side session, which is the session that submitted it. Nothing but
`reason_lines` and the resubmission sentence crosses to the client, and a
browser that did not submit a claim cannot name one, because the id is not
taken from the address.

The alternative was to widen the free endpoint, which would put an employer's
name behind a public id, or to template the sentences in the app, which would
put half a sentence in the Adjuster and half in the web app. Both are worse.
A deployment with no admin token falls back to the same sentences with every
date left out, composed from the codes on the free read, so nobody ever reads a
code.

The token is a private server variable and never a NEXT_PUBLIC one. The web
image inlines public variables at build time, so a token there would be in the
bundle a judge can read.

### A reviewer proves who they are before the server spends its own admin token

Affects T16 and T21.

The entry above gives the web server `ADMIN_TOKEN` so that screen C9 can print
the sentences a decline carries. The review queue needs the same token for a
different reason, and the two are not the same permission: C9 reads one claim,
named by the browser's own server side session, and returns one field. The queue
reads every waiting claim with the claimant's employer, job title, separation
date and evidence fingerprints on it, and its two buttons call
`POST /v1/admin/claims/:id/decide`, where an approval runs `payClaim` and moves
settlement funds out of the vault.

Gating that on `hasAdminToken()` gates it on the server's own configuration, so
every request that reaches the app is a reviewer. T21 puts the web app on a
public host with everything outside `/v1/*` routed to it, so that is a stranger
with a claimant's file open and a payout button. The API's own bearer gate is
constant time and per request, and a screen in front of it that gates nothing
undoes it.

So a reviewer signs in: one screen, the same token typed once, compared in
constant time over sha256 digests rather than raw strings, because
`timingSafeEqual` throws on a length mismatch and the exception would leak the
length. What the browser then holds is an opaque id in an httpOnly cookie
scoped to `/admin`, exactly as `claim-session.ts` holds the id of a claim, and
the token itself never goes back. The session lives in the web process's memory
for eight hours, so a restart signs everyone out, which is the safe direction.

Both halves are checked, and the action's check is not the page's. A Next.js
server action is its own endpoint, reachable without ever loading the page that
renders the button, so `decide` checks the session before it uses the claim id
for anything and refuses without calling the API at all. That is what
`apps/web/test/review-gate.test.ts` asserts: not that the screen said no, but
that the API was never reached.

What this is not: one shared credential, no accounts, no rate limit on the entry
screen, and a decision that records `reviewer:root` whoever typed it.
docs/CLAIMS.md already says per-actor scopes are on the list of things a real
deployment needs and this one does not have. This closes the hole that a public
deployment opens; it does not turn the queue into an identity system.

### The five choices on C2 collapse eight separation types onto five labels

docs/DESIGN-TOKENS-ADDENDUM.md fixes five labels for "How did it end?" and
packages/client carries eight separation types. "Laid off or made redundant" is
stored as `redundancy` and "Position eliminated or workplace closed" as
`position_eliminated`, so `layoff` and `site_closure` are never sent by the web
app.

Every rule in docs/CLAIMS.md treats the members of each pair identically, so
nothing downstream can tell the difference, and asking a person to split a hair
the adjudication does not split would be a worse screen. The other three labels
map one to one onto the excluded types.

### C2 asks for a name, which the addendum's field list does not

The addendum lists Employer, Job title, Last day of work and the select. The
attestation is signed over the claimant's name and the Adjuster's name rule
compares it with the document (docs/CLAIMS.md, "`full_name` joins the
attestation, so the name rule can be evaluated at all"), so a claim with no name
on it cannot be checked against its own evidence. The field is first on the
screen, labelled "Your name", in the same component as the other three.

### Every file goes up as `other` unless its name says otherwise

`POST /v1/claims` takes an evidence `kind` from five, and C3 lists four
documents without asking which one is being added. Asking would add a field
nobody can answer wrongly in a way that matters: the Adjuster reads the document
itself, and every rule works from what the document says rather than from the
label the uploader chose. So the kind is read from the file name where the name
says so and is `other` where it does not.

### The attestation is signed on the server as the account the cover was bound to

Affects T16 and T15.

docs/CLAIMS.md makes the signature `eip191`, recovered against the cover's own
EVM address, which is the address `payClaim` pays. There is no wallet in the
browser that can sign: the HashPack path needs a Reown project id and is not
wired. So the web server derives the holder's key with the same HKDF label the
API uses, exactly as src/lib/payer.ts already derives the same account's key to
pay the premium, and signs there. No key reaches the browser.

A cover held by an account this app has no role for is submitted as
`unsigned_accepted`, which is the honest name for a recorded click-through with
no signature: the API stores it as what it is, R10 refers it, and the confidence
cap keeps it out of auto-approval.

### C4 offers the labelled demo check a second time after a failed World check

The claim leg needs a fresh Selfie Check with `require_user_presence`, and the
staging simulator has no Selfie Check option (docs/FEEDBACK-WORLD.md section 3),
so on a deployment that does have a World app id the widget opens and the check
cannot be completed. Without a way through, a demo on the real app id could
never reach a payout.

So C4 runs the World check when there is an app id, and after a failed check
offers "Use the demo check" as a secondary, with the same ink-2 line the
purchase screen uses for its own demo issuer. It is the person's choice and it
is labelled; the credential it mints records `credential: demo-issuer`, so a
decision record can never claim a camera ran.

### Home renders any state from fixtures behind a private flag

The acceptance asks for every state to be reachable through the replay or a
demo control. Three of them have no server path to force: a cover lapses when a
month's premium goes unpaid, a payment fails when a wallet is short, and a
browser is offline when it is offline.

`WEB_DEMO_STATES=true` turns on `/home?demo=<state>`, which renders Home from
fixtures and prints "Demo state. Nothing on this screen came from the API." on
the screen it renders. Off by default and a private server variable, in the
spirit of the demo eligibility issuer: a public variable is inlined at build
time, and a demo control that cannot be turned off after a build is not off by
default.

### The Payment failed sentence is the deck's on a lapse and the API's on a purchase

docs/DESIGN-TOKENS.md section 8 writes the failure as "Check that your wallet
has at least 28.00, then try again. Your cover is unchanged until 19 October."
That sentence is written for a payment that keeps existing cover alive, which is
the lapsed state, and it is what the lapsed path prints with the amount and the
date interpolated.

There is no cover to be unchanged during a purchase, so the Pay sheet keeps the
deck's title and prints the sentence the API's own problem document justifies:
the reasons a bind refuses are one person one cover, a full series, a series not
taking cover, and an expired check, and each has its own line already. The
alternative was to print a sentence about cover that does not exist yet.

### Home prints the reading as it stands and takes the caption from the cover

A series stays ClaimsOpen for the whole claim window while the index falls back
under its line, so `GET /v1/policy/:id` can answer `claims.open: true` beside a
reading that is 0.69 points short. Both are true and both are needed: the chain
is the index key, the reading is the latest month.

The figure on the Index row is the reading, because it is the published number.
The caption is the cover's own answer, because an amber "Claims open" pill over
the words "Points from opening claims" is a screen contradicting itself. Written
up with the measurement in docs/harness-notes.md.

### The lapsed state says "Payment due" once

The deck gives the lapsed state three strings: "Payment due", "Pay by 19 October
to stay covered." and "Pay 28.00". The first is also the status pill's label on
the card, so printing it again under the card is the same words twice on one
screen. The pill carries it, the line says by when, and the button names the
outcome.

## T22, wrap-up documentation and evidence, 5 September 2026

### The wrap-up write-ups are not repository documents

DESIGN.md section 4 lists `docs/ARCHITECTURE.md`, `docs/PRICING.md`,
`docs/PRIZES.md` and `docs/FEEDBACK-WORLD.md` in the repository's `docs/` tree.
None of the four is in it. The repository holds product documentation, and all
four exist to serve the event rather than the product: one restates the build
for a judge who has the code in front of them, one publishes actuarial
assumptions for a prize line, one is the prize checklist itself, and one is
feedback about somebody else's product. All four are written and kept with the
event record instead. `.gitignore` names them so none of them comes back by
accident.

What a reader of the repository gets instead is one paragraph at the top of
README.md's Layout section saying how the five applications, the two packages
and the contracts fit together, and the two documents that were already carrying
the load: docs/HEDERA.md for every id and the transaction that proved it, and
this file for every place the build differs from the brief.

One consequence needs a person, and it is in docs/SUBMISSION.md as well. The
World track names a feedback document as a deliverable in its own right, so a
document that is complete but outside the repository has to reach the judges
some other way. Root either attaches it to the submission or puts it back.

### The premium floor is 0.5 percent a year, not DESIGN's 3 percent

DESIGN.md 3.4 sets the floor at "3 percent of the cover limit". The formula of
record, in "Premium is a guide price from the index multiplied by a capacity
term" above, uses `max(0.005, ...)`, which is 0.5 percent a year, and that is
what `PRICING.floorRate` has always been. The difference was never called out
and is called out now, because a stated assumption that is not the one the code
runs is the worst kind.

The 0.5 percent floor never binds. The flat tail of the fitted hazard prices at
`0.047 * 0.167 * 0.60 * 1.30`, which is 61 basis points, so the cheapest quote
the formula can produce is already above the floor. A 3 percent floor would have
bound on most months for most groups and overridden the hazard entirely, which
is exactly the flattening the formula of record exists to avoid. The floor is
therefore a statement about the least a policy is worth writing rather than a
number that does any work.

## T19, the Bazantic gateway and the recipes, 5 September 2026

### The OpenAPI document is validated by swagger-parser, in the test suite

"Validated" had no tooling behind it before this ticket. It has one now:
`@apidevtools/swagger-parser` 13, a development dependency of `apps/api`, run in
`apps/api/test/openapi.test.ts` against the committed `openapi.yaml` rather than
against the object the generator returns, because the file is what an importer
is handed.

It was chosen over a linter because the question this document has to answer is
"will an importer accept it", not "is it stylish". swagger-parser resolves every
`$ref` and validates the document against the OpenAPI 3.0 schema, and it also
refuses a path template that declares a parameter the operation does not, which
is the failure a hand-extended generator grows first. A style linter would have
had opinions about descriptions and none about that.

### The recipes read the frozen trigger parameters from the index, not the series

The obvious place to read a series' frozen shock attachment and level line is
`GET /v1/series/{seriesId}`. It does not carry them: it answers the vault, the
note, the holders, the pool and the coupons, all read from the chain, and the
trigger lines live on the index instead.

So the renewal recipe reads them from `trigger` on `GET /v1/index/{group}` and
from the `attachment_shock` and `level_line` fields on the observation messages
on the index topic, which makes the mirror node load bearing for a second
reason: the number on the topic is the one the contract compares against. The
series read stays in the recipe for what it does answer, the capacity, the term
and the coupon.

### The 402 body is documented as its own schema

The three metered operations answered `Problem` in the document and something
richer in reality: the same RFC 9457 fields plus `price`, `x402_version`,
`scheme`, `network`, `pay_to` and `facilitator`. An agent that reads this
document and never reads this repository has to be able to find the price in the
body it actually gets, so the extra fields are now a `PaymentRequired` schema.

Written out field by field rather than composed with `allOf`. The document
avoids `allOf`, `anyOf` and `oneOf` throughout, and a test enforces it, because
those are where importers disagree.

### The buy recipe stops at bind and says so

The premium schedule is not part of it. The Steward creates the following
months' premiums as Scheduled Transactions outside x402, because the `exact`
scheme requires a bare transfer and refuses one wrapped in a `ScheduleCreate`
(docs/DECISIONS.md under T09, and step 7 of docs/demo/steward.txt). A recipe that
implied it had arranged a year of payments would misdescribe the one part of the
flow that is genuinely unusual, so both recipes name the boundary instead.

### The quote is paid, and a credential does not stand in for the payment

The OpenAPI document said an eligibility credential also satisfied the x402 gate
on `POST /v1/quote`, "a stronger anti-abuse signal than the fee". It never did.
The gate is an `onRequest` hook over a route map of prices and it does not read
the `Authorization` header, so an unpaid quote carrying a valid credential is
refused with the same 402 and the same 50000. Measured on a running API and now
pinned by a test in `apps/api/test/x402-routes.test.ts`.

The claim was wrong, so it was removed rather than made true. DESIGN.md 3.7
makes the quote a plain paid call, and building a bypass would have changed what
the fee is for: it meters the pricing engine, which costs the same to run for a
verified person as for anyone else, and the credential is a single-use token
that `POST /v1/bind` consumes. Spending it on a quote would buy a free price and
then need a second Selfie Check to bind.

The operation's `security` block went with it. `[{}, { eligibilityCredential:
[] }]` reads as "no auth, or a credential", which describes an authorisation
choice this operation does not offer. The bind keeps its
`[{ eligibilityCredential: [] }]`, where it is true.

## T23, the clean clone run-through, 5 September 2026

### A blank environment variable means unset

DESIGN.md does not say what a blank line in the environment means, and the code
and `.env.example` disagreed about it: the file documents defaults that a name
present with an empty value silently erased, because `??` falls back only on
`undefined`. Two readings were available. Treat blank as a value, and tell the
judge to delete every line they do not fill in, which turns "copy the example
and fill in the blanks" into "copy the example and then edit ninety lines out of
it". Or treat blank as unset, which is what every comment in the file already
promises.

Blank is unset. It is the only reading that makes the documented setup work, it
is what the World, steward and adjuster configurations already did with their
own readers, and the alternative asks a judge to do careful editing under a
fifteen minute clock. The exception is `GIT_SHA`, which is deliberately not in
the example at all: it is baked into an image and a line for it in a deployment
file would override the one fact the health endpoint exists to report.

### The oracle asks the topic, not the local file, what has settled

The guard against publishing a period twice was the observation store, a file
under `var/` that a clone does not carry, so a clean clone would republish a
settled month. Three options were open: leave it and tell judges in the README
to use `--dry-run`; leave it and point the judge at `--scenario`, which writes
no index message at all; or make the command read the topic.

The command reads the topic. A document that says "do not run the real command"
is a workaround for a defect rather than a fix, `--scenario` shows synthetic
data where the point of the exercise is real data, and docs/INDEX-SPEC.md
already says the topic is what settles a period. The mirror node read is free,
public and takes about a second. `--dry-run` stays the recommendation in the
README for a first look, but it is now a convenience rather than the thing
standing between a judge and a duplicated settlement.

The pipeline's header comment had named this and deferred it to T26 as needing
the runs table. It does not need the runs table for this: the question is "is
this group and period on the topic", and the topic answers it.

### The Steward run in the README uses a labelled vantage month

`pnpm steward:run` on live data decides hold, because the three month ODI trend
at the newest published month is not rising. That is the rule working, and a
judge following the README would see a paid index read, a journal entry and no
purchase, which does not demonstrate the agentic payment the flow exists to
show. The README now says both: that a hold is a complete cycle, and that
`--as-of 2025-05` puts the vantage on a rising month so the same run quotes,
binds and schedules. The journal records `replay: true` for a labelled vantage,
so nothing about it is hidden from a reader of the topic.

## T28, the index feed as its own gateway, 5 September 2026

DESIGN.md section 4 draws a "second gateway, same API" and says nothing more
about it. This is what it turned out to be, and where the build went past the
brief.

### The public index surface is three routes, and two of them are free

The ticket asks for "an OpenAPI description covering every public index route"
while exactly one existed, `GET /v1/index/:group`. So the surface had to be
decided rather than described.

It is three. `GET /v1/index` is the catalogue, free. `GET /v1/index/{group}` is
the reading, 0.01 TUSD. `GET /v1/replay` is the clock, free, and it is in the
document because a reading taken while the demo clock is walking is a real
published month that is not this month, and an agent that reports it as current
is wrong in a way no schema catches.

The catalogue is new and it is the substantive addition. Until it existed there
was no way to learn a valid group key without paying for a reading, and the gate
runs before the handler, so a guessed key costs 0.01 TUSD and answers 402 or
400. A feed that charges a caller to find out how to call it is not a feed
anyone builds an agent against. It carries the group keys, the labels, the
source series, the frozen trigger lines, which groups have a reading, and the
price and payment terms; it carries no index value, so nothing the metered route
sells is given away.

`GET /v1/index/health` is not in it. That route is T26's and it is still to do,
and documenting an operation into somebody else's gateway before it exists means
an importer gets an operation that answers 404.

### A second document rather than a second section of the first

Two OpenAPI documents describe one API. `recipes/bazantic/openapi.yaml` is the
cover gateway, seven operations. `recipes/bazantic/agentify/openapi.yaml` is the
index feed, three. The shared fragments moved to `apps/api/src/openapi-shared.ts`
so the two cannot describe the same operation differently, and a test refuses to
let any cover path into the index document.

The alternative was one document imported twice with a filter, which Bazantic's
console may or may not support and which nobody outside the beta can confirm.
Two files is the version that works whatever the console does.

### The description files are served, not only committed

`GET /llms.txt`, `GET /skill.md` and `GET /openapi/index.json` are served by the
API from the same code that generates the committed copies, and a test compares
the bytes. An agent that has to be pointed at a repository to find out what an
API costs has not been given an agent-usable API, and the acceptance line for
this ticket is that a caller which has never seen the feed can get from one URL
to a correct paid call without a person. That is only true if the URL answers.

The public host routes those three paths to the API rather than to the web app,
which is one line in `deploy/Caddyfile`.

Every URL in both files is the public origin, never the origin the request
arrived on. A description file fetched through a tunnel that then teaches an
agent a tunnel address is worse than no description file, which is the same rule
T19 set for the `servers` entry.

### The proof is a deterministic client, not a language model

The ticket describes giving a fresh agent session nothing but the description
file. What was built is a client that is handed the URL of `/llms.txt` and a
funded key, imports nothing from this repository's source, and extracts the
route, the price, the asset, the network and the payee from the prose of the
file before it signs anything.

A deterministic client is the stronger proof here. It can be re-run by a judge
and asserted on, it fails loudly rather than improvising when the file is
missing a fact, and it holds the description file to a stricter standard: every
fact it needs has to be extractable from the text rather than merely implied by
it. What it does not prove is that a language model would read the file the same
way, and docs/HEDERA.md says so rather than letting the run be read as more than
it is.

### The gate meters a parameter, not a prefix

`GET /v1/index/*` in the x402 route map also metered the bare `/v1/index`, which
is the free catalogue: the library makes a trailing wildcard optional. The
pattern is now `GET /v1/index/:group`. It is a library behaviour rather than a
decision, and it is in docs/harness-notes.md, but it is recorded here too
because it is the one way the catalogue could silently stop being free.

## T24, the demonstration seed and the shot list, 5 September 2026

### "From a clean state" is a clean database, not a clean testnet

The ticket asks `pnpm demo:seed` to build the demonstration "from a clean
state", and the testnet resources are shared: the accounts, the two tokens, the
four topics, the two contracts and the demo series are all created once and read
by every command in the repository. Rebuilding them would mean new ids, and
every transaction link already written into docs/HEDERA.md, docs/ATS.md and the
prize evidence would point at a deployment that no longer exists.

So a clean state is a fresh local database, `pnpm api:migrate`, plus the testnet
resources that are already there. `pnpm hedera:setup` and `pnpm contracts:deploy`
own the shared half and both already refuse to do anything twice. The seed owns
the half that is per demonstration: the two claimable policies, the noteholder
positions and the two staged packets. It composes the commands that already
exist rather than reimplementing any of them, which is why a run that ends with
"nothing bound" is the correct outcome and the one that matters on video day.

### The seed stages the packets and never submits them

Staging a packet could mean writing a submitted claim into the database, which
is what `pnpm --filter @creance/adjuster testnet:seed` does. The seed does not do
that, because both claims are submitted on camera in shots 6 and 7 and a policy
that already carries a claim cannot carry another: one claim per nullifier per
series.

Staging here means proving that the claim will be accepted before anyone starts
recording. The seed renders the letters if they are missing, fingerprints them
against the committed hashes, checks the separation date against the waiting
period and the term of the cover it bound, asks `CoverPool.isInLossWindow`
whether the separation month qualifies, and prints the exact `testnet:claim`
command for each. It fails loudly when any of that is wrong, which is the whole
value: the failure a shot list cannot survive is the one discovered at 19:00 on
the last evening.

### The replay scenario is committed as data, not as a scenario file

The ticket allows a file under `apps/oracle/scenarios`, and none is used. An
oracle scenario is a synthetic trigger that writes neither the index topic nor
the chain, which T12 already recorded, and nothing in a demonstration path may
run against a mock. The window the demonstration uses opens on real published
data anyway.

The scenario is instead the sequence itself, committed as ordered data in
`apps/api/scripts/testnet/demo-seed/scenario.ts`: nine beats with their timings,
the surface each is shot on, what must already be true, the exact commands and
what has to be legible on screen. `pnpm demo:seed scenario` prints it, docs/DEMO.md
carries the same table, and the unit tests check that the beats are contiguous,
that the cut stays inside the two to four minutes ETHGlobal enforces, and that
the reserve, the approved claim, the declined claim and the reserve release are
all in it.

### The replay is run again for the screens and May 2026 is the live opening

The proof run of 5 September settled 2025-01 to 2026-04 on the demo series, and
`submitObservation` reverts `PeriodNotAfterLast` for any month at or before it,
so April cannot be opened again. Two options were open: register a fresh series
for the recording, which shows a reserve being taken from nothing but abandons
every link already published against ODI-COMP-2026-01, or replay against the
April state.

The demonstration replays `--from 2026-01 --to 2026-05`. The months already on
the index topic tick past the replay bar without being published twice, which is
the oracle asking the topic what has settled rather than a local file, and May
2026 has never been published or submitted. It opens on the level form and tops
the reserve up on camera. So the screens are the real screens, the opening is a
real opening on real published data, and no link in the repository is orphaned.
May is spent the first time it is submitted, so `pnpm demo:seed status` reports
whether it is still in hand and never spends it.

### The reserve release is shown on a short window series, and said out loud

`closeWindow` on ODI-COMP-2026-01 refuses until 5 October 2026, thirty days
after the observation that opened the window, and the terms are frozen at
registration with no setter. That is the contract behaving correctly: a claimant
must not be cut off by the lag between a month ending and the statistics for it
being published. It also means the last beat of DESIGN.md section 7 cannot
happen on the demo series inside the event.

`pnpm --filter @creance/contracts demo:release` opens a series carrying every
term the demo series carries except that its claim window is measured in
seconds, funds it, binds two policies, opens a month, pays one claim out of the
reserve, waits for the window and closes it. The unclaimed half of the reserve
goes back to the vault and the principal ends lower by exactly the claim that
was paid. Everything in it is real and it is on testnet; what is compressed is
the clock, and the shot list says so out loud. Maturity is already shown the
same way, on the short dated series `pnpm coupons:mature` opens, and the
alternative was faking a release, which nobody was going to do.

The first run of it released nothing, because a single policy's reserve was
consumed entirely by its own payout. Two policies are bound instead, only one of
which claims, because "the unclaimed reserve returns to the noteholders" needs
an unclaimed remainder to be a demonstration of anything.

### The video is one artefact of 3:50, not a five minute cut and a showcase cut

DESIGN.md section 7 asks for a main video of five minutes or less and a separate
showcase cut of two to four minutes. ETHGlobal accepts only two to four minutes
and rejects the rest before a judge sees it, and the partner tracks all say five
minutes or less, which a shorter video also satisfies. So there is one take, cut
to 3:50, and the showcase cut is that take with the harness beat dropped, which
lands at 3:38 and stays inside the same gate. Building two videos would mean two
rounds of voice over for no judge who reads either differently.

### The demo states behind WEB_DEMO_STATES are for framing and never for a take

`WEB_DEMO_STATES` renders Home from fixtures for each of the six states. It is
useful for checking that a shot is framed correctly before the state it needs
exists on chain. It is never used in a take: nothing in a demonstration path may
run against a mock, and the screen prints a label saying nothing came from the
API. docs/DEMO.md says both halves of that.

## T27, the World App Mini App surface, 5 September 2026

### No MiniKit command that touches World Chain is called anywhere

The Mini Apps documentation is direct about the chain: a mini app is developed
against live World Chain and there is no test network for it, and its own advice
is to deploy your test contracts to the live chain. MISSION rule 1 forbids
production endpoints, production keys and real funds without qualification.

The two are not in conflict here, because this product never asks World App to
move value. `sendTransaction`, `pay`, `signMessage`, `signTypedData` and
`walletAuth` are not called; the settlement asset, the note, the reserve and
every payout are on Hedera testnet. World App is the device that holds the
person's World ID and runs the Selfie Check, and the Selfie Check is IDKit, not
a MiniKit command.

So `@worldcoin/minikit-js` is in `apps/web/package.json` for two things only:
installing the SDK so the app can tell which surface it is on, and being present
inside World App so that IDKit uses the native transport. It is provable in one
line, and a reviewer should run it:

    grep -rn "sendTransaction\|MiniKit.pay\|walletAuth\|signTypedData" apps/

The Portal's "Permissions, Permit2 tokens and contract entrypoints" list stays
empty for the same reason: nothing here calls a World Chain contract.

### MiniKitProvider is mounted without an app id, and T11's rule is not bent

T11 decided that the web app holds no World configuration of its own, and that
no `NEXT_PUBLIC_` World variable exists. The provider takes an optional app id at
mount, which is before any request to the API, so this ticket had to choose
between three ways of getting one there.

It is mounted with none. The only reason to pass an app id is a MiniKit command,
and no MiniKit command runs here, so the value would be configuration carried
for its own sake. The cost is one console line inside World App, "App ID not
provided during install", and nothing else: install still succeeds, the surface
still reads correctly, and IDKit takes the World ID app id, which is a different
value and still arrives with the signed request context.

The Mini App id does exist in configuration, as `WORLD_MINI_APP_ID`, but it lives
where the rest of the World configuration lives, in the API, and it is read
through `GET /v1/world/mini-app`. That keeps one owner for World values and it is
also the answer a notification sender would need later, since `mini_app_path`
carries the same id.

### No route is taken client only for MiniKit

The migration guide's headline hazard is that MiniKit depends on
`window.WorldApp`, that server rendering causes hydration mismatches, and that
the symptom is clicks doing nothing. Its fix is `dynamic(..., { ssr: false })` on
the route tree that touches MiniKit.

Nothing here needs that, because nothing reads `window.WorldApp` while
rendering. The surface is read from the provider's own post-install state, so the
server and the first client render agree on `browser` and the value changes once,
after hydration. Taking the flow routes client only would have cost the
canonical index page its server rendering for no gain.

### The surface helper asks `isInWorldApp` first and `isInstalled` second

`MiniKit.isInstalled()` is the accessor the getting started page names, and it is
the honest test for whether a command could be sent: it is true only once install
has run. It also logs a console warning every time it returns false, which in a
browser is every render, and those warnings would be in every screenshot.

`MiniKit.isInWorldApp()` is pure, needs no install and reads the same injected
object, so it goes first and the browser path never reaches `isInstalled()` at
all. One helper, `src/lib/surface.ts`, and one import site per screen that
branches.

The provider's own flag is used as the trigger to ask again rather than as the
answer, because it is false for an out of date World App, which is still World
App and still runs the native IDKit transport.

### Three strings change inside World App, and the rest of the deck does not

The copy deck was written for a browser and a second device to scan from. Two of
its strings are wrong inside World App and both are on the check screens:

- "Waiting for the World app" becomes "Confirming with World ID". The person is
  in the World app, the sheet is open in front of them, and nothing is away
  anywhere.
- "Try again, or use a different device." becomes "Try again." There is no second
  device to move to.

"Verify with World ID", "Confirm you're a real person." and every other string on
those screens are correct on both surfaces and are untouched. The new strings are
plain, sentence case, and say what is happening, which is what the deck's voice
rules ask for.

### The occupation index deep link is a path, not a path with a query

The Index tab reads its occupation from `?group=`, which is right for a tab
someone is already inside. A deep link is not: World App takes the path to open
as one url encoded value, and no page states whether a query string survives
inside it. So the entry a link uses is `/cover/index/<group>`, which carries the
occupation in the path itself and redirects to the tab. It works with no session,
which is the point of a link for somebody who has bought nothing yet.

The published link encodes the path once, which is what the quick actions page
asks for. `MiniKit.getMiniAppUrl` encodes it twice, once itself and once through
the query serialiser it appends with, so the SDK's helper and the documented
schema do not agree. The documented form is what the API publishes and a test
pins what the helper does, so a release that changes either one fails.

### The notification spike is cut, and the gate it is cut on is named

The send path is not built. The permission model has three grants from three
parties, and the first one is not ours to give: "Request permission in the
Developer Portal Advanced settings, for your mini app". No mini app of ours is
registered yet, the Portal request has no published turnaround, and nothing in
the documentation states whether a draft app can obtain that permission at all.
The second grant is a one shot prompt per user, and the third is a World App
setting the user has to have on.

Two more things sit behind that gate even if it opened. The send endpoint
addresses recipients by World Chain wallet address, and this database keys people
on a nullifier and stores a Hedera account; neither value can be derived from the
other, so notifying anybody would need a new nullable column holding a World App
wallet address. That column would link a World App wallet to a nullifier and a
policy, which is part of what World ID's design exists to prevent, so it is an
opt-in with a consent line and not a quiet capture. And a sender belongs beside
the oracle's existing alert path, which is another ticket's scope this week.

So the spike stops at a plan: register the mini app, request the Advanced
settings permission on the day it is registered because the wait is unbounded,
and only then decide whether the column and the sender are worth the two hours.
The gate itself is written up in the feedback for World, which is worth more to
that prize than a sent notification would have been.

### Outbound links inside the webview are documented and not yet changed

The webview specification says opening new browser windows is prohibited and all
navigation stays in the current instance, so every `target="_blank"` in the flow
is a dead tap inside World App. The receipt screen has three of them, all
HashScan.

They are left as they are in this ticket. The fix is a component change, not a
copy change, and which of the three shapes is right, navigating in place, showing
a copyable value, or handing the URL to the native share sheet, depends on
whether an in place navigation to HashScan can come back, which needs a phone to
answer. The receipt's transaction ids are already copyable next to the links, so
nothing on that screen is unreachable in the meantime. The constraint and the
named fix are in the feedback for World.

### The surface ships tested as far as a headless session reaches, and says so

There is no phone and no World App in these sessions, so nothing here claims a
device run. What is tested: the surface branch in both directions with
`window.WorldApp` set and unset, the provider publishing it, the widget being
handed identical props on both surfaces, the entry route against the running web
app, and the entry links against the running API. What is not tested and is
stated as untested everywhere it is mentioned: the native sheet, the absence of
the QR code, `debugReport.transport` reading `mini_app`, whether the two
transports produce the same nullifier for the same person, and the file upload in
the claim flow on a real device.

## T26, index operations, 5 September 2026

The scheduler, the QA gates as an operational rule rather than a pure function,
monitoring, revisions and the backfill proof. docs/INDEX-SPEC.md sections 5 to
12 are the specification; these are the places the build had to decide something
it left open, or differ from it.

### The runs table is a file the API reads, not a Postgres table the oracle writes

docs/INDEX-SPEC.md section 10 puts `runs` in Postgres, in the apps/api schema,
owned by the oracle. The oracle has no database connection: T12 kept it off
Postgres deliberately, behind an `ObservationWriter` interface with a JSON file
behind it, so the two apps stayed decoupled. T26 keeps that arrangement and adds
a second file beside the first, `ORACLE_RUNS_PATH`, defaulting to
var/oracle/runs.json.

The alternative was a `PostgresObservationWriter` and a runs writer beside it,
plus `DATABASE_URL` in the oracle service. It was rejected for three reasons.
`pnpm test` has to stay chain free and database free, so every path that writes
a row would need a second implementation for the tests anyway. The API already
reads one file the oracle writes across the same volume, and the reader for it
is thirty lines of coercion that cannot throw, so this is a shape both apps
already know. And a database connection in the worker is a new failure mode for
the daily check: an index that stops publishing because its heartbeat table was
unreachable is worse than one that writes a file.

What is lost is that the runs table is not queryable with SQL, and that the two
copies of the schema, the migration and the file, can drift. The migration keeps
`runs` as it is, so the day the oracle does take a connection the shape is
already there.

The file carries the period as the `YYYY-MM` string rather than the integer form
of the Postgres column, because every other period in the oracle is that string
and a file the API coerces field by field gains nothing from the integer.

### One invocation of the scheduler is one check

The ticket did not say whether `pnpm oracle:schedule` schedules itself or the
container loop does. The image's command already loops the script and sleeps a
day, and T21 recorded that as a decision, so the loop owns the cadence and one
invocation does one check and exits.

That is the safer half of the pair. A resident process that has to hit 14:10 UTC
itself is a process whose clock, restarts and missed windows all have to be
reasoned about, and a check that publishes only what the source has and the
store and the topic do not is safe at any hour and safe to run twice. The 14:10
in the specification is what the loop was started at, and `--wait` exists for a
deployment with no loop around it: it sleeps until the next `--at` and then does
its one check. Both paths run the same check, so a manual run and a scheduled
run cannot drift apart.

### GET /v1/index/health is under the metered prefix, and the gate exempts it

docs/INDEX-SPEC.md section 9 names the path. The x402 gate meters
`GET /v1/index/:group`, which compiles to one non-empty segment and so matches
`health` as readily as `computer_math`, and the library's pattern syntax escapes
every character a negative lookahead would need, so the exemption cannot be
written as a pattern.

It is written as a list of exact method and path pairs, `FREE_UNDER_METERED_PREFIX`,
applied by overriding `requiresPayment` on the resource server the middleware
asks. Exact paths and not a prefix, because a prefix under a metered prefix is
exactly how a free route silently stops being free. Two tests hold it: one that
the endpoint answers 200 with the gate configured, and one that a reading for a
group still answers 402, so the exemption cannot widen unnoticed.

The alternative was `GET /v1/health`, outside the metered prefix, which needs no
exemption at all and which T12 anticipated. It was rejected because the
specification names this path and an operator will type this path. Fastify
matches a static segment before a parameter, so the route and the reading route
coexist and `health` never reaches the metered handler.

### A revision is a second row, keyed by its status

docs/INDEX-SPEC.md section 10 keys observations on `(group_key, period, status)`,
which allows a revision row beside the settled one, and section 6 says the
settled row is never touched. The store's key gains the status only when the
status is a revision, so everything that asks "was this period published" asks
about the settlement and passes no status at all.

Two revisions of one period collapse to one row, which is what the unique key
says and what stops a fetch run twice recording the same restatement twice. A
run that finds a source hash it has already recorded a revision for does
nothing.

The published message carries `"status":"revision"`, which is section 7's word.
The stored row carries `revised`, which is the word the observations table's
status check in apps/api/migrations/001_init.sql uses. They are the same event,
and the two words are the two schemas' rather than a distinction.

The revision path takes no submitter at all. The contract would ignore a second
observation for the same period, and asking it to would be a worse way of saying
"settlement never moves" than not asking.

### Backfill writes a file and no observation rows

docs/INDEX-SPEC.md section 11 says backfill "writes observations with status
final". It does not, and this records that rather than leaving it to be found.

What settles is what the index topic carries, and backfill publishes nothing by
design: history before a series existed is context, not settlement. Rows for
periods that were never published would be a second answer to the question the
topic already answers, and the observations table is what the metered feed reads
from, so unpublished history in it would be sold as a reading. docs/INDEX.md,
which is what the backfill regenerates, is the artefact the specification is
really asking for, and it is byte identical on a rerun.

### Alerts are one POST and no queue

`NOTIFY_URL` did not exist anywhere before this ticket. It is one HTTP POST per
alert with a body of event, group, period, message and run id, no signature and
no authentication, because everything in the body is already public on the topic.

There is no retry and no queue, and a delivery that fails is logged. A run that
failed because its alert failed would turn a notice into an outage. A clone with
no `NOTIFY_URL` logs the line it would have sent, so the demo path and
`pnpm test` need no endpoint, and every alert is written to the run log as well
as posted, so the container logs the event window keeps carry them too.

The specification also sends alerts to STATUS.md. That file is the board's,
outside this repository, and builders do not edit it; docs/INDEX-OPS.md says the
daily status job is what carries index health into it.

### The staleness rule is duplicated rather than shared

The 45 day line and the age arithmetic exist twice, in apps/oracle/src/staleness.ts
and in apps/api/src/oracle/health.ts. The API must not import the worker, which
is the same rule apps/api/src/replay/state.ts follows for the state reader, and
the alternative was to put an operations threshold into the pure model package
that neither app's maths uses.

Both copies answer to docs/INDEX-SPEC.md section 9 rather than to each other, and
both are held by tests that assert the line holds at 45 days and trips at 46.

They do not measure from the same place, and that is deliberate rather than a
consequence of the duplication. The oracle measures the newest period the source
carries, because the question it is asking is whether the Bureau has published.
The health endpoint measures the newest period this deployment published,
because the question it is asking is whether the feed a caller is paying for is
current. They agree while publication keeps up with releases, and where they
disagree the gap is the thing worth seeing: a source that has moved on while
this deployment has not is a publication failure, and it would be invisible if
both numbers came from the same side.

### The index health document degrades rather than failing with the database

`GET /health` embeds the index block, so a repository call inside it is a
repository call inside the endpoint that exists to report a database outage. The
first version awaited `latestPeriods` outside the handler's own try, which meant
an unreachable Postgres produced an error envelope instead of the degraded
document with the git SHA, `deps.db` and the replay state in it.

The read is now caught and the result is `null` rather than an empty list. Null
and empty are different answers: an empty list is a deployment that has
published nothing, null is a deployment that could not be asked, and reporting
the second as the first would say the index had never published anything. So the
document carries `database: unreachable`, leaves `last_period_by_group` empty,
reports no staleness, and answers `degraded`; a failed last run still outranks
it, because that is a fact about this deployment rather than about what could be
read.

The half an operator needs most survives, because it never came from the
database: whether the oracle ran, whether the gates passed, and which calendar
the feed is on all come from the two files the oracle writes.

## T29, the landing page, 6 September 2026

The design of record is `Landing v2`, a 1440 wide canvas export. Every entry
here is a place where this build could not follow it, or followed something else
that outranks it.

### The wordmark on the landing page is Creance, not Displacement Bond

The design file writes the wordmark as "Displacement Bond" in the navigation and
again in the footer bar. "The product is called Creance" above is Root's
decision and predates the file; the instrument alone keeps the descriptive name
Displacement Bond Note, and no consumer surface uses it.

So the landing says Creance in both places. Nothing else in the design's
navigation or footer changes, and the instrument name is untouched wherever the
investor screens print it.

### The landing speaks for computer and mathematical, not office and administrative support

The design's hero card, from price and index reading are all Office and
administrative support. That occupation has readings from the archive and no
series, and "Capacity is committed per occupation" above means an occupation
with no series has no price. A landing page built on it would have a card
reading "Covered" for cover nobody can buy and a from price that no quote could
produce.

One series exists, ODI-COMP-2026-01 for computer and mathematical, so the page
speaks for that group. It is one constant, `LANDING_GROUP` in
`apps/web/src/lib/landing-model.ts`, and the hero card, the from price, the two
index links and the index section all read it. Pointing the page at another
occupation is that one line, once another series is issued.

### The from price is a quote, not a figure in the copy

The design writes "From 28.00 a month" twice. An amount in the copy is an amount
that goes stale the first time pricing changes, and docs/DESIGN-TOKENS.md
section 9 already forbids hard-coding the trigger levels for the same reason.

The page asks `POST /v1/quote` for the smallest cover on offer, `LIMIT_MIN_MAJOR`
1,000, for the landing group, on the server, and formats the premium through
`src/lib/format.ts`. A quote takes no capacity, needs no eligibility and expires
in fifteen minutes, so pricing the front door is the same call the Amount screen
makes and the figure is a binding price. When no quote can be had the line
disappears and the cost answer keeps only its second sentence. It never falls
back to a number.

The same rule covers the other two figures on the page. The attachment and the
full payout level come from the reading's own trigger block, or from the free
catalogue `GET /v1/index` when there is no reading, through the same
`pointsInProse` and `exhaustionFor` the Amount screen's sentence uses. The
coupon in the investor line comes from the series the investor screens already
read.

### The last published reading is module memory, and the note says which it is

The acceptance asks the index section to degrade to the last published reading
with an honest note. Nothing in the web app stored one: every screen reads the
feed live and renders its unavailable state when the read fails, which is right
behind a purchase and wrong at the front door, where the alternative to a stale
figure is an empty page.

`src/lib/last-reading.ts` keeps the newest successful reading per group in
server module memory. It is not a cache: nothing is served from it while the
feed answers, there is no expiry, and `src/lib/api.ts` still sends every request
with `cache: 'no-store'`. A restart empties it, and the page then says it has no
reading rather than inventing one.

There are three states and the page prints a different thing in each. Live: the
reading and no note. Stale: the same reading, its chart, and "This is the last
reading we published, for July 2026. The live feed is not answering." Cold: the
note "The live feed is not answering, so there is no reading to show.", no
figure, no chart, and no zero. A shared store would survive the restart and is a
database row this event does not need; the note is the same either way.

### Terms and Contact are left out of the footer bar rather than pointed somewhere

The design's footer bar carries "How the index works", "Terms" and "Contact".
Neither of the last two has a page and this ticket does not write one. A link to
a paragraph that is not the terms is worse than no link, so the footer bar
carries the wordmark and "How the index works", and the disclosure the root
layout renders on every page is unchanged beneath it.

### The landing's pill buttons are the sheet's 56px, not the design's 44px nav pill

The design draws the navigation's "Get a quote" at 44px high and the hero and
closing pills at 56px. docs/DESIGN-TOKENS.md section 7 has one primary pill and
it is 56px, and the landing uses the same `PillButton` the whole product uses so
that a change to the component reaches every surface. Every pill on the page is
therefore 56px. The navigation bar is 72px and the pill fits inside it.

### The landing chart scales its box and holds its stroke in device space

Section 5 puts the landing line at 1.75px and the chart at full content width,
which a fixed size SVG cannot be. `IndexChart` gained a `landing` size rather
than a second component: the viewBox stays the design's 1080 by 300, the box
decides the pixels through `preserveAspectRatio="none"`, and every stroked
element carries `vector-effect="non-scaling-stroke"`.

Scaling the two axes differently is not a distortion of a line chart, it is the
same data at another aspect, and it is what lets one drawing be the sheet's 180
tall on a phone and 300 on the web. Without the vector effect the 1.75px line
would render at 0.6px at 390. The two fixed sizes are untouched and are still
drawn at the size they are given.

### The landing type scale is seven tokens, and the rest of the design maps onto the sheet

The design tool emits intermediate sizes the sheet does not have: 19px, 17px and
15px appear across the questions, the steps and the navigation. Adding a token
for each would make the marketing surface its own type system.

The seven that are genuinely new are tokens: the hero at 104, the section head
at 44, the ledger line at 56 and the step numeral at 72 are section 2's own
"Landing (web) adds", and the index reading at 96, the hero card amount at 108
and the hero lead at 22 are the sizes the design draws. Everything else maps
onto the nearest role in section 2, and every landing token steps back down to
that scale below the landing breakpoint, where section 2 tops out at display-xl.

### The landing pays 0.06 TUSD on every view

Both metered routes the page calls are priced in `apps/api/src/x402/config.ts`,
and they are not priced the same. `GET /v1/index/:group` is `DEFAULT_INDEX_PRICE`
at 0.01 TUSD and `POST /v1/quote` is `DEFAULT_QUOTE_PRICE` at 0.05, so a single
render of the front door settles two x402 payments totalling 0.06 TUSD on Hedera
testnet and takes about 3.2 seconds warm. Measured on the transfers themselves:
the two settlements from one render move 10,000 and 50,000 minor units of a six
decimal TUSD.

That is the honest cost of "the number on the landing page is the number the
product would settle on", and caching it would make the page a fixture with
extra steps.

It is recorded because it is a real operating cost of the demonstration: the
demo account pays 0.06 TUSD per page view, including every reload during a take,
and five sixths of that is the from price rather than the reading.

## T30, the three home card directions, 6 September 2026

### All three directions stay buildable, and the default stays Option A and 1a

The two entries above, "The typeface is Option A, Inter Tight for display and
numbers, Inter for text" and "The typeface is Option A, and the switch removes
the other family entirely", say Option B is dropped and not needed. They still
describe what ships. This adds the third option rather than rewriting them.

The design of record draws three home screens whose only differences are the
card treatment and the typeface: 1a Wallet card with Inter Tight and Inter, 1b
Certificate with Geist, 1c Ingot with General Sans. docs/DESIGN-TOKENS.md
section 2 already names General Sans beside Geist as the same alternative, so
the third option is the sheet's own and not an invention.

The pair is one setting. `NEXT_PUBLIC_FONT_OPTION` now takes A, B or C, and
`activeCardTreatment` in `apps/web/src/lib/font-option.ts` derives the card from
the same value, so the typeface and the treatment cannot drift apart and there
is no second mechanism. `CoverCard` takes a `treatment` prop that defaults to
the derived value; only the gallery passes it, so it can show all three at once.

The default is A and 1a, which is the direction the token sheet already carries.
Choosing a direction is a change of one variable, not a rebuild.

### The two new treatments are modifier classes, never edits to the card rule

`.cover-card` keeps its hairline border, its 20px radius, its four stop gradient
and both pseudo-element overlays. `.cover-card--certificate` and
`.cover-card--ingot` override on top of it.

The certificate's one pixel metallic edge is drawn as a gradient in the border
box with the face in the padding box, on the element the base rule already has,
rather than as a wrapper around it. The ingot's brushing is a second background
layer on the sheen pseudo-element rather than a second overlay, which leaves
`::after` free for the landing size. Both treatments drop the hero brushing at
landing size and keep its inner edge light: that brushing runs on the wallet
card's diagonal, the certificate is flat and the ingot is brushed horizontally.

### The amount keeps the sheet's scale in all three, and only its weight moves

The design file draws the amount at 58px with -0.03em tracking, at line height 1
on the certificate and 0.95 on the ingot. The sheet's display-l is 56/60 at
-0.02em, and it wins, as it did on the landing in T29. The visible difference is
two pixels of size and about four of leading.

Weight is part of the treatment and does follow the file: the certificate sets
its amount at 500, the wallet card and the ingot at 600.

That weight is what /gallery shows, where the amount is a plain string. On Home
the amount is a `DisplayNumber`, which sets `font-semibold` on its own span, so
the certificate's amount reads at 600 there rather than 500. No acceptance line
asks the counter to take its weight from the treatment, and threading one
through would touch the count up animation, so it is left alone and recorded
here instead.

### Every label on all three cards is ink, and the shared status pill is not forked

The contrast decision recorded above for the wallet card holds for the other two.
Computed WCAG 2.x ratios against each treatment's darkest gradient stop: ink-2 is
3.89:1 on the wallet card's `#DFE2E7`, 4.46:1 on the certificate's `#EFF1F4` and
3.67:1 on the ingot's `#D9DCE2`. All three are below the 4.5:1 floor. Black is
16.17:1, 18.56:1 and 15.29:1 on the same three, so every occupation and "Cover"
label is ink.

The design draws the ingot's status pill on `rgba(255,255,255,0.66)` with a
`#DFE2E7` border, where the shared pill is `rgba(255,255,255,0.78)` with the
hairline. The shared pill is used unchanged. The difference is 0.12 of alpha and
one step of grey, it is not perceptible on the ingot's ground, and a second pill
would be a worse outcome than a card that matches the file to that tolerance.

### The certificate keeps the word "Cover" for a screen reader

The design gives 1b no visible "Cover" label, because a centred column of three
things reads without one. Switching treatment must change no copy, so the word
stays in the markup as `sr-only`. The three treatments carry the same words and
arrange them differently, which is what a treatment is, and a test asserts it.

### General Sans is linked, not committed, because its licence forbids redistribution

Option C's family is General Sans from the Indian Type Foundry, under the ITF
Free Font License version 2.0. Section 01 permits self hosting for the
licensee's own sites. Section 02 forbids making the font software available
"through another font website, font library, marketplace, repository, download
service" or on "publicly accessible servers", and forbids subsetting and format
conversion. This repository is public, so committing the woff2 files would be
redistribution and next/font local is not available to Option C.

So Option C's font module carries a stylesheet href instead of a next/font call,
and the root layout links it for that option only. Options A and B export the
same name as `undefined` and link nothing. The cost is that Option C fetches its
family from a third party CDN where A and B self host, which is recorded here
because it is a real difference between the directions and not a detail.

### The gallery links its three specimen families rather than importing them

Comparing the typefaces at a glance needs all three on one page, which is the
opposite of what the switch does everywhere else. Importing the inactive font
modules from the gallery route was tried first and measured: the preload links
stayed on `/gallery`, but the `@font-face` rules landed in a stylesheet chunk
every route loads and the browser then fetched three families on Home and the
landing instead of one. The measurement is in docs/harness-notes.md.

The gallery therefore links Inter, Inter Tight and Geist from Google Fonts and
General Sans from Fontshare, and names the families literally in three
`.type-specimen` classes. Those are gallery only, the page stays unlinked and
noindex, and the product build is unchanged: with A active it still ships no
Geist file.

At 1280 the three sit in a row inside the gallery's 1280 wide column, which
leaves each card 368 rather than 390 wide. Below the gallery's large breakpoint
they stack full width, which is the 390 case. The height stays the design's 210.

### Each treatment carries its own vertical separation, because Home has no card height

The design file draws all three cards at 210 or 212 and the token sheet has no
card height, so Home lets the card size to its content and only the landing hero
and the gallery set one. The wallet card has always relied on that: its
`justify-between gap-10` is what makes it 206 tall on Home rather than collapsed.

The ingot was first built with `mt-auto` on its bottom row and nothing else,
which is correct wherever a height exists and worth nothing where one does not.
On Home at 390 with Option C the card measured 146, the occupation's bottom and
the "Cover" label's top were both 41 from the top of the card, and the two
touched. The fix is the same `gap-10` the wallet card already carries, which
puts the ingot at 186 on Home with 40 between them and the amount seated on the
card's own bottom padding. `mt-auto` stays for the sizes that do set a height.

The certificate needs nothing: it centres its column, so it stays symmetrical at
any height and sits at 176 on Home.

## T31, the attribution panel, 6 September 2026

The design of record covers no attribution panel at all, so every visual and
editorial choice below is a decision rather than a reading of the sheet.

### The panel goes on the Index tab, under "What would have happened"

The repository has one public index page, the Index tab at
apps/web/src/app/cover/index. It opens cold through `?group=`, it is what the
landing's "The index" navigation link and its "How the index works" footer link
both open, and the Mini App deep link hands over to it. Putting the panel
anywhere else would mean a reader who followed the product's own links to the
index never saw the caveats about the index.

The landing's index section was the alternative. It is a marketing section built
from a design of record that has no panel in it, and its section order is held
by a test. It is left alone.

### The panel is a neutral bar strip and not a second index chart

Section 5 of docs/DESIGN-TOKENS.md is about the index line: a black line, a red
trigger band, a band label reading "Pays out above 2.0". None of it appears
here, on purpose. The strip is ink-3 bars over a hairline baseline, in the form
the "What would have happened" strip above it already uses, so nothing about it
reads as a line that could open a claim.

Forty months across the 344px content width of the 390 frame is about six pixels
a column. A labelled line chart does not fit that and a bar strip with two axis
labels does, which is the other reason for the form.

Bars are scaled linearly against the peak month, and a month that is not zero is
drawn at least one pixel. Rounding a real 7 down to nothing would draw it as the
zero it is not. A recorded zero gets no bar, and the flat baseline is what a zero
looks like.

### The endpoint is GET /v1/attribution, outside the metered prefix

The x402 gate meters `GET /v1/index/*`. A free route under that prefix needs an
exact entry in FREE_UNDER_METERED_PREFIX and a test holding it open, which is
what `GET /v1/index/health` needed. A path outside the prefix needs neither, and
this feed has no reason to live under the index prefix: it is not an index and
it is not settlement data. It is free because charging for the caveats on a paid
product would be the wrong way round. A case in the "leaves the free endpoints
alone" block of apps/api/test/x402-routes.test.ts holds it open with the gate
configured anyway, because that is the test that would catch a later change of
prefix.

It is not in the OpenAPI document. That list is the Bazantic gateway import of
the priced routes, and the free catalogue and the health endpoint are not in it
either. llms.txt names it instead, as free context.

### The cold fallback is the committed series, bundled at build time

T29's precedent for "the last published figures with a note" is module memory of
the last successful read (apps/web/src/lib/last-reading.ts). That is right for a
live reading, which nothing on disk can stand in for, and it adds nothing here.
The attribution series is static committed data and the file the API serves is
the same file the web app can import, so a build time import of
data/attribution/challenger-ai-cuts-monthly.json really is the last published
figures rather than a remembered read or a placeholder. It also survives a
restart, which module memory does not.

The panel says on screen which of the two it is showing. It is an import and not
a runtime file read because the web image copies only apps/web and the two
packages; apps/web/Dockerfile now copies data/attribution before the build so
the bundle can carry it, and apps/api/Dockerfile copies it for the same reason
it copies data/bls.

### The caveats are held in the web app, not read from the feed

The figures come from the feed. The settlement sentence, the limits and the
correlation sentence are constants in apps/web/src/lib/attribution-model.ts. A
failed read may cost the reader a number; it must never cost them a caveat, and
a panel that fetched its own disclaimers would drop them at exactly the moment
its numbers were least trustworthy. The API serves its own structured copy of
the same limits for an agent reading the feed directly.

### The committed provenance gains a sentence about derived monthly cells

The research notes behind this series record that several monthly cells are
worked back from published year to date figures rather than from a published
monthly figure, and that the workbook flagged which. The JSON carries no per
month flag, so nothing in this repository can tell those months apart. Inventing
a flag would be worse than saying so, so data/attribution/PROVENANCE.txt gains
one plain sentence stating it and the panel repeats it as a limit.

### The panel says the two series are not aligned month for month

The index's newest published month is July 2026 and the attribution series runs
to August 2026, because the two are published on different calendars. The strip
would otherwise sit under the index chart implying a shared window. The sentence
is computed from the two latest periods rather than typed, and it disappears
when they do land on the same month.

### The attribution panel cannot take the index tab down

The panel is fetched outside the page's main try block, and a failed read falls
back to the committed series rather than to the unavailable screen. The index is
what the screen is for, and the caveats beside it are never the reason a worker
cannot see their own reading.

## T32, the public index explorer

### The explorer is `/index`, and the worker's Index tab is unchanged

The two are different pages for different readers. `/cover/index` is one
occupation for the person whose cover depends on it, inside the app frame and
behind the two tab bar, and it still answers `?group=` for the fourteen
occupations with no series behind them. `/index` is all fifteen for anyone at
all: no session, no purchase, no policy. Sharing one route would have meant a
page that is a phone screen for one reader and a desktop explorer for the other,
and neither would have been either.

The route is free of collisions because Caddy sends `/v1/*`, `/health`,
`/healthz`, `/.well-known/jwks.json`, `/llms.txt`, `/skill.md` and `/openapi/*`
to the API and everything else to Next.

### The explorer buys a longer history rather than computing one

`GET /v1/index/:group` returned twenty-four months and the explorer scrubs five
years for fifteen groups. Three ways to close the gap were open.

A `months` query parameter on the paid route, capped at 120. A free history
route under `/v1/index/`, which needs an entry in `FREE_UNDER_METERED_PREFIX`
and gives away exactly what the metered route sells, which T28 refused. Or
computing the history in the web app from the committed archive through
`@creance/index-model`, which would put figures this app worked out on a page
whose whole claim is that it prints figures somebody published.

The first. The price is per call and unaffected, the catalogue advertises the
ceiling as `history_months_max`, a malformed value is refused with
`months_invalid`, and both gateway documents carry the parameter. Nothing about
what a reading costs or what it contains changed for an existing caller.

### The fifteen readings are cached for ten minutes, and nothing else is

src/lib/api.ts says nothing is cached, because a price and a policy are live
state. Fifteen metered reads per page view is a different problem: two visitors
arriving together would pay thirty times for a figure that changes once a month.
So src/lib/explorer-data.ts holds one round of fifteen in module memory for ten
minutes behind a single in-flight promise, and the page prints the month it is
showing. The replay badge is never cached, because the demo clock moves in ten
second steps and a stale badge would be a lie about what is on screen. T33's
ticker reads the same round.

### The trigger band is above the line on the explorer, as it is everywhere else

The prototype draws the explorer with the sign flipped: it plots the margin
above average, so down is towards a payout and the red zone is at the bottom.
docs/DESIGN-TOKENS.md section 5 says the band runs from the attachment upward,
the app's own index chart draws it that way, and the API serves both trigger
forms as "open when the value reaches the line". Two charts in one product with
the red on opposite sides is worse than either convention, so the explorer
follows the sheet and the app: up is towards a payout and the band is above the
line. No axis carries a number, so no signed value reaches the screen either
way.

### The guide price holds the hazard at the line rather than extrapolating past it

`fittedHazard` is an exponential fitted to buckets that begin at the line, and
everything at or past the line is one bucket. The fit says nothing about a
negative distance, and evaluated there it runs away: at 1.5 points past the line
it asks for about eighty percent of the limit a year. apps/api/src/pricing.ts
does not floor it because it prices the current month of a group with capacity
behind it; the explorer prices sixty months of fifteen groups, most of them
containing months when claims were open, so it floors the distance at zero
before pricing. The prototype does the same.

### An occupation with no capacity shows a guide price and no premium

Capacity is committed per occupation, so fourteen of the fifteen have nothing to
sell. The explorer still prices them, because what the index says the risk is
worth is a fact about the index and is the point of the page, but it labels the
figure "Guide price", drops the capacity slider, and says that no cover is on
sale for that occupation today. A monthly premium beside a slider for something
nobody can buy would be an offer.

### The four steps are four charts, not a tabbed walkthrough

The prototype's "How this number is built" is one chart behind four tab buttons.
Four steps stacked, each with its own small chart, is the same content with no
hidden state, no tab tween, and no keyboard model to get wrong; the whole
disclosure is one native `details`. The step titles are written in the deck's
voice, because the design of record marks its own provisional.

### The explorer imports the index model's pricing, which meant splitting it

The acceptance is that the price on the page comes from `guideRate`,
`marketRate` and `monthlyPremium` in packages/index-model/src/pricing.ts rather
than from a second copy of the formula. The Next bundler cannot follow that
module's `.js` specifiers to their `.ts` files, which is the pitfall recorded at
the top of apps/web/src/lib/payer.ts, and pricing.ts pulled in the dataset
loader and `node:fs` with it. The empirical hazard table moved to
packages/index-model/src/hazard.ts, which is where it belonged: it reads the
whole archive and the three pricing functions read nothing. pricing.ts now
imports one type and nothing else, the barrel and its callers are unchanged, and
the web app and the API price from the same functions.
