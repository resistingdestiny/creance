# Bazantic gateway, MCP server and recipes

What is in this directory, and what a person has to do in a browser to turn it
into a live gateway. Everything here is testnet only.

    openapi.yaml                     the spec to import, OpenAPI 3.0.3
    openapi.json                     the same document as JSON
    buy-displacement-cover.md        recipe 1, the buy flow
    should-my-principal-renew.md     recipe 2, the renewal check

The two spec files are generated, never hand edited. `pnpm api:openapi` writes
both from `apps/api/src/openapi.ts`, and `apps/api/test/openapi.test.ts`
regenerates them, compares them to what is committed, validates the YAML against
the OpenAPI 3.0 schema and checks that every documented operation routes on the
running server. Change the generator, run the script, commit both files.

## What the gateway exposes

Seven operations, and nothing else. No claims routes, no admin routes, and not
the interim eligibility issuer.

| Operation | Price | Notes |
|---|---|---|
| `GET /v1/index/{group}` | 0.01 TUSD | the metered index feed |
| `POST /v1/quote` | 0.05 TUSD | paid, and only paid: a credential is not a payment |
| `POST /v1/bind` | the first month premium | needs an eligibility credential |
| `GET /v1/policy/{policyId}` | free | |
| `GET /v1/audit/{policyId}` | free | the HCS trail, read from the mirror node |
| `GET /v1/series/{seriesId}` | free | |
| `GET /v1/series/{seriesId}/coupons` | free | |

Payments are x402 version 2, scheme `exact`, network `hedera:testnet`, settled
through the Blocky402 testnet facilitator at `api.testnet.blocky402.com`, in
TUSD `0.0.10366463` to `0.0.10366450`. The prices above are the ones the live
402 responses already advertise, so nothing has to be configured twice: import
the spec, make an unpaid call, and read the terms out of the `PAYMENT-REQUIRED`
header.

## The base URL

`https://creance.co`, which is the single `servers` entry in the document. Never
a localhost entry and never a tunnel: a gateway in somebody else's product has
to reach the API from their network.

That host is Root pending as this is written. `docs/SUBMISSION.md` under "Live
app" says what is missing, which is a VPS with DNS pointed at it; the images,
the compose file and the deploy script are built and proved. If the host is not
up when the gateway is created:

1. Apply anyway. The provider application asks for a spec or docs URL, not for a
   running API, so a link to `recipes/bazantic/openapi.yaml` in the public
   repository is enough to start the conversation, and the two business day
   response window is the thing worth starting early.
2. Do not point the gateway at anything else in the meantime. A gateway that
   answers from a laptop is worse than a gateway that is not created yet,
   because the recording made against it is not reproducible by a judge.
3. Get the host up before the recording. `deploy/deploy.sh --with-caddy` is the
   whole step once the VPS exists; the requirements are in `deploy/README.md`.
   `https://creance.co/health` returning the running commit is the check.

## Steps for Root

The first two steps are verified from Bazantic's own pages, read on
5 September 2026. Everything after the account exists happens inside a console
nobody outside the beta has seen, so those steps are written as things to
accomplish and are marked unverified. Correct them in this file as they happen:
this file is the honest answer to "how did you set this up", so it should end up
describing what was actually done, not what was expected.

**1. Get access.** Two doors, and they are different products.

- Provider, which is the one this project needs:
  https://bazantic.com/become-a-provider#apply. Three required fields, "Company
  or Project Name", "Work Email" and "OpenAPI Spec or Docs URL". Give the URL of
  `recipes/bazantic/openapi.yaml` in the public repository, or
  `https://creance.co` once it is up. The page says every application is
  reviewed by hand with a reply inside two business days, and the FAQ says they
  may ask for a test key so they can see real calls and responses.
- Developer beta, which is the side that consumes gateways:
  https://bazantic.com/developers#beta. First name, last name, email, company,
  and what you are trying to do.

There is no public documentation site: `docs.bazantic.com` does not resolve, and
the word "recipe" appears nowhere on Bazantic's own pages. It comes from the
prize text, which asks for an account and a gateway for the project, a second
service that is either already on Bazantic or comes from a sponsor, and one
working flow whose result depends on both. Both recipes here are built to that
reading, with the Hedera mirror node as the second service.

**2. Record the username.** The moment the account exists, put the username in
`docs/SUBMISSION.md` under "Bazantic", replacing the placeholder. It is on the
prize checklist and it is the one thing nobody else can supply.

**3. Create the gateway and import the spec.** Unverified. Point it at
`https://creance.co` and import `openapi.yaml`. If the importer rejects the
YAML, try `openapi.json`, which is the same document; both are emitted by the
same script for exactly this reason. The document is 3.0.3 and not 3.1, with no
`oneOf`, `anyOf`, `allOf` or recursive `$ref` anywhere in it, because those are
what importers disagree about.

**4. Check the operation list.** Unverified. Seven operations, matching the
table above. If the console shows more, something else got imported. If it shows
fewer, note which and why in `docs/harness-notes.md`.

**5. Configure payment.** Unverified. x402 on Hedera testnet. The prices are
already in the spec and in the live 402s; confirm the console agrees rather than
typing them again. The settlement transaction id an agent gets back begins with
the facilitator's fee payer `0.0.7162784`, not with the paying account, which is
worth knowing before anyone goes looking for it on HashScan.

**6. Generate the MCP server and record its endpoint.** Unverified. Put the
endpoint in `docs/SUBMISSION.md` beside the username.

**7. Make one tool call from an MCP host end to end.** Unverified. Free first:
`GET /v1/series/ODI-COMP-2026-01`, which answers without a payment and proves
routing. Then paid: `GET /v1/index/computer_math`, which proves the 402, the
settlement and the receipt. Keep the settlement transaction id; it belongs in
the pull request and in `docs/HEDERA.md`.

**8. Paste the two recipes**, however the console accepts them: a prompt, a
saved workflow, a skills file or a description field. The texts here are the
recipes of record either way. If the console stores them in a form this
repository does not have, add that form here.

**9. Record the run.** The prize wants the completed task start to finish. The
beats are the gateway and the MCP server, the natural language request, the
mirror node read with the decoded observation on screen, the paid feed call with
the 402 and the settlement, the decision line with the numbers in it, quote and
bind, the policy read back, and HashScan showing the payments topic message.
That last one is the beat that proves it really happened.

**10. Write down anything the console did that this document did not
anticipate.** `docs/harness-notes.md`. It is feedback material either way, and
it is what makes step 3 of this file true next time.

## The eligibility credential, before anyone is surprised by it

`POST /v1/bind` needs one, and no gateway can mint it. A person completes a
World Selfie Check in the World App and `POST /v1/world/verify` issues the
credential; an agent is handed one by its principal and never performs the check
itself. That endpoint is deliberately not in this gateway.

There is an interim issuer, `POST /v1/demo/eligibility`, which mints the same
credential without a Selfie Check. It is labelled in its own response, it is not
in this document, and `DEMO_ELIGIBILITY_ISSUER=false` turns it off. If the
recorded run uses it, say so in the recording rather than letting it pass as a
Selfie Check.

## What the recipes stop short of

Bind. The following months' premiums are Hedera Scheduled Transactions created
by the Steward agent, outside x402, because the `exact` scheme requires a bare
transfer transaction and refuses one wrapped in a `ScheduleCreate`. A recipe that
implied it had set up a year of payments would be lying about the one part of
this system that is genuinely interesting.
