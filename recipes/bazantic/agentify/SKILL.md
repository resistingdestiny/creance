---
name: occupation-displacement-index
description: Read the Occupation Displacement Index for a US occupation group: whether the occupation is losing ground against the labour market, how far the reading sits from each of the two trigger lines, and whether displacement claims are open. Use it when a question is about an occupation rather than a person, and a published number is wanted rather than an opinion. Paid per call over x402 on Hedera testnet, 0.01 TUSD.
---

# Occupation Displacement Index

A monthly index of how far a US occupation is losing ground against the labour market as a whole, published to a Hedera Consensus Service topic and sold per call over x402 on Hedera testnet.

Testnet only. No mainnet endpoints and no real funds.

## When to use it

- A person or an agent asks whether an occupation is being displaced, or how a named
  occupation is doing against the labour market.
- Something has to be priced or decided against occupational risk: cover, a renewal, a
  reserve, a hiring plan.
- A published number is needed rather than an opinion, and the caller wants to be able to
  check it against a public record afterwards.

Do not use it to predict an individual redundancy. It measures an occupation, not a person.

## What a reading is

Take the unemployment rate for one occupation group in one month and subtract the rate
across all occupations. That excess is smoothed over three months (`ebar`), and the index
(`odi`) is the smoothed excess less its own value twelve months earlier. Subtracting the
all-occupation rate removes the business cycle and most of the seasonality, so a recession
does not move every occupation at once. What is left is the occupation against the market.
Values are percentage points, and every one of them is a decimal string and never a JSON
number: on chain the thresholds are int64 scaled by 1e4, and a float round trip is how a
reader ends up with a number the contract never compared.

## The two trigger forms

A reading is a number against two frozen lines, and either one opening is what puts an
occupation in trouble. Both lines are set when a series is issued and never move.

- **Shock**, `odi >= attachment_shock`. An abrupt dislocation: the occupation has lost
  ground fast over the last twelve months.
- **Level**, `ebar >= level_line`. The slow grind that year on year differencing removes:
  the occupation has settled at a worse level than its own history.

A level line can be negative, and this is the reading most often got wrong. For an
occupation with structurally low unemployment the trigger is deterioration against its own
past, not high unemployment in absolute terms. On 5 September 2026 `computer_math` read
`ebar` -1.37 against a level line of -0.68: claims closed, and the level form is the nearer
of the two at 0.69 percentage points away. A reading of -0.60 against the same line would
be close to opening even though the number is negative and looks benign.

## What it is not

It is not a forecast and it is not an unemployment rate. It says how an occupation is doing
relative to all occupations, on data the US Bureau of Labor Statistics published, with the
source series id and a hash of the source rows on every reading so anyone can recompute it.
It says nothing about any individual person.

## How to call it

**1. Read the catalogue. It is free.**

```
GET https://creance.co/v1/index
```

It answers the valid `group` keys, the frozen `attachment_shock` and `level_line` for each,
a `latest_period` per group which is null when nothing has been published for it, and the
price of a reading under `price`. Pick the group from this list. A paid call for a group
with no `latest_period` is refused with 503 after the payment has been taken.

**2. Buy the reading.**

```
GET https://creance.co/v1/index/{group}
```

Unpaid, it answers 402 with the terms in the `PAYMENT-REQUIRED` header and the same terms
in readable fields in the body. Pay as described below and retry with the
`PAYMENT-SIGNATURE` header; the settlement receipt comes back in `PAYMENT-RESPONSE`.

The response carries `reading` (the newest month), `trigger` (the frozen lines, whether
claims are open, and how far the reading sits from each line), `headline` (whichever form
is nearer its line, decided server side so two readers cannot decide differently),
`history` (up to twenty-four months, oldest first), and `source` (the series id and a hash
of the source rows).

**3. Say whether the clock is live.**

```
GET https://creance.co/v1/replay
```

Free. If `mode` is not `live`, the feed is replaying published history for a demo. Report
the reading with the month it is from and say the clock is replaying, rather than calling
it current.

## Payment

Price: 0.01 TUSD per call, which is `10000` in the smallest
unit of the HTS token `0.0.10366463` at 6 decimals.

Flow: x402 version 2, scheme `exact`, network `hedera:testnet`, settled through the
Blocky402 testnet facilitator at https://api.testnet.blocky402.com. Call without paying and the
answer is 402 with the requirements in the `PAYMENT-REQUIRED` header and the same terms
in readable fields in the body. Build a Hedera `TransferTransaction` against them, send
it in `PAYMENT-SIGNATURE`, and the settlement receipt comes back in `PAYMENT-RESPONSE`.

Pay to 0.0.10366450. The facilitator adds its own signature and pays the Hedera fee,
so the settlement transaction id begins with its fee payer 0.0.7162784 and not with
the paying account. That is the id to look up on HashScan.

Testnet only. There are no real funds anywhere in this feed.

There is no faucet for the settlement token. A caller who needs some asks the operator,
who mints and transfers it; the request path is in the repository under
`recipes/bazantic/agentify/README.md`. HBAR for account fees comes from the Hedera portal
faucet, and a payer needs almost none of it: the facilitator pays the network fee.

## A worked call

The 402 first, which needs nothing but curl:

```
curl -i https://creance.co/v1/index/computer_math

HTTP/1.1 402 Payment Required
content-type: application/problem+json
PAYMENT-REQUIRED: eyJ4NDAyVmVyc2lvbiI6MiwiZXJyb3IiOiJQYXltZW50IHJlcXVpcmVkIiwuLi59

{"type":"https://creance.co/errors/payment-required","title":"Payment required",
 "status":402,"code":"payment_required","retryable":false,
 "price":{"amount":"10000","asset":"0.0.10366463","decimals":6,"display":"0.01"},
 "x402_version":2,"scheme":"exact","network":"hedera:testnet",
 "pay_to":"0.0.10366450","facilitator":"https://api.testnet.blocky402.com"}
```

Then pay and read. Any x402 version 2 client with a Hedera signer will do it. This is the
shape of the answer, with the values of the month the demo series opened, published to the
index topic at sequence 16:

```json
{
  "group": "computer_math",
  "group_label": "Computer and mathematical",
  "series_id": "ODI-COMP-2026-01",
  "as_of": "2026-04",
  "reading": {
    "period": "2026-04",
    "u_g": "3.50", "u_all": "4.00", "e": "-0.50", "ebar": "-0.60", "odi": "0.30"
  },
  "trigger": {
    "attachment_shock": "2.00", "level_line": "-0.68",
    "open": true, "open_reason": "level",
    "shock_margin": "-1.70", "level_margin": "0.08"
  },
  "headline": { "form": "level", "distance": "-0.08", "on_the_line": false, "open": true }
}
```

Read that as: claims are open for computer and mathematical occupations, on the level form.
The smoothed excess of -0.60 has crossed a level line of -0.68 by 0.08 percentage points,
while the shock form is still 1.70 points away. Unemployment in these occupations is not
high in absolute terms, 3.50 against 4.00 across all occupations; it is high against this
occupation's own history, which is what the level form is for.

**Watch the two sign conventions.** A margin is the reading less its line, so
`level_margin` and `shock_margin` are negative while the form is closed and zero or
positive once it has opened. `headline.distance` is the other way round, the line less the
reading, so it is positive while the form is closed and negative once it has opened. The
margins are the pair to compare across occupations; `headline` is the one to quote.

## How to report a reading

- Give the period. A reading is a month, not a moment.
- Give the number and the line it is measured against, not the number alone.
- Say which form is nearer, because that is the one that opens first.
- Say whether claims are open, and on which form.
- If the clock is not live, say so.

## When to refuse

- The group is not in the catalogue. Do not guess a key; the payment is taken before the
  handler sees it, so a guess costs money and answers 402 or 400.
- `latest_period` is null for the group. Nothing has been published, and the paid call
  answers 503.
- 503 `index_unavailable` came back anyway. Report it; do not retry with another group and
  present that as the answer.
- The payer holds no settlement token. Say so and stop rather than reporting a number from
  memory.

## Checking the answer without trusting this API

Every observation is one message on the Hedera Consensus Service topic 0.0.10366470,
signed by the publishing account. Read the same month from the mirror node:

```
GET https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.10366470/messages?limit=5&order=desc
```

Decode `message` from base64. The topic carries JSON numbers where this API carries decimal
strings, and a closed month is `"open_reason":"none"` there and `null` here; those are the
same answer, not a disagreement. The first value published for a period settles forever, so
a month read today reads the same next year.

Every settled call is written to the payments topic 0.0.10366471 with its facilitator
transaction id, so a caller can prove what it paid for without asking this API.
