# The demonstration

What has to be true before a camera is switched on, the nine shots the
submission video is cut from, the procedure for recording them, and the separate
Bazantic screen recording. The sequence itself is committed as data in
`apps/api/scripts/testnet/demo-seed/scenario.ts` and printed by `pnpm demo:seed
scenario`, so the table below and the code cannot drift apart without a test
failing.

Everything in the video runs against Hedera testnet. Nothing in it runs against
a mock, a fixture or a scenario file. The web app can render Home from fixtures
behind `WEB_DEMO_STATES`, which is useful for checking that a shot is framed
correctly and is never used in a take: it prints a label saying nothing came
from the API, and a demonstration that needs that label is not a demonstration.

## The artefacts

| Artefact | Length | Where it goes |
|---|---|---|
| The submission video | 2:00 to 4:00, cut to 3:50 | The ETHGlobal submission form. The only mandatory one. |
| The showcase cut | 3:38 | The same take with the harness beat dropped. Linked from the README. |
| The Bazantic screen recording | about 2:00 | The Bazantic prize field and docs/SUBMISSION.md. |
| The harness clip | 30 to 60 seconds | The harness pull request and the Hedera prize field. |

ETHGlobal rejects a video outside two to four minutes before a judge sees it, so
3:50 is the target and the floor matters as much as the ceiling. Recording at
1080p and exporting at 1080p clears the 720p minimum. Cutting the waiting out of
a take is allowed. Speeding footage up is not, and no shot below needs it.

## Before you press record

Run `pnpm demo:seed` and then walk this list. Every line on it has silently
broken a take somewhere.

    [ ] pnpm api:migrate has run against the database this take will use
    [ ] pnpm demo:seed has run to the end and its id block is saved
    [ ] pnpm demo:seed status prints "202605 is unspent"
    [ ] the two policies it printed are active and carry no claim yet
    [ ] the reserve is at least one cover limit, or shot 5 runs before shot 6
    [ ] both letters fingerprint to the hashes the seed printed
    [ ] pnpm oracle:preflight shows the oracle with HBAR to spend
    [ ] the api account holds more than about 5 HBAR, or payClaim refuses
    [ ] the fourth wallet that buys live on camera is funded and associated
    [ ] the Android phone has World ID (Sandbox) signed in, and the sandbox
        account has not yet used the eligibility action for this occupation
    [ ] scrcpy mirrors the phone at a readable size and the phone stays awake
    [ ] HashScan tabs pre opened: CoverPool, CollateralVault, the note, the
        index topic, the claims topic. Never type a HashScan URL on camera.
    [ ] a scratch tab holds the seed's id block, so no id is typed from memory
    [ ] the replay has not been started
    [ ] one full rehearsal has been done, timed, with the numbers written down

Two of these deserve their own sentence. The reserve is what a payout is paid
out of, and `pnpm demo:seed verify` refuses to finish if the reserve is under one
cover limit and the month that would top it up has already been spent. And the
Adjuster only reads a document when `ANTHROPIC_API_KEY` is set; without it every
claim that needs a document read is referred to the review queue rather than
declined, so shot 6 goes through the reviewer's Approve button on `/admin/claims`
instead of finishing by itself. Both paths are real and both are worth showing;
decide which one the take uses before the take, not during it.

## The nine shots

| # | In | Out | Length | Shot | On camera |
|---|---|---|---|---|---|
| 1 | 0:00 | 0:18 | 18s | The problem and the structure | slide |
| 2 | 0:18 | 1:00 | 42s | The worker buys cover | browser, phone |
| 3 | 1:00 | 1:38 | 38s | The Steward buys for its principal | terminal |
| 4 | 1:38 | 2:12 | 34s | The investor and the note | browser, terminal |
| 5 | 2:12 | 2:44 | 32s | The replay opens a month and the vault reserves | browser, terminal |
| 6 | 2:44 | 3:14 | 30s | The claim that pays | browser, phone, terminal |
| 7 | 3:14 | 3:26 | 12s | The claim that does not pay | browser |
| 8 | 3:26 | 3:38 | 12s | The money closes the loop | browser, terminal |
| 9 | 3:38 | 3:50 | 12s | The harness improvement and the close | terminal, slide |

DESIGN.md section 7 gives the demo clock sixty seconds and the whole video three
hundred. The replay alone is longer than sixty seconds of real time, so shot 5
is recorded continuously and the dwell between ticks is cut in the edit. That is
removing waiting, which is allowed. The total moves from five minutes to 3:50
because ETHGlobal's own limit is four. The reasoning is in docs/DECISIONS.md.

### Shot 1, the problem and the structure

One static slide, four lines, no animation and no logo. Workers buy monthly
cover against their occupation being displaced. AI long investors fund the
payouts and earn the premiums. A public index says when claims open and a proof
of loss says who gets paid.

Do not explain Hedera, World or the index arithmetic here. Each of them arrives
later attached to something moving on screen, which is the only way any of it
lands in eighteen seconds.

### Shot 2, the worker buys cover

Browser at 1280 by 800 with the phone mirrored in the corner, full width only
for the Selfie Check. Run `pnpm dev` before the take and leave it running.

    click   /start, Get a quote
    click   /occupation, type "computer", pick Computer and mathematical
    hold    /amount, drag the slider once and put it back, so the premium
            recomputes on camera
    read    the sentence that says what the cover pays out on
    click   Continue, then /verify, Verify with World ID
    cut     to the phone, full width: World ID (Sandbox), the Selfie Check
    cut     back to the browser: You are verified
    click   /pay, then the pay button
    hold    the card sliding into /home and the amount counting up. This is
            the one animation in the product. Let it finish.
    hold    /home: the pill Covered, the next payment date, the reading

Name Selfie Check once out loud and say what it is for: one live person, one
cover, and the same person has to come back to claim it. Do not name the policy
NFT or the HCS receipt here. DESIGN.md section 7 puts them in this shot and the
copy deck forbids those words on this surface; they get their proof in shot 3
and shot 6, where a terminal is already on screen.

If the sandbox proof fails, retry once. If it fails twice, stop the take and use
the clean Selfie Check recorded separately as an inset. A second attempt on
camera reads as broken even when it is a network hiccup.

### Shot 3, the Steward buys for its principal

Full screen terminal, two panes, 16 to 18 point monospace, scrollback cleared.
The left pane runs the agent and the right tails the payments topic or holds a
HashScan tab.

    pnpm steward:run --as-of 2024-07 --cadence demo

The vantage month is a flag and not a fiction: the newest published reading is
falling, so the written rule correctly decides hold, and `--as-of` puts the
vantage on a rising month so the same rule decides buy. The journal entry
records `replay: true`, so nothing about it is hidden from a reader of the
topic. Say the flag out loud.

Five lines have to be legible, and they are the whole of the agentic payments
track: the 402 with the scheme, the network and the price; the payment being
built and signed; the 200 with the settlement transaction id; the written rule
firing; and the bind with its policy id, NFT serial and receipt sequence. Then,
without a cut, the premium schedule being created, one line per Scheduled
Transaction with its schedule id.

Say the sentence that stops the obvious objection: the agent never does the
selfie, it presents a credential the person earned.

### Shot 4, the investor and the note

The note was issued and both noteholders were KYC granted and minted long before
the take; `pnpm demo:seed` leaves all of it in place and changes none of it. What
is live on camera is the compliance pair and the coupon.

    show    /invest/ODI-COMP-2026-01: principal, coupon, term, capacity,
            principal at risk
    cut     to a terminal or HashScan: the note address and its compliance
            configuration
    run     a transfer to an account with no KYC. It fails compliance, and the
            failure is on screen in words.
    run     the KYC grant, then the same transfer. It succeeds.
    show    the coupon distribution on HashScan, executed by a Scheduled
            Transaction

Keep the failing transfer to about six seconds. The interesting thing is that it
failed, not the stack trace. The sentence that makes the two halves one product
is that the coupons are paid out of the premiums the workers in shots 2 and 3
are paying.

### Shot 5, the replay opens a month and the vault reserves

Start the replay before the shot begins and record continuously.

    pnpm oracle:preflight
    pnpm oracle:replay --from 2026-01 --to 2026-05

The index topic already carries 2025-01 to 2026-04 from the proof run of 5
September, and the oracle asks the topic what has settled, so those months tick
past on the replay bar without being published twice. May 2026 has never been
published and has never been submitted. It opens on the level form, the vault
reserves the exposed limits and the series stays in a claim window. That is a
real month of published data opening a real reserve, on camera, once.

    the sticky replay bar on /index advancing a month at a time, with computer
            and mathematical picked
    2026-05 publishing and opening, with the provenance block naming the topic
            and the sequence number
    the reserve rising, printed by the run and readable on /invest
    /home flipping to Claims open with the date a separation has to be on or
            after

Two things have to be said out loud or a judge will assume the worst. Replay is
on screen and in the voice: these are real months of history walked at one month
per ten seconds so that a year fits a video. And two months are open, April and
May 2026, so never say "the month claims opened".

Expect a second occupation group to light up on the index list. That is correct
behaviour and it is a good answer: the index runs for every bindable occupation,
not only the one the demonstration bought.

### Shot 6, the claim that pays

The cover is the one `pnpm demo:seed` bound on policyholder-1, claimable from
2026-01-30, and the packet is packet A, the redundancy letter from Northgate
Systems Ltd with a last day of work of 13 March 2026. Both the employer and the
letterhead are invented and the document is rendered from committed text, so any
fingerprint on the claims topic can be recomputed from this repository with
`sha256sum`.

    click   /home, Start a claim
    hold    C1, the plain words list of what is not covered
    fill    C2, pre filled from the seed. Typing it costs twenty seconds.
    click   C3, upload the letter, and hold on the hash being computed
    cut     to the phone: the second Selfie Check, action
            occupation-cover-claim, with user presence
    cut     back: C5, the attestation signed by the policy wallet
    click   Submit, and hold C6 for a few seconds only
    show    the decision arriving with its reasons
    cut     to the claims topic on HashScan: the packet hash and the
            decision hash
    cut     back to /home: Paid out
    show    payClaim on HashScan

The narration is the product in three clauses: the index said the occupation is
being displaced, this person shows they were actually made redundant, and the
same World ID that bought the cover came back to collect it.

Without `ANTHROPIC_API_KEY` the Adjuster refers rather than approves, and the
approval comes from the reviewer's screen at `/admin/claims`. Run `pnpm
adjuster:run` again afterwards so the reviewer's decision hash reaches the claims
topic. If the wait is longer than about eight seconds, cut it. Do not fill it
with narration about how fast it is.

### Shot 7, the claim that does not pay

A second browser profile, policyholder-3, packet B, the resignation
acknowledgement from Calder & Finch LLP. Submit it and hold on C9 with the
decline sentence as the Adjuster wrote it, and the resubmission path underneath.

One sentence of narration: a resignation is not a covered separation, the person
is told why in words they can act on, and the same reason is on the public
topic.

Twelve seconds, and not optional. A demonstration that only shows the happy path
invites "what stops anyone claiming", and answering that live costs more than
showing it.

### Shot 8, the money closes the loop

This shot has two halves because the demo series cannot close inside the event
and the video should say so rather than work around it.

    pnpm --filter @creance/api claims:close-windows --dry-run
    pnpm --filter @creance/contracts demo:release

The first refuses, and printing the refusal is the point: the claim window on
ODI-COMP-2026-01 runs to 5 October 2026, thirty days after the observation that
opened it, because a claimant must not be cut off by the lag between a month
ending and the statistics for it being published. The terms are frozen at
registration and there is no setter.

The second shows the release for real. It opens a series carrying every term the
demo series carries except that its claim window is measured in seconds, funds
it, binds cover, opens a month, pays a claim out of the reserve, waits for the
window and closes it. The `Released` event, the reserve going back to zero and
the principal ending up lower by exactly the claim that was paid are all on
testnet and all linked in docs/HEDERA.md. Say plainly that it is a second series
opened to compress the clock, in the same breath as the sentence about not
cutting a claimant off. Maturity is shown the same way, on the short dated series
`pnpm coupons:mature` opens.

Then show `/invest/ODI-COMP-2026-01` with principal at risk already down by the
claim that was paid in shot 6. That number is the paid claim subtracted from the
principal. It is not a fee and it is not a haircut.

### Shot 9, the harness improvement and the close

Ten seconds of the harness improvement running, then a two second end card with
the name, the network and the repository URL.

The last line of narration is the honesty line: the index does not attribute
cause, a shock that has nothing to do with AI opens claims too, and this is a
testnet prototype and not an offer of insurance.

## The showcase cut

DESIGN.md asks for a main video of five minutes or less and a separate showcase
cut of two to four minutes. ETHGlobal accepts only two to four minutes, so the
two collapse into one artefact and the showcase cut is the same take with shot 9
dropped, which lands at 3:38 and stays inside the gate. If it has to come down
further, cut in this order: shot 4's transfer pair down to the coupon alone,
then shot 3's premium schedule, then shot 1 down to ten seconds. That reaches
about 3:00 and still carries every prize critical beat. Below that the only shot
that can go is shot 7, the declined claim, and it costs more than the twelve
seconds it saves.

## Recording it

The mechanical rules reject a video before a judge sees it, so they come first.
Between 2:00 and 4:00. At least 720p. No recording of a screen with a phone
camera. A human voice, no text to speech. No speed changes.

Capture with OBS at 1920 by 1080 and 30 frames per second, recording to mkv and
remuxing to mp4 afterwards so a crash does not cost a take. Three scenes,
switched with hotkeys and never with the mouse. The browser is a dedicated
profile at 1280 by 800 with no bookmarks bar, no extensions and no notifications.
The terminal is 16 to 18 point monospace with the scrollback cleared before each
take. The phone is mirrored over USB with scrcpy and captured as a window
source, which is what satisfies the no phone camera rule: the pixels come from
the device rather than from a lens. Test the mirroring days before the take. An
identity app that sets `FLAG_SECURE` mirrors as a black rectangle, and finding
that out on the last evening leaves no plan.

Record the voice separately, to a second track, after the picture is cut.
Reading to a finished edit is the only reliable way to hit 3:50 without rushing.
Record thirty seconds of room tone first and use it for noise reduction. No music
under narration.

Rehearse the whole thing twice without recording and write down the elapsed time
at the end of each shot. Then record the shots in order but as separate takes,
one file per shot, so one fumble costs one shot. Redo a bad shot immediately
rather than planning to fix it in the edit. Keep a take log: shot number, take
number, good or bad, one word why. After any shot that produces a transaction,
paste the id into docs/SUBMISSION.md while it is on screen; reconstructing which
link belongs to which moment afterwards costs an hour.

Assemble the picture, cut the waiting, get to about 3:45 of picture, record the
voice to it, then trim to 3:50 with the voice in place. Export H.264 in mp4 at
1920 by 1080 and check the duration and the resolution in the file properties
before uploading rather than after.

Record these too, even though they are not in the cut, because each of them
saves a prize field or a README section later: one clean Selfie Check as an
insurance inset, the Bazantic recipe running start to finish, the harness
improvement as a standalone clip, and a slow scroll through the canonical index
page with the provenance and methodology blocks open.

## The Bazantic recording

A separate screen recording of about two minutes, showing one completed task
from start to finish. The two recipe texts are committed under `recipes/bazantic`
and are read from there rather than retyped.

    0:00  the Bazantic console: the gateway, its operations, the MCP server
          endpoint. Five seconds, just naming it.
    0:10  an MCP host with that server connected. Type the request in ordinary
          words: buy displacement cover for my principal, a software engineer,
          with a cover limit.
    0:25  the agent reads the index topic through the Hedera mirror node. Show
          the decoded observation: the period, the smoothed excess, the open
          flag. This is the second service the prize asks for, and the result
          depends on it: the recipe refuses to buy when the topic and the feed
          disagree.
    0:40  the agent calls the paid index route. Show the 402, the settlement and
          the transaction id.
    1:00  the agent states its decision in one line with the numbers in it.
    1:10  quote, then bind, with the premium settled over x402.
    1:30  the policy read back: status, NFT serial, next payment date.
    1:40  HashScan: the payments topic message and the settled transaction. This
          is the beat that says it really happened.
    1:55  the end card with the repository URL.

Same capture rules as the main video. If the host is slow, cut the waiting.

## The link a judge follows

A judge has minutes, no World ID and no wallet, and everything this product does
after the purchase happens on a dashboard behind a check. So there is one link
that gets past all three, and it is the link to give in a submission form, in a
video description and in a message to a judge.

    https://creance.co/home/demo

It holds two kinds of thing and keeps them apart in words. The covers at the top
are real: `pnpm demo:seed` bound each one on testnet, the page prints the cover
key that opens it, and opening one opens the same dashboard a buyer reaches, with
the same figures read from the same API and every one of them resolving on
HashScan. The states underneath are fixtures, and are there because a cover only
lapses when a premium goes unpaid and only pays out when a claim is decided, and
neither can be arranged for a visitor. Each one says on its face that nothing on
it came from the API.

The front door and the way back in both offer the page under one link, "See a
live cover", so nobody has to be told a URL on camera. A deployment that
publishes nothing has no page there at all.

Two things about it are worth knowing before a take.

The covers live in whatever database `DATABASE_URL` named when the seed ran. A
key seeded against a laptop opens nothing on a deployment pointed at another
database, so the seed has to run against the database the deployment reads.

A published key survives a redeploy and the session it opens does not. The key is
a row in `cover_keys`; the cover session is a signed cookie, and
`COVER_SESSION_SECRET` is a fresh random value per process when it is unset, so a
restart signs everybody out. The reader follows the link again and is back where
they were. That is the safe direction to fail in, and it is why the key is
printed on the page rather than only posted by the button.

## What the seed leaves behind

`pnpm demo:seed` prints an id block at the end and writes it to `var/demo/seed.json`.
That block is what the operator keeps open in a scratch tab: the series, the
contracts, the four topics, the two tokens, the two claimable policies and the
published one with their holders and bind transactions, and the two noteholders. What it created on the
run this document was written against is in docs/HEDERA.md under the T24 heading.

It also binds the cover the published link opens, on the one holder that carries
no packet, and captures that cover's key. It has to capture it there: the key is
issued once at bind and the database keeps only a digest of it, so no command can
print the key of a cover that is already bound. At the end of a run the seed
prints the `WEB_DEMO_COVERS` line to paste into the environment the web process
reads. A slot in that line is filled only from what the database says the cover
is, so a database in which no claim has been paid publishes no paid cover and the
payout on `/home/demo` stays the labelled fixture.
