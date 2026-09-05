# Submission

Everything the ETHGlobal submission form and the partner prize pages ask for, in
one place. Entries marked "Pending" are filled in by T19 and T22; the evidence
behind each ticked line in docs/PRIZES.md lives there, not here.

## Repository

https://github.com/resistingdestiny/creance

MIT licensed. The clean-clone run through is README.md; the architecture is
docs/ARCHITECTURE.md and the testnet resources are docs/HEDERA.md.

## Videos

- Main video, five minutes or less, shared across the Hedera tracks. Pending, T22.
- Showcase cut, two to four minutes. Pending, T22.
- Bazantic recipe recording, start to finish. Pending, T22.
- Harness clip showing the improvement working. Pending, T22.

## Hedera evidence

Contract addresses, token ids, topic ids and the transactions behind each prize
line are in docs/HEDERA.md and linked line by line in docs/PRIZES.md. Nothing is
duplicated here.

## World

Sandbox app, actions and the four required feedback sections are in
docs/FEEDBACK-WORLD.md. Pending, T22.

## Bazantic

- Username on bazantic.com: pending, Root, T19.
- Gateway and MCP server: pending, Root, T19. The steps are in
  recipes/bazantic/README.md and the spec to import is
  recipes/bazantic/openapi.yaml.
- Recipe text: recipes/bazantic/.

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
