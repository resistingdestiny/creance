# Should my principal renew

A recipe for an agent that has to answer one question with numbers rather than
an opinion: is my principal's occupation getting worse, and is the cover still
worth paying for. It reads the published history off the Hedera Consensus
Service through the mirror node, reads the same window again from the paid
Creance feed, cites a sequence number for every month it reports, and ends in a
recommendation.

## When to run it

In the last month of a twelve month policy, which is the annual renewal window
the buy rule recognises, or any time the person asks whether their cover is
still worth the premium.

## Why it exists

A renewal decision needs the direction of the index, not its level. A single
reading says almost nothing: the index is a three month smoothed excess and it
moves slowly, and its trigger lines are frozen at issuance and never move at
all. This recipe answers "is my occupation getting worse" from the published
record, and says what the answer means for the money.

It also puts a number a person can check against a number a seller published. A
recommendation to keep paying a premium should be traceable to messages on a
public topic, and every period in this report is.

## Services it uses

The same two as the buy recipe, in the same order and for the same reason.

1. **Hedera mirror node REST API**, testnet, the sponsor service, on topic
   `0.0.10366470`. It supplies the settled record: the months, their values,
   their sequence numbers and the frozen `attachment_shock` and `level_line`
   each observation was published with.
2. **The Creance gateway**. The paid index feed supplies up to twenty four
   months of history and the current trigger status in one call; the free series
   read supplies the capacity, the term and the coupon behind the cover.

The result depends on both. The report cites a topic sequence number for every
period, so a reader can fetch any line of it independently, and the recipe
refuses to recommend anything if the two sources disagree on a period they both
carry.

## What it needs to start

The principal's policy id, or their occupation group and series id. Nothing
else. No credential is needed: this recipe reads, it does not bind.

Funding for one paid read, 0.01 TUSD.

## Steps

**1. Read the group's published history off the index topic.**

    GET https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.10366470/messages
        ?limit=100&order=desc

Decode each `message` from base64, parse the JSON, and keep the ones whose
`group` is the principal's. One topic carries all fifteen groups, so a page of
100 messages holds roughly six months of one group once every group is
publishing monthly. Follow `links.next` until the group has enough months, or
page backwards with `sequencenumber=lt:{n}`, which the mirror node supports on
this collection.

Order the group's messages by `period` and not by sequence number. They are not
the same order: a backfill publishes months as it computes them, and on 5
September 2026 sequence 27 carried `computer_math` `2026-07` while sequence 33,
published later, carried `computer_math` `2026-06`.

Note what is missing and what is not settled, rather than dropping it. A month
with `status` `no_source` was never published by the source, a month with
`insufficient_history` had fewer than the twelve prior months the year on year
difference needs, and both carry nulls. In the published `computer_math`
history, `2025-10` is `no_source` and `2025-11` and `2025-12` are
`insufficient_history`. A hole is information: it is why a twelve month trend
may not be computable even though twelve messages exist.

**2. Read the paid feed for the same group.**

    GET https://creance.co/v1/index/{group}

0.01 TUSD, `10000` in the smallest unit of TUSD `0.0.10366463`. It answers the
latest reading, `trigger` with the frozen `attachment_shock` and `level_line`
and how far the current reading sits from each, `headline` with whichever form
is nearer its line, and `history`, up to twenty four months oldest first.

**3. Compare the two, on the overlap only.**

The feed's history reaches further back than the topic does, because the
observations were computed from the committed source archive and published to
the topic afterwards. So the check is over the periods both carry, and a period
the feed has and the topic does not is not a disagreement, it is a month that
has not been published yet. Say which months were checked.

Compare `ebar` and `odi` numerically: the topic carries JSON numbers, the feed
carries decimal strings. Treat `open_reason` `"none"` on the topic and `null` on
the feed as the same answer, which is claims closed.

Stop and report if any overlapping period disagrees. A recommendation built on a
number that two sources give differently is worth nothing.

**4. Read the series, for what the index does not say.**

    GET https://creance.co/v1/series/{seriesId}

Free. It gives the capacity behind the cover, the term, the coupon rate and the
principal still free to sell against, which is what says whether cover can be
bought again at all.

It does not carry the frozen `attachment_shock` and `level_line`. Those live on
the index: `trigger` on the paid feed, and the same two fields on every
observation on the topic. Take them from there, and if the two ever differ,
that is a disagreement worth stopping on, because the number on the topic is the
one the contract compares against.

**5. Report four things, with the numbers in them.**

- The current `ebar` and how far it sits below or above `level_line`.
- The current `odi` and how far below `attachment_shock`.
- The direction over three, six and twelve months, each computed only across
  consecutive published months. Say "not computable" for a horizon that spans a
  hole, rather than interpolating one.
- How many months in the window were open, and on which form.

Cite the topic sequence number beside every period.

**6. Recommend, in one sentence, with the numbers in it.**

Renew when the three month `odi` trend is strictly rising, which is the same
rule the buy recipe uses, or when the reading sits within a small margin of
either line. Do not renew when the trend is falling and both margins are wide.
Say which of the two forms is nearer, because that is the one that will open
first.

If the recommendation is renew, hand off to
[buy-displacement-cover.md](buy-displacement-cover.md) with the same limit as
the expiring policy.

## What comes back

A short report: the current reading against both trigger forms, the trend over
three horizons, the open months in the window, the frozen parameters, the topic
sequence numbers behind every line, and one sentence of recommendation.

## What the result means

A level line can be negative, and that is the reading most often got wrong. For
an occupation with structurally low unemployment the trigger is deterioration
measured against its own history, not high unemployment in absolute terms. On
the live topic on 5 September 2026, `computer_math` at `2026-07` read `ebar`
-1.37 against a level line of -0.68 and `odi` -0.07 against a shock attachment
of 2.0: claims closed, and the level form is the nearer of the two at 0.69
percentage points away. A reading of -0.60 against the same line would be close
to opening even though the number is negative and looks benign. Say that in the
report or the number misleads.

Rising means the occupation is losing ground against all occupations faster than
it was three months ago. Flat means the premium is buying protection against a
risk that is not currently moving, which is a reasonable thing to buy and a
reasonable thing to decline. Falling means the occupation is recovering relative
to the rest of the labour market, and the honest answer may be not to renew.

None of this predicts a payout. The index opens claims; the person still has to
lose their job and prove it. What the trend changes is the probability that the
first key turns at all.

## When it should refuse

- Fewer than fifteen months of settled observations for the group on the topic.
  A twelve month trend cannot be computed from fewer, and today only
  `computer_math` has more than one month published, so every other group
  refuses here and should say so plainly rather than reporting a trend of one
  point.
- Any overlapping period where the topic and the paid feed disagree on `ebar`,
  `odi`, `attachment_shock` or `level_line`.
- 503 `index_unavailable` from the feed: nothing has been published for that
  occupation.
- A missing month inside a horizon: refuse that horizon, not the whole report.

## How to tell it worked

- Every period in the report exists as a message on topic `0.0.10366470` at the
  sequence number the report cites, and
  `GET /api/v1/topics/0.0.10366470/messages/{sequenceNumber}` on the mirror node
  returns it.
- The frozen parameters in the report match the ones on those messages and the
  ones the paid feed returned under `trigger`.
- The recommendation names the three periods and the three `odi` values behind
  it, so the reader can redo the comparison without the agent.
