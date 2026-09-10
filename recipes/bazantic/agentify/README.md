# The Occupation Displacement Index, as a gateway of its own

The index feed is a product, not an endpoint. It is a monthly number for
fifteen US occupation groups that exists nowhere else, it is useful to a caller
who will never buy an insurance policy, and it is sold per call over x402. This
directory is everything an agent or a builder needs to use it without asking a
person, and everything Root needs to import it into Bazantic as a second
gateway beside the cover gateway in the parent directory.

Everything here is testnet only.

    openapi.yaml                            the spec to import, OpenAPI 3.0.3
    openapi.json                            the same document as JSON
    llms.txt                                the index file an agent reads first
    SKILL.md                                the skill, with a worked call
    rank-occupations-and-price-the-worst.md recipe 3, both gateways in one flow

None of the four generated files is hand edited. `pnpm api:openapi` writes all
of them from `apps/api/src/openapi-index.ts` and `apps/api/src/agent-docs.ts`,
and `apps/api/test/openapi-index.test.ts` and `apps/api/test/agent-docs.test.ts`
regenerate them, compare them to what is committed, validate the YAML against
the OpenAPI 3.0 schema, and check that every documented operation routes on the
running server. Change the code, run the script, commit the files.

The same bytes are served live, so an agent needs no repository:

| Path | What it is |
|---|---|
| `https://creance.co/llms.txt` | the index file |
| `https://creance.co/skill.md` | the skill |
| `https://creance.co/openapi/index.json` | the OpenAPI document |

The API generates all three and answers all three. The public origin hands those
paths to it, along with everything under `/v1/` that `llms.txt` links to, so an
agent that follows a link out of the index file stays on one origin. See
deploy/README.md under "The API's paths on the web origin".

## What this gateway exposes

Three operations, which are the whole public index surface. Two are free, and
they exist so the third can be called correctly the first time.

| Operation | Price | What it is for |
|---|---|---|
| `GET /v1/index` | free | the catalogue: group keys, labels, source series, the frozen trigger lines, which groups have a reading, and the price |
| `GET /v1/index/{group}` | 0.01 TUSD | the reading: newest month, twenty-four months of history, trigger status, source series and hash |
| `GET /v1/replay` | free | the clock: whether the feed is live or replaying published history |

Nothing about cover is here. Quoting, binding, policies, series and claims are
the cover gateway in the parent directory, and a test refuses to let any of
their paths into this document.

`GET /v1/index/health` is not here either. That route is index operations and it
belongs to its own ticket; putting it in this document before it exists would
give an importer an operation that answers 404.

Payments are x402 version 2, scheme `exact`, network `hedera:testnet`, settled
through the Blocky402 testnet facilitator at `api.testnet.blocky402.com`, in
TUSD `0.0.10366463` to `0.0.10366450`. The price above is the one the live 402
already advertises, so nothing has to be configured twice: import the spec, make
an unpaid call, and read the terms out of the `PAYMENT-REQUIRED` header and out
of the body.

## The base URL

`https://creance.co`, which is the single `servers` entry in the document, and
the origin every URL in `llms.txt` and `SKILL.md` points at. Never a localhost
entry and never a tunnel: a gateway in somebody else's product has to reach the
API from their network, and a description file that teaches an agent an address
which stops answering is worse than no description file.

That host is Root pending as this is written. `docs/SUBMISSION.md` under "Live
app" says what is missing, and `../README.md` under "The base URL" says what to
do about it while it is missing. The same three rules apply here: apply to
Bazantic anyway, point the gateway at nothing else in the meantime, and get the
host up before the recording.

## Staying callable, and paying for it

This feed is meant to answer for the rest of the event and afterwards, not only
during a demo. Three things keep it answering.

**A caller needs TUSD.** There is no faucet for it. TUSD `0.0.10366463` is this
build's own HTS settlement token, minted by the operator, and the way to get
some is to ask: open an issue on the repository, or ask Root, with the Hedera
testnet account id to send it to. The operator transfers it in one
`TransferTransaction` and the receiving account needs either an association with
the token or a free auto-association slot; the demo accounts carry
`maxAutomaticTokenAssociations = -1`, so the first transfer consumes a slot and
the sender pays for it. The balances handed out at setup are in `docs/HEDERA.md`
under "Demo balances", and at 0.01 TUSD a reading, the 10,000 TUSD a demo
policyholder holds is a million calls. Nobody is going to run out by reading the
index.

**A caller needs almost no HBAR.** The facilitator pays the Hedera network fee
for the settlement, so a payer holding TUSD and a funded account can call the
feed without an HBAR balance worth managing. New testnet accounts come from the
Hedera portal faucet at https://portal.hedera.com, which gives 1,000 test HBAR
per account per day.

**The API side needs HBAR.** It writes a message to the payments topic for every
settled call, and a topic submit costs a fraction of a cent, but it is not free
and an account at zero stops writing. The api account `0.0.10366450` is the one
to watch: `docs/HEDERA.md` records the day it ran out mid-claim, where a contract
call refused with `insufficient funds for intrinsic transaction cost` at 2.14
HBAR and 25 HBAR from the operator fixed it. The feed itself keeps earning TUSD
rather than HBAR, so a long-running deployment tops the api account up from the
portal faucet or from the operator; there is nothing automatic about it.

If the api account does run dry, the reading still answers and the payment still
settles. What stops is the receipt on the payments topic, and the settlement row
is kept so it can be reconciled later.

## Steps for Root

The cover gateway's steps are in `../README.md` and are not repeated. This is
the second gateway, and the differences are the whole of this list.

**1. Create it as a second gateway, not as more operations on the first.** The
prize text asks for a service that was not previously available through
Bazantic, brought into a recipe other builders can reuse. That is this feed. It
has its own spec file, its own price and its own description files precisely so
it can be imported on its own, and DESIGN.md section 4 has drawn it as the
second gateway on the same API since before any of this was built.

**2. Import `openapi.yaml`, or `openapi.json` if the importer prefers it.** Both
are the same document and both are emitted by the same script. Three operations
should appear. If more appear, the wrong file was imported.

**3. Give the description files if the console asks for them.** Bazantic's
provider page lists an "Optimized Skills File" and an "LLM.txt file (coming
soon)" among the things it generates. If the console generates its own, keep
both and note in `docs/harness-notes.md` where the generated one differs from
`llms.txt` and `SKILL.md` here. That comparison is worth more than either file
alone, and it is the kind of feedback a provider platform wants.

**4. Check the price and the network.** 0.01 TUSD, asset `0.0.10366463`, network
`hedera:testnet`, pay to `0.0.10366450`. They are in the spec and in the live
402 already; confirm the console agrees rather than typing them again.

**5. Run the recipe in this directory against both gateways.** It is the one
that needs the index gateway and the cover gateway together, so it is the one
that demonstrates the new service inside a flow rather than on its own.

**6. Record what the console did that this file did not anticipate.**
`docs/harness-notes.md`, as ever.

## The recipes

| Recipe | Gateways it uses |
|---|---|
| [rank-occupations-and-price-the-worst.md](rank-occupations-and-price-the-worst.md) | the index gateway and the cover gateway |
| [../buy-displacement-cover.md](../buy-displacement-cover.md) | the mirror node and the cover gateway |
| [../should-my-principal-renew.md](../should-my-principal-renew.md) | the mirror node and the cover gateway |

The first is this track's recipe: it is the one whose result cannot be reached
without the new service. The other two are the recipe track's and use the
Hedera mirror node as their second service.

## What an agent gets wrong if nobody tells it

These are in `SKILL.md` because they are what a first-time caller gets wrong,
and they are here because a person reading the directory should see them too.

- **A level line can be negative.** For an occupation with structurally low
  unemployment the trigger is deterioration against its own history, not high
  unemployment in absolute terms.
- **A margin and a distance have opposite signs.** `level_margin` is the reading
  less the line; `headline.distance` is the line less the reading.
- **A level is not a rank.** The lines are per occupation and frozen, so the
  only number comparable across occupations is the distance to the nearer line.
- **An open month is not a payout.** The index opening is one of two keys; the
  person still has to lose their job and prove it.
- **The payment is taken before the group is validated.** The gate is an
  `onRequest` hook, so a guessed group key costs 0.01 TUSD. Read the catalogue.
