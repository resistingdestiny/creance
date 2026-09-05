# Submission

Everything the ETHGlobal submission form and the partner prize pages ask for, in
one place. Entries marked "Root pending" need a person: an account setting, a
browser session on somebody else's site, a camera or a video editor. Entries
marked with a ticket are still build work. The prize acceptance checklist, with
an evidence link on every ticked line, is kept with the event record rather than
in this repository, so nothing here is duplicated from it.

## Repository

https://github.com/resistingdestiny/creance

MIT licensed, see LICENSE. The repository is private today; Root makes it public
before submission, and that is the one thing on this line that needs a person.

The clean-clone run through and the architecture are both in README.md, and the
testnet resources are in docs/HEDERA.md.
[Fifteen minutes from a clean clone](../README.md#fifteen-minutes-from-a-clean-clone)
is the measured run of the three flows a judge is asked to repeat.
[Layout](../README.md#layout) says how the
five applications, the two packages and the contracts fit together,
[Payment flow](../README.md#payment-flow) walks the x402 path step by step,
[Tokenization](../README.md#tokenization) gives the note's steps in the order to
run them, and
docs/HEDERA.md carries every account, token, topic and contract id with the
transaction that proved it. Every place the build differs from the brief is in
docs/DECISIONS.md, one section per ticket. There is no separate architecture
document in the repository and there is not meant to be.

## Live app

- https://creance.co: Root pending. The images, the compose file, the Caddy
  site and the deploy script are built and proved locally under T21; what is
  missing is the host. Root provides a VPS with DNS pointed at it and the
  production .env on it, then `deploy/deploy.sh --with-caddy` puts the app up.
  The requirements are listed in deploy/README.md.
- https://creance.co/health: the same, and it is what a judge should be pointed
  at first. It returns the commit the running build came from.
- The uptime check in .github/workflows/uptime.yml starts checking that URL
  every fifteen minutes once the repository variable PUBLIC_SITE_URL is set.

## Videos

Root records the voice-over and cuts every one of these, per MISSION.md Roles.
The shot list they follow is T24.

- Main video, five minutes or less, shared across the Hedera tracks. Root pending.
- Showcase cut, two to four minutes. Root pending.
- Bazantic recipe recording, start to finish. Root pending, and it needs the
  gateway and the recipe from T19 first.
- Bazantic agentify recording, the second track. Root pending, and it needs the
  index gateway from T28 as well as the cover gateway. The beats are step 9b of
  recipes/bazantic/README.md.
- Harness clip showing the improvement working. Root pending. What it shows is
  https://github.com/hedera-dev/hedera-harness/pull/39.

## Hedera evidence

Contract addresses, token ids, topic ids and the transactions behind each prize
line are in docs/HEDERA.md, and the prize checklist links them line by line.
Nothing is duplicated here.

## World

- The feedback document is complete, with all four sections the prize asks for
  and a dated entry per finding. It is kept with the event record rather than in
  this repository. **Root pending**: the World track names it as a deliverable,
  so Root attaches it to the submission or puts it back in the repository.
- Staging app id: `app_8569aa8d1bbfb24b1243e86d4fc34adc`. RP id:
  `rp_d6ae9b4ff2018a15`.
- Actions: `occupation-cover-eligibility` at purchase and
  `occupation-cover-claim` at claim. Two registered actions means two
  nullifiers, so `GET /health` reports `world.continuity` as false and the
  continuity sentence is the weaker one. docs/DECISIONS.md under T11 and T13
  says exactly what that costs.
- Sandbox App: Root pending. The staging simulator cannot complete a Selfie
  Check, so the credential needs a phone and a face. What is left to run, and
  why each item matters, is listed in the feedback document under "What is left
  for the device run".

## Bazantic

Two tracks are entered, and they share one account and one API. Common to both:

- Username on bazantic.com: `BAZANTIC_USERNAME` (Root pending). Root replaces
  that placeholder with the account's username the moment the account exists.
  Access is requested at https://bazantic.com/become-a-provider#apply, which
  asks for a project name, a work email and a spec or docs URL.
- Two gateways on one API, which is how DESIGN.md section 4 has drawn it from
  the start. Creating both is Root pending, browser work on bazantic.com, and
  the base URL for both is https://creance.co, which needs the host under "Live
  app" first. The MCP server endpoints go here beside the username.

### Best Recipe that uses Sponsor APIs

- Gateway: the cover gateway. Import recipes/bazantic/openapi.yaml, or
  openapi.json if the importer prefers it. Seven operations. The browser steps
  for Root are recipes/bazantic/README.md, which also says what to do when the
  public host is not up yet.
- Recipes: recipes/bazantic/buy-displacement-cover.md and
  recipes/bazantic/should-my-principal-renew.md. Both use two services, the
  Hedera mirror node on the index topic 0.0.10366470 and this project's own
  gateway, and both stop rather than guess when the two disagree.
- Recording: Root pending, the beats are step 9 of recipes/bazantic/README.md.

### Agentify a New API

Read from https://ethglobal.com/events/ethonline2026/prizes on 5 September 2026,
because the backlog carried only the title and the ranking. $1,000 in total,
$500, $300 and $200. What it asks for, and where each piece is:

- An account on bazantic.com. Shared with the other track, above. Root pending.
- An x402/MPP gateway in Bazantic for the project. The cover gateway, above.
- A service that was not available through Bazantic and is not another sponsor's
  API. The Occupation Displacement Index: a monthly measure of how far a US
  occupation is losing ground against the labour market, computed from the
  Bureau of Labor Statistics Current Population Survey, published to the Hedera
  Consensus Service topic 0.0.10366470 and sold at 0.01 TUSD a call. It exists
  nowhere else, and it is useful to a caller who will never buy a policy.
- A working gateway for that service. recipes/bazantic/agentify/openapi.yaml,
  three operations and nothing about cover in it. Creating it in the console is
  Root pending; the steps are recipes/bazantic/agentify/README.md.
- A recipe that uses both services in one working flow.
  recipes/bazantic/agentify/rank-occupations-and-price-the-worst.md. The index
  gateway supplies the ranking and the cover gateway supplies the price, and
  neither answer can be reached from the other.
- A screen recording demonstrating what the recipe does. Root pending, a second
  recording; the beats are step 9b of recipes/bazantic/README.md.
- The Bazantic account username. Shared with the other track, above.

The judging text says the strongest submissions add a new API service and bring
it into a recipe other builders can reuse, not a one-off connection made for the
demo. What is built against that: the feed has agent-facing description files
generated from the same code the API is, `llms.txt` and `SKILL.md`, served at
https://creance.co/llms.txt and https://creance.co/skill.md as well as committed
under recipes/bazantic/agentify/; a free catalogue at `GET /v1/index` so a
caller can find a group key and the price without paying; and a proof that a
client given nothing but the description file and a funded key discovers the
feed, pays over x402 on Hedera testnet and gets a reading that matches the
settled record. That run is docs/HEDERA.md, "The index feed, discovered and paid
for cold", settlement
https://hashscan.io/testnet/transaction/0.0.7162784-1788636717-287109241, and
the transcript is docs/demo/agentify.txt.

Staying callable is documented rather than assumed:
recipes/bazantic/agentify/README.md says how a caller gets TUSD, that there is
no faucet for it and the operator mints and transfers it, that HBAR comes from
the Hedera portal faucet, and what the API side needs to keep writing receipts.

### Which of the two is the stronger submission today

The Agentify track, as of 5 September 2026, because it is the one with an end to
end proof already recorded: a cold client paid for a reading on testnet and the
answer matched consensus. The recipe track's evidence is the two recipe texts
and a gateway nobody has created yet, so its strongest beat is a recording that
does not exist. Both depend on the same Root pending items, the account and the
public host; whichever gets a gateway and a recording first becomes the stronger
one, and this line is updated when that happens.

## Harness

Pull request: https://github.com/hedera-dev/hedera-harness/pull/39

"feat: a mirror node reader for CHAIN, and classify mirror outages as
infrastructure", opened 5 September 2026 against `hedera-dev/hedera-harness:dev`
from the fork at
https://github.com/resistingdestiny/hedera-harness/tree/feat/mirror-node-verification

Tier 3.5 of the harness says it verifies effects against the mirror node and
ships no code that reads one, so the pull request adds
`src/validation/mirrorNode.ts` with 18 offline tests, makes the ephemeral chain
signer wait for the mirror node before a run is graded, teaches the
infrastructure classifier the error text a real mirror node or relay outage
emits, and corrects the endpoint list in the validator prompt. The problem
statement, the run commands, the measured test counts, the live testnet output
and the before and after classification table are all in the pull request body.

The candidate was chosen from docs/harness-notes.md; the rationale is in
docs/DECISIONS.md under "T20, the Harness contribution".
