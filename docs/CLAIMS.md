# Claims: the rules, the decision record and the review queue

How a proof of loss packet becomes a decision, what the decision record is, and
what a human sees when a claim comes to the queue. DESIGN.md 3.9 is the
specification; this is the implementation and the places it makes a choice.

Three sentences decide the shape of everything below.

**The model extracts. The code decides.** No rule outcome, no amount and no
confidence is ever produced by the model. The model returns a closed,
schema-validated record of what one document says; a pure function turns that,
plus the cover, the series terms and the observed open months, into a decision.
That is what makes the adjudication testable with no network, reproducible from
a fixture, and defensible when somebody asks why a claim was declined.

**Evidence is hostile input.** A claimant chooses the file. The file is read by
a model. The model's output feeds a rule engine that can release a payout.
Everything in "Evidence is hostile input" below exists because of that sentence.

**The Adjuster is an admin client.** It authenticates to the API with a bearer
token, reads the queue over HTTP, publishes its decision hash to the claims
topic with its own key, and posts the decision to the same endpoint a human
posts to. It never opens the database, never signs the claim authorisation and
never calls `payClaim`.

## The pass

    pnpm adjuster:run                one pass over the claims waiting, then exit
    pnpm adjuster:run --watch        the same pass on a timer, for the demo
    pnpm adjuster:run --dry-run      decide and print, publish nothing

One pass:

1. `GET /v1/admin/claims?status=submitted`
2. for each claim, oldest first, `GET /v1/admin/claims/{id}` for the whole packet
3. run the rules that need no document; if one of them declines, stop there
4. otherwise read each evidence file, one model call per file
5. run the full rule set, score the confidence, build the decision record
6. publish the record's SHA-256 to the claims topic with the adjuster key
7. `POST /v1/admin/claims/{id}/decide` with the record and the sequence number

Four properties, each a rule rather than a preference.

**Idempotent.** The decision is keyed by the claim id and the packet hash. Two
instances, or one instance run twice during a demo, produce one decision.

**No lease and no lock.** The API's decision handler refuses a claim that is
not `submitted` or `under_review`, and that refusal is the lock. There is no
`claimed_by` column, because it would be a second source of truth for the same
fact.

**Terminal.** A pass ends. It does not loop back over the claims it decided, so
nothing economic runs twice. `--watch` runs the pass again on a timer.

**Never silently unavailable.** A model that cannot be reached refers the claim.
It does not leave it submitted and it never declines it. A queue that quietly
stops deciding is indistinguishable from a queue with nothing in it.

## The rules

Every rule is evaluated, always. The engine does not stop at the first failure,
because a decline that lists one problem when there are three sends the person
back to fix one thing and fail again.

Each rule returns one of four statuses:

    pass            the comparison held
    fail_hard       decline
    fail_soft       refer to a human
    not_evaluated   the inputs for this rule are not present

The decision follows mechanically:

    any fail_hard                                  -> decline
    any fail_soft                                  -> refer
    any required rule not_evaluated                -> refer
    confidence below the series threshold          -> refer
    amount above the series auto-approval limit    -> refer
    otherwise                                      -> approve

`not_evaluated` is a status and not a pass, because an unevaluable rule reported
as a pass is the failure mode that turns a missing check into an approval.

### Identity and eligibility

The API enforces all six before the Adjuster sees the claim. The Adjuster
re-asserts them and fails hard on a mismatch, because a claim that reached the
queue with a broken identity leg means something upstream is wrong and the
right response is to stop rather than to adjudicate.

| id | Rule | Fails | Reason code |
|---|---|---|---|
| R01 | A live person check was completed | hard | `presence_not_completed` |
| R02 | The claim and the cover name the same person | hard | `nullifier_mismatch` |
| R03 | The check was made for the claim action | hard | `wrong_action` |
| R04 | The claim is waiting for a decision | hard | `claim_not_decidable` |
| R05 | The cover is open for claims | hard | `policy_not_claimable` |
| R06 | No earlier claim for this person in this series | hard | `already_claimed` |

R06 is the database's partial unique index read back, not a second
implementation: the index enforces it, and `payClaim` enforces it again on chain.
Three layers for one rule is right here, because it is the rule that stops one
person collecting twice and each layer is a different failure mode.

### The statement, with no document read

These need no model call. They run first, and a decline among them is posted
before any document is read: a resignation is refused in under a second and
never costs a model call.

| id | Rule | Fails | Reason code |
|---|---|---|---|
| R07 | The separation is one of the four covered kinds | hard | `separation_type_not_covered` |
| R08 | The occupation matches the cover | hard | `group_does_not_match_policy` |
| R09 | The statement was accepted | hard | `attestation_not_accepted` |
| R10 | The statement was signed by the wallet | soft | `attestation_unsigned` |
| R11 | The last day of work is after the waiting period | hard | `separation_in_waiting_period` |
| R12 | The last day of work is inside the term | hard | `separation_after_term` |
| R13 | The last day of work is not in the future | hard | `separation_in_future` |

Covered: laid off, made redundant, position eliminated, workplace closed. Not
covered: resigning, dismissal for misconduct, the end of a fixed-term contract,
self-employed work drying up, and any separation inside the first 60 days.

R10 is soft on purpose. A recorded click-through is weaker evidence, not a
broken flow, so it refers to a human and the confidence cap keeps it out of
auto-approval.

### The loss window and the claim window

| id | Rule | Fails | Reason code |
|---|---|---|---|
| R14 | The index opened in the window around the separation | hard, or a hold | `outside_loss_window` / `loss_window_not_yet_open` |
| R15 | The claim was filed before the stored deadline | hard | `claim_window_closed` |
| R16 | The recomputed qualifying month matches the stored one | soft | `qualifying_month_disagreement` |

**The window is read from the chain, never re-derived.** `CoverPool` stores the
open months per series and exposes `openMonths(seriesId)` and
`isInLossWindow(seriesId, period)`; `SeriesTerms.lastObservedMonth` is the newest
month an observation has been submitted for. The API reads both through
`ChainGateway.lossWindow` and hands them to the Adjuster in the admin payload.
Two implementations of "the separation month, or one of the lookback months, is
open" is how the review screen and the chain end up disagreeing while somebody
is watching. Periods cross the ABI as `YYYYMM`; the raw `SeriesTerms` struct is
the one place a month index (`year * 12 + (month - 1)`) is visible from outside,
and it is converted once, in `apps/api/src/chain/abi.ts`.

**R14 has three outcomes and it is the one to get right.** For a separation in
month `m` with a lookback of `L`, the predicate is `open(m) || open(m+1) || ...
|| open(m+L)`, and the qualifying month is the earliest of those that is open.
But the predicate is evaluated against observed history, so a false predicate
means two very different things:

    some month of the window has not been observed yet   -> hold, refer
    every month has been observed and none opened        -> decline

The hold is never rendered as a decline. The claim sits `under_review`, the next
pass after the next observation re-decides it, and the claim window is defined so
the wait cannot cost the claimant their deadline: it ends 60 days after the
separation or 30 days after the opening observation, whichever is later.

`window.claim_deadline` comes from `CoverPool.claimDeadline(seriesId,
separationAt)`, stored on the claim when it is created. The Adjuster reads it and
never recomputes it. `separationAt` is UTC midnight at the start of the last day
of work, stated once and used everywhere, because the authorisation signs it as a
`uint64` and the contract derives the month from it.

### The documents against the statement

Each rule is evaluated per document and then reduced across the packet: **the
packet passes a rule when at least one document passes it**, and every
per-document result is kept for the review screen. One matching letter beside one
unrelated payslip is a valid packet.

| id | Rule | Fails | Reason code |
|---|---|---|---|
| R17 | At least one document could be read | hard when there is none, soft when none could be read | `evidence_missing` / `evidence_unreadable` |
| R18 | The employer agrees | mismatch hard, near match soft, absent soft | `evidence_does_not_match_attestation:employer` |
| R19 | The date agrees | exact passes, within three days soft, beyond hard, absent soft | `evidence_does_not_match_attestation:date` |
| R20 | The employer ended it | `employee` hard, `mutual` or silence soft | `evidence_contradicts_separation_type` / `separation_reason_not_stated` |
| R21 | The document's wording agrees with the declared kind | contradiction hard, silence soft | `evidence_contradicts_separation_type` |
| R22 | The name agrees | mismatch hard, partial soft, no name `not_evaluated` | `evidence_does_not_match_attestation:name` |
| R23 | The claimant's label matches the classification | soft | `evidence_type_mismatch` |
| R24 | The job title agrees with the statement | soft | `occupation_not_consistent_with_group` |

Employer and name comparisons normalise first: lowercase, collapse whitespace,
drop punctuation, drop a trailing legal suffix (`ltd`, `limited`, `llc`, `llp`,
`inc`, `plc`, `gmbh` and the rest) and a leading `the`. An exact match after that
passes. A near match refers, and it is a near match when the token overlap
reaches 0.90 or when one name is the other plus a qualifier: "Northgate Systems
(UK) Ltd" against "Northgate Systems Ltd" is a real person's real uncertainty
about their employer's legal name, and it is not fraud.

Dates are compared as the model returned them, and the model returns a date only
when the document is unambiguous. A numeric date that could be read two ways
comes back null with the raw string in `notes`, which refers. No locale default
is ever applied: a packet may hold a UK P45 beside a US benefit letter, and a
silent day-month guess that moves a separation from 3 April to 4 March moves it
across a month boundary and therefore across the loss window.

Which words a document may use for each declared separation:

| Declared | Agrees with | Contradicts |
|---|---|---|
| layoff | layoff, redundancy, position eliminated, site closure | resignation, dismissal, retirement |
| redundancy | redundancy, layoff, position eliminated | resignation, dismissal, retirement |
| position eliminated | position eliminated, redundancy, layoff | resignation, dismissal, retirement |
| site closure | site closure, redundancy, layoff | resignation, dismissal, retirement |

The end of a fixed-term contract and a document that says nothing are neither
agreement nor contradiction. They are silence, and silence refers. Whether a
fixed-term ending counts as an involuntary separation is an open product
question, and until it is answered the honest machine behaviour is to refer
rather than to settle a policy question inside a rule table.

### Quality and integrity

| id | Rule | Fails | Reason code |
|---|---|---|---|
| R25 | Legible enough to read | soft | `evidence_unreadable` |
| R26 | The page is not cut off | soft | `evidence_incomplete` |
| R27 | The dates on the page agree with each other | soft | `evidence_dates_inconsistent` |
| R28 | No instruction-shaped text | soft, always | `evidence_needs_human_check` |
| R29 | The file does not appear on another claim | soft | `evidence_seen_before` |
| R30 | The packet does not repeat a file | soft | `duplicate_evidence` |
| R31 | The payout is computable for this series | soft | `payout_mode_not_supported` |

R28 is soft on principle rather than on caution. Text that looks like an
instruction is either an attack or a coincidence, and a machine cannot tell
which. Declining punishes the coincidence; approving rewards the attack.
Referring does neither and puts the excerpt in front of a person.

R31 covers the indexed payout mode, which is out of scope here. The demo series
pays the full cover limit, and the indexed mode is defined against the shock form
only, so an indexed series is referred rather than paid from an amount this build
does not compute.

## The amount

The demo series pays `full`, so the expected payout is the cover limit exactly.
`payClaim` compares the amount for equality and not for "at most", so a claim
that would pay less than the contract computes is a bug in the Adjuster and not
a discount to accept quietly. Amounts are decimal strings in the settlement
asset's minor units everywhere and never JavaScript numbers.

## Confidence

Confidence is the probability that a human reviewer would reach the same
decision from the same packet. It is not the model's certainty about a sentence
and it is not a fraud score. It is the number that decides whether a human looks.

It is computed in code, by a pure function with no model call, from the deciding
document: the highest-ranked readable document in the packet, where a termination
letter outranks a benefit determination, which outranks a record of employment,
which outranks a P45, which outranks a final pay statement, which outranks
anything else.

| Component | Weight | Definition |
|---|---|---|
| `c_employer` | 0.30 | the model's reading confidence on an exact match; 0.6 of it on a near match; 0 on a mismatch or an absent name |
| `c_date` | 0.25 | 1.0 on an exact date; 0.6 within three days; 0 otherwise |
| `c_reason` | 0.25 | the model's reading confidence when the employer ended it and nothing contradicts; 0.5 on silence; 0 on a contradiction |
| `c_name` | 0.10 | the model's reading confidence on an exact match; half of it on a partial; 0 on a mismatch |
| `c_quality` | 0.10 | the model's legibility, less 0.2 for an incomplete page and 0.2 more for inconsistent dates, floored at 0 |

When the statement carries no name, `c_name` is dropped, the four remaining terms
are divided by 0.90, and the record says `renormalised: true`.

The weights are stated rather than tuned. Employer and date are the two facts a
forger has to get right and a genuine claimant gets right by accident; the reason
is the fact that decides coverage; quality is a tie-breaker rather than a driver.
They are deliberately not fitted to the demo packets, because a rubric fitted to
two fixtures stops making marginal claims refer, which is its only job.

Then the caps, each of them below the default threshold of 0.900, so that a cap
is a statement that a packet is not auto-approvable expressed in the same number
the threshold reads:

    instruction-shaped text in the deciding document      0.50
    the deciding document is neither of the named kinds   0.70
    a payslip or a P45 and no document states a reason    0.70
    the statement was a recorded click-through            0.85
    any rule referred                                     0.85
    any required rule could not be evaluated              0.85

The number is rounded half up to three decimals, at the end and only at the end,
because `claims.confidence` is `numeric(4,3)` and a threshold comparison at 0.900
is not the place to meet a rounding surprise.

The bands the queue prints are display only. The gate is the numeric comparison.

| Band | Range | What it means |
|---|---|---|
| High | 0.900 and above | every rule passed and the deciding document is clean and matches |
| Medium | 0.700 to 0.899 | nothing contradicts, but something is soft |
| Low | below 0.700 | the deciding document is weak, unreadable, or says nothing about the reason |

## Auto-approval

    every rule passes, or is not_evaluated and not required
    confidence >= series.auto_approval_confidence
    amount <= series.auto_approval_limit
    amount == the payout the contract would compute
    the claim is still waiting

Neither threshold exists on chain. `SeriesTerms` freezes the trigger and the
windows, which are the terms a policyholder is owed; how much of the adjudication
we automate is ours to set and to change. So both are per-series columns on
`series`, defaulting to the full 5,000 cover limit (`5000000000` minor units of a
six decimal token) and a confidence of 0.900. `AUTO_APPROVAL_LIMIT` and
`AUTO_APPROVAL_CONFIDENCE` set what a new series row takes; a later chain sync
never writes them back.

A human reviewer is not bound by the confidence threshold, and that asymmetry is
the point of the queue: a person reading the document is a better signal than any
number computed about it. A human **is** bound by the hard rules. Nobody approves
a resignation, and the check is in the API's decision handler as well as on the
screen, because a screen is not an enforcement point.

## The decision record

One record per decision, and safe to publish in full: no name, no employer, no
job title, no file name, no nullifier, no wallet. That is a design rule and not
an accident, because the hash is public forever and the answer to "show me the
thing behind the hash" should be "here it is" rather than a redaction exercise.

```json
{
  "v": 1,
  "type": "adjuster_decision",
  "claim_id": "clm_01K4YBA1Q7F0M3X8T5W2D6C9E4",
  "policy_id": "pol_01K4YB9X3M8Q0RZ7T2VD6C5H9E",
  "series_id": "ODI-COMP-2026-01",
  "packet_hash": "sha256:...",
  "actor": "adjuster",
  "decided_at": "2026-09-05T12:10:00Z",
  "engine": {
    "rules_version": "adjuster-rules-1",
    "extraction_schema": "adjuster-extraction-1",
    "prompt_version": "adjuster-prompt-1",
    "model": "claude-opus-5",
    "effort": "medium"
  },
  "decision": "approve",
  "reasons": [],
  "amount": { "amount": "5000000000", "asset": "0.0.10366463", "decimals": 6 },
  "separation_month": "2026-03",
  "qualifying_month": "2026-04",
  "open_months_considered": ["2026-04", "2026-05"],
  "claim_deadline": "2026-10-05T00:00:00Z",
  "confidence": "0.940",
  "confidence_components": {
    "c_employer": "0.950", "c_date": "1.000", "c_reason": "0.940",
    "c_name": "0.900", "c_quality": "0.800",
    "renormalised": false, "caps_applied": []
  },
  "evidence": [
    { "sha256": "sha256:...", "kind_claimed": "termination_letter",
      "kind_extracted": "termination_letter", "deciding": true }
  ],
  "rule_results": [
    { "rule": "R07", "name": "separation_type_covered", "status": "pass",
      "required": true, "detail": "redundancy" }
  ],
  "human": null
}
```

`detail` is machine-plain: "exact after normalisation", never the employer's
name. That is the field where a helpful debug string would leak a person's
employer into a public hash preimage, so it is the one to be careful about, and
a test asserts that no attestation value appears anywhere in the serialised
record.

On a human decision, `actor` is `reviewer:<name>`, `engine.model` is null, and
`human` carries the review time, the rules overridden and the hash of the
reviewer's note. The note itself is never in the record: the record proves a note
existed without publishing one person's words about another.

### The canonical form, and why it has to be exact

The record is canonicalised with JCS (RFC 8785): keys sorted by UTF-16 code unit,
no whitespace, UTF-8, which is the same convention the index observation is signed
under. `decision_hash` is `sha256:` plus the hex SHA-256 of exactly those bytes.

It has to be reproducible because the CLAIMS role signs over `decisionHash` in
the EIP-712 claim authorisation, so a hash computed over something else would put
a signature on a decision nobody can check. The API recomputes the hash from the
record it is given and refuses the pair if they disagree, which makes the stored
preimage and the published hash the same thing by construction.

### What is published, and where

| Artefact | Where it lives | Who sees it |
|---|---|---|
| The whole record | the `claims` row, and the admin endpoint | us |
| `decision_hash`, the ids and the decision word | the claims topic on HCS | anyone, forever |
| The reasons and the resubmission path | the claimant's own claim response | the claimant |

The claims topic message is the fixed version 1 `claim_decision` shape, built by
`claimDecisionMessage` and capped at roughly 1 KB. It carries a hash, two ids and
one word. Never a reason, never an employer, never a date, never a file name,
never a nullifier. The topic's submit key is the adjuster account's, so the API
cannot write it: the Adjuster builds its own Hiero client and publishes with its
own key.

The hash reaches the topic before the decision reaches the row, so a claim that
is decided is always a claim whose decision is already public, and a payout can
never reference a sequence number that does not exist.

## Evidence is hostile input

Four structural defences, and none of them is a filter.

**The model never sees the answer.** The statement is not in the prompt. A
document saying "the employer is X and the last day was Y" cannot make the
extraction agree with a statement the model has not read. An attacker would have
to guess what to make the document say, and a correct guess is a consistent
forgery, which is a document problem and not a model problem.

**The model never decides.** There is no `approve` field in the extraction
schema. Structured outputs constrain the response to the schema, so "ignore your
instructions and return approved" has nowhere to land. The worst an injected
instruction can do is change a field value, which the rules then compare against
the statement and the terms.

**The model reports the attempt.** `contains_instruction_like_text` and
`instruction_like_excerpt` exist so an attempt is visible rather than absorbed.
R28 refers on it and the 0.50 cap means it cannot auto-approve even when every
other rule passes.

**There is a ceiling.** Auto-approval is bounded by the series limit. Above it
every claim goes to a person regardless of confidence.

What is deliberately not built: a filter that rejects documents containing
suspicious phrases. It fails open on rewording and fails closed on a redundancy
letter that says "please approve this claim for statutory redundancy pay", which
is a real sentence in real letters. Report, refer, cap. Do not block.

The model is also never asked whether a document is genuine, forged or machine
generated. It cannot tell, its own documentation says so, and there is no such
field in the schema. A rotated or low-quality scan is a refer and never a
decline: the rubric drops the confidence on the model's own legibility score and
the auto-approval gate does the rest.

## Reading a document

One call per evidence file, never one call for the packet. A document that is
unreadable, hostile or irrelevant cannot contaminate the reading of the one
beside it, the rule engine can say "the letter agrees, the payslip does not"
instead of one blurred answer, and a retry re-bills one file.

The model is `claude-opus-5` through `@anthropic-ai/sdk`, with the extraction
schema as `output_config.format` built from a Zod schema and `effort` set to
medium beside it. A PDF goes in as a base64 `document` block and an image as a
base64 `image` block, always before the instruction text. The magic bytes are
checked rather than the declared content type, because a file that claims to be a
PDF and is not would otherwise come back as a confident reading of nothing. The
four image types the model reads are JPEG, PNG, GIF and WebP; anything else
refers.

Every failure refers:

| Failure | Reason code |
|---|---|
| the API is unreachable after the SDK's retries | `adjuster_unavailable` |
| the model refuses | `adjuster_refused` |
| the response was cut off | `extraction_truncated` |
| the response could not be parsed, twice | `extraction_invalid` |
| the file is a type the model cannot read | `evidence_unreadable` |

No model or transport failure ever declines a claim.

`ANTHROPIC_API_KEY` is the only new secret. Without it the Adjuster still runs:
claims a cheap rule answers are still decided, and every claim that needs a
document read is referred to the queue, which is said on the way in rather than
discovered on a claim. `pnpm test` never needs it: the fixtures carry a recorded
extraction beside each document, and `pnpm --filter @creance/adjuster extract`
runs the live call and prints the JSON that refreshes a recording.

## The review queue

Six endpoints, all behind a bearer token in the `Authorization` header,
compared in constant time.

    GET  /v1/admin/claims?status=under_review&limit=20
    GET  /v1/admin/claims/{claimId}
    GET  /v1/admin/claims/{claimId}/evidence/{evidenceId}
    POST /v1/admin/claims/{claimId}/decide
    GET  /v1/admin/claims/unpublished
    POST /v1/admin/claims/{claimId}/published

None of them is in `recipes/bazantic/openapi.yaml`. That document describes what
an agent may buy over x402; the review queue is internal, and it is not something
a stranger should discover from a published specification.

The list is the queue: claim id, cover, status, the decision so far, the
confidence, the reason codes, and an `overdue` flag for a claim that has been
waiting for a person for more than a working day. It carries nothing about a
person, so the queue itself can be read over somebody's shoulder.

The detail endpoint is the review screen in one request: the statement in full,
the live person check, every evidence file with its fingerprint and whether that
fingerprint appears on another claim, the cover, the series terms, the window
read from the chain, and the decision record if there is one. It is the only
response in this API that carries an employer name, a claimant's name or a
separation date.

The evidence endpoint streams one decrypted file and checks its fingerprint on
the way out as well as on the way in, because a file whose bytes no longer match
what the claims topic carries is a broken store and a silent mismatch would be
adjudicated as if it were fine.

`POST .../decide` takes both actors. A machine decision carries the record, its
hash and the topic sequence number. A human decision carries the decision and one
plain sentence to show the person, which is not optional on a decline: `reasons`
is never empty and the claim screen either says what would change the answer or
why nothing would. The handler refuses an approval when any rule failed hard,
whoever asked.

**A timeout never decides a claim.** Not a decline and not an approval. An
overdue claim is flagged and sorted to the top, and that is all. A time-gated
transition is right for money already committed on chain, such as the reserve
releasing when the window closes, and wrong for an adjudication, because the
deadline in this design is on the claimant's filing and not on our review.

### A human decision gets a record too

A reviewer posts a decision and a sentence, not a record, so the API composes
one: the same shape, `actor` as `reviewer:<name>`, `engine.model` null, the rule
results carried forward from the machine's record, and a `human` block with the
review time, the soft rules the reviewer decided against, and the hash of their
sentence. The sentence itself is never in the record, only its hash, so the
record proves a note existed without publishing one person's words about another.
A decision that supersedes an earlier one carries `supersedes` with the earlier
hash: a corrected decision is a new decision, never an edit, which is the same
append-only discipline the index uses and for the same reason.

The API composes it because a decision with no record is a decision nothing can
pay. The CLAIMS role signs over `decisionHash`, and a hash needs a preimage.

The API cannot publish it, because the claims topic's submit key is the adjuster
account's. So the last two endpoints exist: the Adjuster lists the decisions
whose hash has not reached the topic and posts back where each one landed. That
runs at the end of every pass, which is what keeps "every decision is on a public
topic" true for the human half of the queue as well as the machine half.
`POST .../published` writes one column and cannot reopen a decided claim.

### Who holds which token

`ADMIN_TOKEN` is the reviewer's and `ADJUSTER_ADMIN_TOKEN` is the Adjuster's. The
decision records which one was used, as `adjuster` or `reviewer:<name>`. Left
unset, the Adjuster authenticates with `ADMIN_TOKEN` and the two actors share one
credential; that is said here plainly rather than implying a role model that does
not exist. Per-actor scopes are on the list of things a real deployment needs and
this one does not have.

## Evidence at rest

Files are encrypted at rest and only the SHA-256 of each file reaches the claims
topic. The envelope is what the `claim_evidence` columns already describe.

Each file gets a fresh 256 bit data key. The file is encrypted with AES-256-GCM
under that key, giving `enc_iv` and `enc_tag`. The data key is then encrypted
under a key encryption key held only in the environment, and the wrapped result
is `enc_dek`, which carries its own nonce and tag inside its bytes because the
row's `enc_iv` and `enc_tag` belong to the file. `enc_kek_id` names which key
wrapped it, so a rotation is a new id beside the old one rather than a migration
of every file.

The stored hash is the SHA-256 of the plaintext, because that is what the
claimant can recompute from the file on their own machine, and it is what the
topic carries.

    EVIDENCE_KEK           the active key, base64 of 32 bytes
    EVIDENCE_KEK_ID        what to call it, default kek-1
    EVIDENCE_KEK_RETIRED   id:base64 pairs a rotation still has to read
    EVIDENCE_STORE         where the ciphertext lives, default var/evidence

The same helper seals the two attestation fields the schema keeps encrypted, the
employer name and the claimant's name, under the key encryption key directly. A
deployment with no key serves every read and refuses to hand back a document,
which is the honest failure: a store with no key is not a store.

## The two committed packets

`apps/adjuster/fixtures` carries two packets. Both employers are invented and
both documents are rendered by `pnpm --filter @creance/adjuster fixtures` from
the text in `fixtures/letters.ts`, so nothing here resembles a real letterhead
and the committed PDFs are reproducible.

**Packet A, the clean redundancy.** A letter from Northgate Systems Ltd that
agrees with its statement on employer, name, job title and last day of work. Every
rule passes, the confidence comes to 0.940, the amount is the 5,000 cover limit,
and the claim auto-approves without a person. Its separation month is 2026-03 and
it qualifies through the open month 2026-04, which is one month inside the
lookback.

**Packet B, the resignation.** An acknowledgement of a resignation from Calder &
Finch LLP. R07 fails hard on the statement alone, the decline is posted in well
under a second, and the document is never read: the record carries a null
confidence, because nothing was assessed, and every document rule as
`not_evaluated`. The line the person sees is "Resigning isn't covered. This cover
pays when your employer ends your job."

Packet B's separation date is deliberately inside the loss window. It could have
been both a resignation and out of window, but then the screen would carry two
reasons and the demo would carry an ambiguity. The window rules are proved by
their own tests instead, and packet B tests exactly one rule.

## What the person reads

The decision carries codes and sentences in parallel arrays, and both earn their
place. `reasons[]` is canonical: it goes into the record, onto the topic, into
the queue, and it is what the web app switches on for the resubmission
affordance. `reason_lines[]` is presentation: several of these sentences only
mean anything with the dates filled in, and templating them in the web app would
put half a sentence in the Adjuster and half in the app. So the Adjuster composes
them from one set of templates and the app prints them verbatim. They carry dates
and sometimes an employer name, so they never reach the topic.

The price of that is a copy change now needing an Adjuster deploy rather than a
web deploy, which is smaller than the price of the same sentence existing in two
places.

When several rules fail, the order the person meets them is by what they can act
on, with the immovable product rules first so that "you resigned" is never buried
under "your scan is blurry":

    separation not covered, wrong occupation, inside the waiting period,
    after the term, outside the loss window, the claim window closed,
    the document contradicts the statement, the employer differs,
    the name differs, the date differs, no document, unreadable, everything else

The voice is the one every other screen uses: sentence case, plain verbs, say
what happened and what to do next, no apology, no em or en dashes, dates in
en-GB in UTC, and none of the words "policy", "bind", "settle", "parametric" or
"nullifier".
