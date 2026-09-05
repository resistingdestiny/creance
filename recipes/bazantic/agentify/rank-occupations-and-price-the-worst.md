# Rank a shortlist of occupations and price cover for the worst

A recipe for an agent holding more than one occupation and a limited budget. It
ranks the occupations by how close each is to its own trigger, then prices cover
for the one in the most trouble and says what that costs per unit of exposure.
It uses both Creance gateways: the index feed decides the ranking, the cover
gateway decides the price, and neither answer can be reached from the other.

## When to run it

- A household or a small firm has people in two or more occupations and wants to
  cover one of them, not all of them.
- A broker or an agent holds a book of occupations and has to say which to
  attend to first.
- Quarterly, over the same shortlist, to see whether the order has changed.

## Why it exists

The single most common mistake with this index is reading a level as a rank.
Occupation A at `ebar` 0.40 and occupation B at `ebar` -1.20 look like A is
worse, and that is not what the index says: A's level line may be 2.10 and B's
-0.68, in which case B is 0.52 percentage points from opening and A is 1.70
away. The lines are per occupation, frozen at issuance, and the only comparable
number across occupations is the distance from a reading to its own nearer line.

This recipe computes that distance for every occupation on a shortlist, in one
place, and then does the thing a ranking is for: it prices the top of it.

## Services it uses

Two gateways, both on Bazantic, and the result depends on both.

1. **The Occupation Displacement Index gateway**, this directory's
   `openapi.yaml`. The free catalogue supplies the valid group keys and the
   frozen `attachment_shock` and `level_line` per group; the metered reading
   supplies the current `ebar` and `odi` for each shortlisted group, at 0.01
   TUSD a call.
2. **The Creance cover gateway**, `../openapi.yaml`. `POST /v1/quote` supplies
   the premium for the occupation that came out worst, at 0.05 TUSD a call, and
   `GET /v1/series/{seriesId}` supplies the capacity behind it, free.

The ranking cannot be computed from the cover gateway: a quote carries a price,
not an index reading. The price cannot be computed from the index gateway: a
reading carries no premium and no capacity. Every number in the report comes
from the gateway that owns it.

Optionally, and free, the **Hedera mirror node** on the index topic
`0.0.10366470` to check any one line of the ranking against the settled record.

## What it needs to start

- A shortlist of occupations, as words. The agent maps them to group keys itself
  from the catalogue rather than being handed keys.
- The cover limit to price, between 1,000 and 10,000 in steps of 500.
- A wallet address for the quote.
- Funding: 0.01 TUSD for each occupation on the shortlist, plus 0.05 TUSD for
  the quote. A shortlist of four costs 0.09 TUSD in total.

No eligibility credential. This recipe stops at the quote and binds nothing.

## Steps

**1. Read the catalogue and map the shortlist onto it.**

    GET https://creance.co/v1/index

Free. Match each occupation on the shortlist to a `group` key by its `label`.
Drop anything that does not map and say which, rather than guessing a key: the
paid route takes the payment before it validates the group, so a guess costs
0.01 TUSD and answers 402 or 400.

Keep each matched group's `attachment_shock`, `level_line` and `latest_period`
from this response. Drop any group whose `latest_period` is null, and say so: a
paid call for it is refused with 503 after the payment.

**2. Check the clock.**

    GET https://creance.co/v1/replay

Free. If `mode` is not `live`, the feed is replaying published history. The
readings are real published months, but they are not this month, and every line
of the report has to say which month it is reporting.

**3. Buy one reading per surviving group.**

    GET https://creance.co/v1/index/{group}

0.01 TUSD each. Take `reading.ebar`, `reading.odi`, `trigger.shock_margin`,
`trigger.level_margin`, `trigger.open`, `trigger.open_reason` and `as_of`.

Stop and report if a group answers 503 despite a non-null `latest_period` in
step 1. That is a disagreement between two responses of the same feed, and a
ranking built on it is worth nothing.

**4. Rank by distance to the nearer line.**

Both distances are already in the response. `trigger.shock_margin` is `odi` less
`attachment_shock` and `trigger.level_margin` is `ebar` less `level_line`. A
margin is negative while its form is closed and zero or positive once it has
opened, so the number to rank on is the larger of the two, which is the nearer
line. Sort descending: least negative first, and anything at zero or above is a
group where claims are already open.

Watch the sign. `headline.distance` in the same response is the other way round,
the line less the reading, so it is positive while the form is closed and it
gets smaller as the group gets worse. Rank on the margins or rank on
`headline.distance` ascending, but do not mix the two: they agree on the order
and disagree on the direction.

Do the arithmetic on decimal strings parsed to numbers for comparison only, and
report the strings the feed sent. Never round a margin before comparing two.

**5. Price cover for the worst one.**

    POST https://creance.co/v1/quote
    {"group": "{worst}", "limit": "{limit}", "wallet": "{wallet}"}

0.05 TUSD. The limit is an integer string in the settlement asset smallest unit,
so 5,000 TUSD is `5000000000`.

Three refusals are answers and not faults. `no_capacity_for_group` means no
Displacement Bond Note series covers that occupation, so the worst occupation on
the ranking is one nobody is selling cover on; report the ranking and say that.
`insufficient_capacity` means the limit is larger than what is left; report the
capacity and offer the smaller limit. `series_not_open_for_binding` means the
series is not selling today.

If the worst group cannot be quoted, do not silently quote the second. Say the
first cannot be covered, then offer to price the second.

**6. Read the capacity behind the price.**

    GET https://creance.co/v1/series/{seriesId}

Free. The `series_id` comes back on the quote. It gives the principal still free
to sell against, the term and the coupon, which is what says whether this cover
can be bought again next quarter at all.

**7. Optionally, check one line against the topic.**

    GET https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.10366470/messages
        ?limit=100&order=desc

Free. Decode `message` from base64 and find the one whose `group` and `period`
match the top line of the ranking. Its `ebar`, `odi`, `attachment_shock` and
`level_line` must match what the feed returned. The topic carries JSON numbers
where the feed carries decimal strings, and a closed month is
`"open_reason":"none"` there and `null` on the feed; neither is a disagreement.
Cite the sequence number.

## What comes back

A table, ordered worst first, one row per occupation: the group, the month, the
`ebar` and `odi`, both margins, which form is nearer, and whether claims are
open. Then one paragraph: the premium quoted for the worst occupation, the limit
and the term it covers, the capacity behind it, and the cost as a percentage of
the limit per year so the number can be compared with anything else.

Then one sentence naming what the ranking is not: a prediction about any person.

## What the result means

The ranking is a ranking of occupations against their own histories, and that is
the only ranking this index supports. An occupation at the top is not the one
with the highest unemployment, it is the one closest to the line its own series
was issued with.

An occupation with `trigger.open` true is one where the index key has already
turned. That does not pay anybody: a payout needs the index open **and** proof
that the person lost their job. Cover bought after the month opens is priced
accordingly, and a recipe that presents an open month as an opportunity has
misread the product.

Two occupations can rank differently on the two forms, and that is real
information rather than noise. The shock form is nearer for an occupation
falling fast from a comfortable level; the level form is nearer for one that has
been ground down slowly. Report which form is nearer per row, because that is
the one that would open first.

## When it should refuse

- Fewer than two occupations survive the mapping in step 1. A ranking of one is
  a reading, and the buy recipe already covers that case.
- The payer holds less than 0.01 TUSD per surviving group plus 0.05 TUSD. Say
  what is needed and stop, rather than buying half the readings and ranking on
  a partial shortlist.
- Any group answers 503 after being listed with a `latest_period`.
- The mirror node check in step 7 disagrees with the feed on a value.
- The clock is replaying and the caller asked for the current position without
  qualification. Answer with the month, or refuse.

## How to tell it worked

- One settlement transaction id per paid call: one per ranked occupation and one
  for the quote. Each of them resolves on HashScan and each of them appears on
  the payments topic `0.0.10366471`.
- The top row of the ranking has the smallest `headline.distance` of the set,
  and recomputing the margins from `ebar`, `odi`, `level_line` and
  `attachment_shock` in the same rows gives the same order.
- The quote names the group at the top of the ranking, and its `series_id`
  matches the `series_id` the catalogue listed for that group.
- The period on every row is the same, or the report says which rows are from an
  older month and why.
