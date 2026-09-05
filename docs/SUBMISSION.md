# Submission

Everything the ETHGlobal submission form and the partner prize pages ask for, in
one place. Entries marked "Root pending" need a person: an account setting, a
browser session on somebody else's site, a camera or a video editor. Entries
marked with a ticket are still build work. The evidence behind each ticked line
in docs/PRIZES.md lives there, not here.

## Repository

https://github.com/resistingdestiny/creance

MIT licensed, see LICENSE. The repository is private today; Root makes it public
before submission, and that is the one thing on this line that needs a person.

The clean-clone run through and the architecture are both in README.md, and the
testnet resources are in docs/HEDERA.md. [Layout](../README.md#layout) says how the
five applications, the two packages and the contracts fit together,
[Payment flow](../README.md#payment-flow) walks the x402 path step by step, and
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
- Harness clip showing the improvement working. Root pending. What it shows is
  https://github.com/hedera-dev/hedera-harness/pull/39.

## Hedera evidence

Contract addresses, token ids, topic ids and the transactions behind each prize
line are in docs/HEDERA.md and linked line by line in docs/PRIZES.md. Nothing is
duplicated here.

## World

- docs/FEEDBACK-WORLD.md is complete, with all four sections the prize asks for
  and a dated entry per finding.
- Staging app id: `app_8569aa8d1bbfb24b1243e86d4fc34adc`. RP id:
  `rp_d6ae9b4ff2018a15`.
- Actions: `occupation-cover-eligibility` at purchase and
  `occupation-cover-claim` at claim. Two registered actions means two
  nullifiers, so `GET /health` reports `world.continuity` as false and the
  continuity sentence is the weaker one. docs/FEEDBACK-WORLD.md says exactly
  what that costs.
- Sandbox App: Root pending. The staging simulator cannot complete a Selfie
  Check, so the credential needs a phone and a face. What is left to run, and
  why each item matters, is listed in docs/FEEDBACK-WORLD.md under "What is left
  for the device run".

## Bazantic

- Username on bazantic.com: Root pending, then T19 records it here.
- Gateway and MCP server: Root pending, browser work on bazantic.com. The spec
  to import is recipes/bazantic/openapi.yaml; the browser steps for Root are
  recipes/bazantic/README.md, T19.
- Recipe text under recipes/bazantic/: T19. The directory holds the OpenAPI spec
  today, in both openapi.yaml and openapi.json.

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
