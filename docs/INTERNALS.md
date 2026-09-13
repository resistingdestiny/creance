# How Creance works inside

The detail behind each part of the product. The README is the short version.

## Payment flow

Three endpoints are paid per call, with the [x402 protocol](https://docs.x402.org)
version 2 over the `exact` scheme on `hedera:testnet`, settled through the
[Blocky402](https://blocky402.com/docs/testnet/) testnet facilitator.

| Endpoint | Price |
| --- | --- |
| `GET /v1/index/:group` | 0.01 TUSD, per call |
| `POST /v1/quote` | 0.05 TUSD |
| `POST /v1/bind` | the first month premium from the quote |
| `GET /v1/policy/:id`, `GET /v1/audit/:id` and everything else | free |

TUSD is this build's settlement token, [0.0.10366463](https://hashscan.io/testnet/token/0.0.10366463),
six decimals, so 0.01 is `10000` on the wire. Every amount in the protocol is an
integer string in the token's smallest unit.

Step by step, which is exactly what `pnpm test:testnet` runs:

1. **The call arrives with no payment.** The API answers `402 Payment Required`
   with a `PAYMENT-REQUIRED` header carrying base64 of the requirements: the
   scheme, the network, the amount, the token, the account to pay
   ([0.0.10366450](https://hashscan.io/testnet/account/0.0.10366450)), and the
   facilitator's own fee payer account
   ([0.0.7162784](https://hashscan.io/testnet/account/0.0.7162784)). The body is
   the same `application/problem+json` document every other refusal returns,
   with the price repeated in a readable form. The fee payer is not configured
   anywhere: the API reads it from the facilitator's `GET /supported` at
   startup, so a rotation on their side needs no change here.

2. **The payer builds a transfer.** `createX402Payer` in
   [packages/client](packages/client/src/x402/payer.ts) takes a Hedera account
   id and its ECDSA key and returns a `fetch`. On a 402 it builds a
   `TransferTransaction` moving exactly the advertised amount from the payer to
   `payTo`, sets the transaction id to one generated for the facilitator's fee
   payer, freezes it, signs it with the payer's key alone and retries the
   request with the serialised bytes in a `PAYMENT-SIGNATURE` header. It never
   touches `Authorization`, which is where `POST /v1/bind` carries the
   eligibility credential.

3. **The API verifies before it does the work.** It sends the payment and the
   requirements to the facilitator's `POST /verify`, which decodes the
   transaction, checks it is a bare transfer of the right token for the right
   amount to the right account, checks the payer's signature against the
   account's on-chain key, and checks the payer's balance and association. A
   refusal is a 402 with the reason and no work done.

4. **The handler runs.** The index is read, or the quote is priced, or the
   policy is bound: the receipt is published, `CoverPool.bind` is called and the
   policy NFT is minted.

5. **The API settles after the work.** It sends the same payment to `POST
   /settle`. The facilitator adds the fee payer signature and submits, so the
   network fee is paid by the facilitator and not by either party, and waits for
   consensus. The settlement receipt goes back to the caller in a
   `PAYMENT-RESPONSE` header. Settling last is what makes a bind that reverts
   free: no handler, no payment.

6. **The settlement is written down twice.** A `payments` row records the
   endpoint, the payer, the amount, the asset and the facilitator's transaction
   id, and the same facts go to the payments topic
   [0.0.10366471](https://hashscan.io/testnet/topic/0.0.10366471) as a
   `kind: "settlement"` message, so the audit trail can be checked on chain
   without asking us. `POST /v1/bind` settles the row it already wrote at
   `uncollected` rather than writing a second one.

Months two onwards are not x402. The premium schedule is Scheduled
Transactions, because the Hedera exact scheme requires a bare
`TransferTransaction` and forbids one wrapped in a `ScheduleCreateTransaction`.
The first premium is the paid request; the rest are pre-signed schedules.

One run of `pnpm test:testnet` on 5 September 2026, from the demo Steward
account [0.0.10366451](https://hashscan.io/testnet/account/0.0.10366451):

| What | Settlement |
| --- | --- |
| `GET /v1/index/computer_math`, 0.01 TUSD | [0.0.7162784-1788602390-475160190](https://hashscan.io/testnet/transaction/0.0.7162784-1788602390-475160190) |
| `POST /v1/quote`, 0.05 TUSD | [0.0.7162784-1788602392-809335465](https://hashscan.io/testnet/transaction/0.0.7162784-1788602392-809335465) |
| `POST /v1/bind`, the first premium of 0.841667 TUSD | [0.0.7162784-1788602397-120605122](https://hashscan.io/testnet/transaction/0.0.7162784-1788602397-120605122) |

Each one is a transfer of TUSD from 0.0.10366451 to 0.0.10366450 whose network
fee was paid by 0.0.7162784, and each is on the payments topic at sequence 16,
17 and 20.

## The Steward agent

`pnpm steward:run` is one cycle of the agent in [apps/steward](apps/steward),
acting for one principal. DESIGN.md 3.7 gives the loop and this is it in order:
read the principal's profile, pay for the index, decide by a written rule,
quote, bind with the first premium over x402, create the premium schedule, and
write a journal entry to the agent-journal topic
[0.0.10366475](https://hashscan.io/testnet/topic/0.0.10366475). The API has to
be running with the gate on; the agent pays every metered call from its own
testnet account [0.0.10366451](https://hashscan.io/testnet/account/0.0.10366451)
and needs enough of the settlement token for the index read, the quote and the
premiums.

The profile is committed and carries no secret: the occupation group, the
principal's wallet, the cover limit and where the eligibility credential comes
from. The default is
[apps/steward/profiles/policyholder-2.json](apps/steward/profiles/policyholder-2.json);
`STEWARD_PROFILE` points at another. The agent never performs the Selfie Check.
It binds by presenting a credential issued to its principal, and the policy NFT
is minted to the principal's wallet, not to the agent's.

The credential has two sources and the profile names which one this principal
uses. A credential the principal earned at `POST /v1/world/verify` is a real
Selfie Check, done on a phone by a person; the agent only carries it. The
default demo profile instead asks the API's interim issuer at
`POST /v1/demo/eligibility`, because an agent has no camera and a headless run
cannot produce a proof of personhood. The run prints which one it used in plain
words, and the interim one says on its own line that it is not a World check.

The rule, written down. Buy when there is no cover in force and the three month
ODI trend is rising, or when the term is inside its last 30 days. The trend is
the ODI at the vantage month and the two months before it, all three consecutive
calendar months with a published value, and it is rising when the three are
strictly increasing. The vantage is the newest published month unless `--as-of`
gives an earlier one, which is the same labelled replay the demo clock uses. The
rule is one pure function, its inputs and its result are printed in the run and
published in the journal entry, and a cycle that decides to hold still journals
and still exits 0.

That is what a run on live data usually does. The three month trend at the
newest published month has not been rising in recent readings, so `pnpm
steward:run` on its own pays for the index, prints the three months it read,
journals a hold and stops before the quote. Nothing is wrong with that run: it
is the rule working. To watch the buy path, put the vantage on a month whose
trend does rise, which is the same labelled replay the demo clock uses:

    pnpm steward:run --as-of 2025-05 --cadence demo

The journal entry records `replay: true` for such a cycle, so a reader can tell
a labelled vantage from a live one.

Months two onwards are not x402. The Hedera exact scheme requires a bare
`TransferTransaction` and forbids one wrapped in a `ScheduleCreateTransaction`,
so the first premium is the paid request and the rest are Scheduled Transactions
the agent creates and pre-signs itself, one per month, each held until its due
date and each carrying an admin key so a lapsed policy can stop them. A schedule
may not expire more than 62 days after it is created, so at the real monthly
cadence the third premium does not fit and is left to the watcher, which creates
each following month when one executes. `--cadence demo` runs the same code with
the due dates seconds apart, so a whole chain is visible inside one run.

A full run against testnet, with every link, is in
[docs/demo/steward.txt](docs/demo/steward.txt).

## Tokenization

The premiums are funded by investors who buy the series as a security. The
Displacement Bond Note is issued through the [Asset Tokenization
Studio](https://github.com/hashgraph/asset-tokenization-studio) release 8.0.0 as
a Bond with the ERC-3643 configuration: an identity registry, a KYC list of
investor accounts, transfer restrictions, and pause and freeze roles. The demo
note is contract
[0.0.10368240](https://hashscan.io/testnet/contract/0.0.10368240) and every
transaction behind the steps below is linked in [docs/ATS.md](docs/ATS.md).

Four commands, in this order. Each one is idempotent: run it again and it reads
the chain, finds the work done and does nothing, so a judge repeating a step
sees `nothing to do` rather than a second issuance.

    pnpm ats:issue        issuance, roles, the credential issuer, KYC, mints,
                          a blocked then an allowed transfer, pause, freeze
                          and the first declared coupon
    pnpm coupons:pay      the declared coupon settled to each holder by a
                          Scheduled Transaction, then published to the
                          payments topic
    pnpm coupons:mature   a maturity redemption, on a short dated series
                          opened for it because the demo series matures in 2027
    pnpm market:demo      a secondary market in the notes, with a refused
                          trade, a KYC grant and then the same trade settling

The market runs on the office and administrative support note and not on the
demo note, because this bond's coupons carry no snapshot and moving a unit of
the demo note would change what its three settled coupons read back as.

Each command takes a stage name to run one step on its own, which is what to use
when watching a single operation rather than the whole sequence.
`pnpm ats:issue status` prints where the series has got to and sends nothing;
the stage lists are in [Commands](#commands) above.

What each step proves, and where the evidence is:

| Step | What it demonstrates | Links |
| --- | --- | --- |
| `issue` | The security exists on testnet with its coupon schedule configured | [docs/ATS.md](docs/ATS.md), "The run through" step 2 |
| `kyc1`, `mint1`, `kyc2`, `mint2` | The identity registry gates who may hold the note | [docs/HEDERA.md](docs/HEDERA.md), "The compliance demonstration" |
| `blocked` then `allowed` | The same transfer fails compliance and then succeeds after a KYC grant | [docs/HEDERA.md](docs/HEDERA.md), "The compliance demonstration" |
| `controls` | Pause and freeze, the two roles a regulated issuer needs | [docs/HEDERA.md](docs/HEDERA.md), "The compliance demonstration" |
| `coupon`, then `pnpm coupons:pay` | A coupon distribution paid by Scheduled Transaction, with the settlement on the payments topic | [docs/HEDERA.md](docs/HEDERA.md), "The first coupon" |
| `pnpm coupons:mature` | Redemption at maturity: the holding is burned through ATS and the principal returns from the vault | [docs/HEDERA.md](docs/HEDERA.md), "The maturity demonstration" |
| `pnpm market:demo` | A secondary market in the notes with the compliance gate enforced at a price: an offer, a refused fill, a KYC grant, then the same fill settling both legs in one transaction | [docs/ATS.md](docs/ATS.md) section 18, [docs/HEDERA.md](docs/HEDERA.md), "The secondary market" |

The principal at risk logic is ours, not ATS's: the CollateralVault holds the
subscribed principal and the CoverPool reserves against it when a month opens,
pays approved claims out of the reserve and returns the remainder when the claim
window closes. That is why a paid claim lowers noteholder principal. Both
contracts are verified on HashScan and their addresses are in
[docs/HEDERA.md](docs/HEDERA.md).

## Claims

A payout needs two keys. The index key is the group's index being open, which
CoverPool decides and stores. The loss key is an approved proof of loss, and this
is how one is submitted.

    POST /v1/world/rp-context   purpose: claim, signal: the policy id
    POST /v1/world/verify       purpose: claim, and a claim credential comes back
    POST /v1/claims             the packet: the attestation, the documents, the statement
    GET  /v1/claims/{claimId}   the claimant's own status, free and carrying nothing personal

The packet is the four parts of DESIGN.md 3.9. A fresh Selfie Check with
`require_user_presence` on the claim action, bound to the policy id as its
signal, which earns a short lived credential in its own audience. An attestation
signed by the wallet that holds the cover, naming the employer, the job title,
the occupation, the last day of work and how it ended, ending with the sentence
the person ticks: "Everything here is true. I understand that a false claim is
fraud." At least one document, encrypted at rest, with only its SHA-256 reaching
the claims topic. And the statement itself, recorded as accepted or not.

The endpoint enforces the identity leg and nothing below it: a live person check
was completed, the check was made for the claim action, the cover is open for
claims, and no earlier claim exists for this person in this series. Everything
else is adjudication, and adjudication produces a decision with a reason a person
can act on rather than a validation error they cannot. So a resignation is
accepted here and declined by the Adjuster a second later, with a record and a
hash on a public topic.

The claims topic's submit key is the adjuster account's, so the API writes the
packet hash into the row and the Adjuster puts it on the topic at the start of
its next pass, before it decides anything. A packet hash on the topic, then the
decision hash that answers it, then a payout that references both.

**On approve, the payout runs in the same request.** The API asks CoverPool what
the claim pays, signs an EIP-712 authorisation over the policy id, the claim id,
the nullifier, the packet hash, the decision hash, the payee, the amount, the
separation timestamp and a thirty minute deadline, and calls `payClaim`. The
money moves inside that call or not at all. The authorisation is stored first, so
a payout that reverts for an environmental reason can be retried by anybody with
the same signature until its deadline, and the whole step is idempotent on the
transaction id.

**On decline, the reasons come back.** There is no chain call at all: a decline
is a hash on the claims topic and reasons in the claimant's own answer.

**When claims are not open**, the API says so with the current reading, read from
the chain rather than from a cached row:

    Claims aren't open.
    Your occupation is 1.20 better than average. Claims open within 0.68 of
    average. We'll tell you here if that changes.

### One person, one claim, and what our configuration costs that

Purchase and claim run two registered World actions here,
`occupation-cover-eligibility` and `occupation-cover-claim`. A nullifier is
scoped to the app and the action, so the same person gets a different number at
each step and the claim's check cannot be compared with the purchase's.

So the sentence this build is entitled to is the weaker one: **both were live
people, the claimant controls the wallet that holds the cover, and one person
claims once.** The wallet leg is real, because the attestation is signed by the
policy's own EVM address and the API recovers it. One claim per person per
series is enforced on the claim's own nullifier, with its own unique index.

Setting `WORLD_ACTION_ELIGIBILITY` and `WORLD_ACTION_CLAIM` to a single
registered action makes the two nullifiers identical and restores the stronger
sentence, "the same live person bought the cover and collects it", with no code
change. `GET /healthz` reports `world.continuity`, which says which of the two is
running. See [docs/DECISIONS.md](docs/DECISIONS.md) under T11 and T13.

The claim's camera check cannot be automated, so a labelled demo path,
`POST /v1/demo/claim-presence`, sits behind `DEMO_ELIGIBILITY_ISSUER` for the
scripts and the seed. It says what it is in its own response and the credential
it mints records `credential: demo-issuer`, so nothing downstream can claim a
camera ran when one did not.

One payout and one decline are on testnet, with every link, in
[docs/HEDERA.md](docs/HEDERA.md).

### The screens a person claims through

    /home              the cover, and "Start a claim" when the index is open
    /claim             what the cover pays for and what it does not
    /claim/job         employer, job title, last day of work, how it ended
    /claim/proof       the documents, one is enough
    /claim/confirm     the live person check
    /claim/review      every answer, the statement, and submit
    /claim/status      the answer when it arrives, and the reasons if it is no

Every call is made on the server, so the claim credential never reaches the
browser and the attestation is signed there with the key of the account the
cover was bound to. The files live in the web process between the upload screen
and the packet, and go no further: the API is where they are sealed.

Home carries the state of the cover: Covered, Claims open when the chain says
the series is open, Claim in progress while one is being decided, Paid out with
the amount received and a receipt, and Payment due when a premium has been
missed. A lapse, a failed payment and an offline browser have no server path to
force, so `WEB_DEMO_STATES=true` turns on `/home?demo=lapsed` and its five
siblings, which render from fixtures and say so on the screen. They render only
for a browser that holds no cover of its own, so a person who bought cover
cannot be sent a link that replaces their own answer with a fixture.

### Seeing a cover without buying one

A reader with no World ID, no wallet and no purchase reaches the front door and
stops, because everything after the purchase is on a dashboard behind a check.
`/home/demo` is the way past that. It lists the covers this deployment
publishes, prints the cover key that opens each, and opens one by posting that
key to the same server action the cover key field on `/home` posts to. The
covers behind it are real: `pnpm demo:seed` bound them on testnet, and every
figure on the dashboard they open resolves on HashScan.

Nothing about the way in is weakened to make that work. The key is a whole
twenty character cover key, it is checked by the API exactly as a typed one is,
and it opens its own cover and nothing else. What is different is only that it
is published rather than kept.

Two settings turn it on, both private and neither a `NEXT_PUBLIC_` name.
`WEB_DEMO_COVERS` carries the covers, in the line `pnpm demo:seed` prints at the
end of a run; `WEB_DEMO_STATES` adds the fixture states beneath them. A
deployment with neither has no page there at all. The covers live in whatever
database `DATABASE_URL` named when the seed ran, so a key seeded against one
database opens nothing on a deployment pointed at another.

## The review queue

Referred claims are reviewed at `/admin/claims`, a desktop screen that lists
each one with the Adjuster's reasons, the evidence fingerprints and the
statement behind it, and approves or declines through the endpoints below. A
decline asks for one plain sentence, because that sentence is what the person
reads.

The screen asks for the reviewer token before it shows anything. It is the same
`ADMIN_TOKEN` the API compares, typed once and exchanged for an opaque session
id in an httpOnly cookie; the token never reaches the browser. Approving moves
settlement funds, so the decide action checks that session before it calls the
API, not only the page that renders the button. "Sign out" ends it, and a
restart of the web server ends every session.

A claim needs two keys: the index has to be open for the occupation, and the
person has to show they lost their job. The second key is adjudicated. The
Adjuster reads the packet, checks it against the cover and the index, and either
decides the claim or hands it to a person, and the whole of it is in
[docs/CLAIMS.md](docs/CLAIMS.md).

The model extracts and the code decides. A vision-capable model reads one
document at a time and returns a closed record of what that document says. It
never sees the statement the person signed, it has no field in which to express
an opinion about the claim, and every rule outcome, the amount and the confidence
are computed afterwards in TypeScript from the cover, the frozen series terms and
the open months read off CoverPool. That is what makes an adjudication
reproducible from a fixture with no network, and explicable line by line when
somebody asks why a claim was declined.

A claim auto-approves only when every rule passes, the confidence reaches the
series threshold and the amount is within the series auto-approval limit.
Otherwise it refers, and a person works it from the queue:

    GET  /v1/admin/claims?status=under_review     the queue, with no personal data on it
    GET  /v1/admin/claims/{id}                    the review screen in one request
    GET  /v1/admin/claims/{id}/evidence/{id}      one decrypted document
    POST /v1/admin/claims/{id}/decide             approve or decline, with one sentence

All four are behind `ADMIN_TOKEN`, compared in constant time. Nothing decides a
claim by running out of time: an overdue claim is flagged and sorted to the top,
and that is all. A reviewer is not bound by the confidence threshold, because a
person reading the document is a better signal than a number computed about it,
and is bound by the hard rules: nobody approves a resignation, and the API
refuses it as well as the screen.

The reasons a person reads are written for them. "Resigning isn't covered. This
cover pays when your employer ends your job." A decline always says either what
would change the answer or why nothing would.

The decision record carries the decision, the reasons as codes, the confidence
with every component of it, the evidence fingerprints and the result of every
rule. It carries no name, no employer, no job title and no file name, which is a
design rule rather than an accident: its SHA-256 goes on a public topic forever,
so the answer to "show me the thing behind the hash" should be "here it is".
Only the hash, the two ids and the decision word are published. The first one is
on the claims topic at sequence 1; the links are in
[docs/HEDERA.md](docs/HEDERA.md).

Two synthetic packets are committed under `apps/adjuster/fixtures`, with invented
employers and documents rendered by a script. One is a clean redundancy that
auto-approves at a confidence of 0.940; one is a resignation that is declined in
under a second, without the document ever being read. Both are asserted by
`pnpm test`.

## Demo

    pnpm api:migrate
    pnpm demo:seed

That is the whole setup. It binds the two policies the two claim packets are
claimed on, leaves the note and the noteholder positions where they already are,
checks both letters against the cover they will be claimed on, and prints an id
block with a HashScan link for every id the demonstration needs. Run it twice: a
second run should bind nothing, which is the run that matters on the day.

[docs/DEMO.md](docs/DEMO.md) is the shot list: nine shots with their timings,
the command for each, what has to be true before it and what has to be legible
on screen, plus the recording procedure and the Bazantic screen recording. The
same sequence is committed as data and printed by `pnpm demo:seed scenario`.

Two things in it are worth knowing before you run anything. The demonstration
opens May 2026 live on camera, and a month can only be submitted once, so
`pnpm demo:seed status` reports whether it is still in hand and never spends it.
And the claim window on the demo series runs to 5 October 2026, so `closeWindow`
cannot execute on it inside the event; `pnpm --filter @creance/contracts
demo:release` shows the release for real on a series opened for the purpose with
its claim window measured in seconds, and the shot list says so out loud rather
than working around it.

## Audit trail

`GET /v1/audit/:policyId` is the trail for one policy, and it is free. The
database holds the sequence numbers of the messages and the mirror node holds
the messages themselves, so what comes back is what is on the topics rather
than what our rows say. Every entry carries its topic, its sequence number, its
transaction and a HashScan link, and says which of the two it came from: an
entry the topic does not carry is marked rather than shown as recorded. Nothing
in the response identifies a person.

The receipt screen at `/receipt/:policyId` in the web app is that endpoint,
rendered. The measured run through and the links are in
[docs/HEDERA.md](docs/HEDERA.md), section "Audit trail".
