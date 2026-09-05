# Buy displacement cover for my principal

A recipe for an agent working on behalf of a person. It reads the published
index off the Hedera Consensus Service through the mirror node, reads the same
month again from the paid Creance feed, refuses to go on if the two disagree,
and only then quotes and binds cover.

## When to run it

When a person has verified with World ID in the Creance app, has no active
cover for their occupation, and has asked their agent to buy cover. Also at the
end of a twelve month term, when the previous policy has just expired and the
renewal check said renew.

## Why it exists

Cover is priced from one number: the Occupation Displacement Index for the
person's occupation group. That number is published to a Hedera topic before it
is ever served over HTTP, so an agent can read the trigger conditions off the
public record instead of trusting the seller's own quote page. This recipe reads
the public record first and buys second, and the reading it accepts a price for
is the one it read from consensus.

## Services it uses

1. **Hedera mirror node REST API**, testnet, the sponsor service.
   `https://testnet.mirrornode.hedera.com/api/v1`. It reads the index
   observations off topic `0.0.10366470`. Nothing in this step is taken on
   trust: the message is the one consensus recorded, submitted by the oracle
   account `0.0.10366447`, which holds the topic's submit key.
2. **The Creance gateway**, the project's own x402 gateway. Three operations
   here: the paid index feed, the quote and the bind. The first two are metered
   per call and the third is priced at the first month's premium, all settled
   over x402 version 2 on Hedera testnet.

The result depends on both. Step 3 stops the recipe when the paid feed and the
topic disagree about the month it is about to buy on, and the policy the recipe
ends with names the period both services agreed on.

## What it needs to start

- The principal's occupation group, one of the fifteen keys the index covers,
  for example `computer_math`.
- The cover limit they want: 1,000 to 10,000 TUSD in steps of 500. The API takes
  it in the settlement asset's smallest unit, so 5,000 TUSD is the string
  `5000000000` (TUSD `0.0.10366463`, 6 decimals).
- The principal's Hedera account id, for example `0.0.10366457`. The policy NFT
  is minted there and never to the agent.
- An eligibility credential for that person: a bearer token, EdDSA over Ed25519,
  good for thirty minutes, carrying the nullifier, the group, the series and the
  wallet. The agent is handed one by its principal. It cannot mint one, because
  what earns a credential is a World Selfie Check completed in the World App by
  a living person. Verify it, if you want to, against
  `GET https://creance.co/.well-known/jwks.json`.
- Funding for the agent's own wallet: TUSD for the calls and the first premium,
  and the token association to hold it. Two paid reads and a first premium on a
  5,000 limit come to roughly 4.5 TUSD.

## Steps

**1. Read the latest observation for the group off the index topic.**

    GET https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.10366470/messages
        ?limit=100&order=desc

Each item carries `consensus_timestamp`, `sequence_number`, `payer_account_id`
and `message`, and `message` is base64. Decode it and parse the JSON. One topic
carries all fifteen occupation groups, so filter on the decoded `group` field
first.

Then take the newest `period`, not the newest message. Those are different
things: on 5 September 2026 sequence 27 carried `computer_math` `2026-07` and
sequence 33, six messages later, carried `computer_math` `2026-06`, because a
backfill publishes months in the order it computes them. Sort the group's
messages by `period` and take the last one. If two messages carry the same
period, the later one is a revision and `revises_seq` names the message it
replaces; take the later one.

Read `period`, `ebar`, `odi`, `open`, `open_reason`, `attachment_shock`,
`level_line`, `status` and `source_hash`.

**2. Stop unless that observation is settled.**

`status` is `final` for a month that settles. A month with `no_source` (the
source never published it, as for `2025-10`) or `insufficient_history` (fewer
than the twelve months the year on year difference needs, as for `2025-11` and
`2025-12`) carries nulls in `odi` and `ebar` and is not a reading. A group with
no observation at all on the topic is not bindable, and quoting one anyway is
exactly the failure this recipe exists to prevent.

**3. Ask the paid index feed for the same group, and make the two agree.**

    GET https://creance.co/v1/index/{group}

x402 gated: unpaid it answers 402 with the terms in the `PAYMENT-REQUIRED`
header and the price in the body, 0.01 TUSD, `10000` in the smallest unit. The
gateway settles it and hands the agent a normal 200 back with the settlement
receipt in `PAYMENT-RESPONSE`. The body carries the latest observation, up to
twenty four months of history and the trigger status.

Now check the two against each other:

- `as_of` on the feed is the same period as the newest settled message on the
  topic.
- `reading.ebar` and `reading.odi` equal the topic's `ebar` and `odi`.
- `trigger.attachment_shock` and `trigger.level_line` equal the topic's
  `attachment_shock` and `level_line`.

Two shape differences are expected and are not a disagreement. The topic carries
JSON numbers and the feed carries decimal strings, so compare numerically:
`-1.37` and `"-1.37"` are the same reading. And a month with claims closed has
`open_reason` `"none"` on the topic and `null` on the feed; treat them as the
same answer.

Anything else, stop and report the disagreement with both values, the sequence
number and the period. **This is the step that makes the result depend on both
services**: the topic is the check, the feed is the working data, and neither
alone is enough to buy on.

Worked example, from the live testnet topic on 5 September 2026. Sequence 27,
`computer_math`, `2026-07`: `ebar` -1.37, `odi` -0.07, `attachment_shock` 2.0,
`level_line` -0.68, `open` false, `status` final. The paid feed answered the
same month with the same two numbers in the run recorded in
`docs/demo/steward.txt`, settled at
`0.0.7162784@1788612706.567692623`.

**4. Decide, out loud, in one line the person can read.**

The rule, from DESIGN.md 3.7 and implemented in `apps/steward/src/rule.ts`: buy
when there is no active policy and the three month trend of `odi` is rising, or
when the current policy is inside its annual renewal window, which is the last
thirty days of the term. Otherwise hold and say why.

Rising means strictly increasing across three consecutive published months,
`odi[p-2] < odi[p-1] < odi[p]`, read off the `history` the paid feed returned
and compared as decimals. Two equal months are not a rise. Three readings that
are not three consecutive calendar months are not a trend either: the source has
real holes in it and the rule refuses to call a gap a direction.

Print the three periods and their values in the decision line, so the person can
check it: for example "buy: the three month ODI trend is rising; 2024-05,
2024-06, 2024-07 ODI 0.27 -> 0.40 -> 0.60". A hold is a legitimate outcome and
the recipe ends there, having spent 0.01 TUSD.

**5. Quote.**

    POST https://creance.co/v1/quote
    { "group": "computer_math", "limit": "5000000000", "wallet": "0.0.10366457" }

Paid, 0.05 TUSD, `50000` in the smallest unit, and nothing substitutes for it.
An eligibility credential is not a payment here: the gate never reads the
`Authorization` header on this operation, so an unpaid quote carrying one is
refused with the same 402 and the same price. The credential is for the bind.

Answers 201 with a quote id, the monthly premium, the series id, the frozen
`attachment_shock` and `level_line` the price was built on, the capacity behind
it and an expiry. Quotes last fifteen minutes and take no capacity hold, so
bind promptly rather than queue.

Stop on 409 `no_capacity_for_group` (no Displacement Bond Note series has been
issued for that occupation, which is true of fourteen of the fifteen today) or
409 `insufficient_capacity` (the series is full). Both are real answers, not
errors.

**6. Bind.**

    POST https://creance.co/v1/bind
    Authorization: Bearer <the eligibility credential>
    { "quote_id": "qte_01M1RT09689KHQ5NPMXYV4M7ZD" }

The body is the quote id and nothing else. The amount, the wallet and the limit
all come from the quote and the credential, so a request cannot influence its
own price. A client that cannot set headers may put the credential in the body
as `eligibility` instead; sending both is refused unless they are identical.

The payment for this call is the first month's premium, taken from the quote,
settled over x402 like the other two. Answers 201 with the policy id, the policy
NFT token and serial, the payments topic sequence number of the receipt, and the
bind transaction.

There is no static price for this operation, so an unpaid bind is how an agent
finds out what it costs: the 402 carries the amount in `PAYMENT-REQUIRED` and in
the body. A quote that cannot be priced, because it does not exist, has expired
or has already been bound, is refused before the 402 rather than after it, so a
payer never signs a transaction against a quote that was never going to bind.

**7. Confirm by reading it back, free.**

    GET https://creance.co/v1/policy/{policyId}
    GET https://creance.co/v1/audit/{policyId}

The audit read returns the messages the payments topic carries for this policy,
read back off the mirror node rather than out of the seller's database, each
with its sequence number, its consensus timestamp and a HashScan link.

## What comes back

The policy id, the cover limit, the monthly premium and the date the next one is
due, the series id, the NFT serial in the principal's wallet, the payments topic
sequence number of the bind receipt, the settled transaction id of the premium,
and the index period the decision was made on, agreed by both services.

## What the result means

The principal holds cover on one occupation group for twelve months. It pays out
when two things are both true: the index for that group opens claims for the
month they lose their job or one of the two months after it, and they show an
approved proof of involuntary separation. Two keys, not one.

Claims open on either of two forms. Shock: `odi` reaches `attachment_shock`, an
abrupt dislocation. Level: `ebar` reaches `level_line`, the slow grind that a
year on year difference removes. A negative level line is normal and is not a
mistake: for an occupation with structurally low unemployment the trigger is
deterioration measured against its own history, so `ebar` -0.60 against a line
of -0.68 is close to opening even though both numbers look benign.

It does not pay out for resigning, for dismissal for cause, or for a job loss
inside the first sixty days. Basis risk remains on the attribution side: an
occupation-specific shock that has nothing to do with automation opens claims
too, and the index does not try to tell the two apart.

The premium is due monthly and cover lapses fifteen days after a missed payment.

## About the credential, plainly

The recipe uses a credential its principal hands it, issued by
`POST /v1/world/verify`, which forwards a complete World IDKit result to World
and checks it. That endpoint is not part of this gateway on purpose: a Selfie
Check is completed in the World App by a person, not by an agent.

There is a second issuer, `POST /v1/demo/eligibility`, which mints the same
credential without a Selfie Check. It is labelled as interim in its own
response, it is deliberately absent from this gateway's OpenAPI document, and
`DEMO_ELIGIBILITY_ISSUER=false` turns it off. It exists because the testnet
scripts and the Steward have no phone and no camera, and it is what the recorded
runs used. A recipe run for a real person uses the World credential; a recipe
run in a demo where nobody is holding a phone uses the interim issuer and should
say on screen that it did.

## Where this recipe stops

At bind, and it says so rather than implying more. The following months' premiums
are created as Hedera Scheduled Transactions, one per month, pre-signed by the
payer. That is deliberately outside x402: the exact scheme requires a bare
transfer transaction and forbids one wrapped in a `ScheduleCreate`, so a wrapped
premium cannot be settled through the facilitator. The Steward agent
(`apps/steward`) does that work after a bind, and a run of it is transcribed in
`docs/demo/steward.txt`.

## When it should refuse

- No settled observation on the topic for the group, or the newest one has
  `status` other than `final`.
- The paid feed and the topic disagreeing on the period, the reading or the
  frozen parameters.
- No eligibility credential, or one that has expired: 401 `credential_missing`,
  401 `credential_invalid`, 403 `credential_expired`. They last thirty minutes,
  so fetch one when the recipe reaches step 6 rather than at the start.
- 409 `credential_consumed`: that credential has already bought a policy.
- A limit that is not a multiple of 500 between 1,000 and 10,000: 400
  `limit_out_of_range`.
- 409 `no_capacity_for_group` or 409 `insufficient_capacity`.
- 409 `already_covered`: one active policy per verified person per series, which
  the pool enforces on chain and not only in the API.
- 410 `quote_expired`: fifteen minutes passed. Quote again, do not retry.

Every refusal is an RFC 9457 problem document with a `code` to switch on and a
`retryable` boolean. Switch on `code`, never on `detail`.

## How to tell it worked

- `GET /v1/policy/{policyId}` answers 200 with status `bound`, the NFT serial
  and the next payment date. It is `bound` and not `active` on the day it is
  bought; the status moves on as the schedule runs.
- The policy NFT serial is visible in the principal's wallet on HashScan, under
  collection `0.0.10366468`, and not in the agent's.
- The payments topic `0.0.10366471` carries a new message at the sequence number
  the policy reports, with the facilitator's transaction id on it. The
  settlement transaction id starts with `0.0.7162784`, the facilitator's fee
  payer, and not with the agent's account: that is the id to look up on
  HashScan.
- The period on the policy is the period the mirror node returned in step 1.
