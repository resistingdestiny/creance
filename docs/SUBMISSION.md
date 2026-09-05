# Submission

Everything the ETHGlobal submission form and the partner prize pages ask for, in
one place. Entries marked "Pending" are filled in by T19 and T22; the evidence
behind each ticked line in docs/PRIZES.md lives there, not here.

## Repository

https://github.com/resistingdestiny/creance

MIT licensed. The clean-clone run through and the architecture are both in
README.md, and the testnet resources are in docs/HEDERA.md.

- docs/ARCHITECTURE.md, the diagram updated to what was built: pending, T22.

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

- docs/FEEDBACK-WORLD.md, the sandbox app, the actions and the four required
  feedback sections: pending, T22.

## Bazantic

- Username on bazantic.com: pending, Root, T19.
- Gateway and MCP server: pending, Root, T19. The spec to import is
  recipes/bazantic/openapi.yaml; the browser steps for Root are
  recipes/bazantic/README.md, pending T19.
- Recipe text under recipes/bazantic/: pending, T19. The directory holds the
  OpenAPI spec today, in both openapi.yaml and openapi.json.

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
