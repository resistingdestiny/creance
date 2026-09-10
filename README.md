# Creance

Workers buy monthly parametric cover against their occupation being displaced, and investors fund the payouts by buying Displacement Bond Notes that earn the premiums as coupons. A public occupation index computed from official labour statistics decides when claims open, and a claim pays only when the claimant can also show they lost their job.

Everything runs on Hedera testnet. There is no mainnet path and no real money anywhere in this repository.

## Status

Being built. The contracts, the note series, the coupon and maturity runs, the index model, the API, the worker and investor screens, the index oracle, the Steward agent, the Adjuster, the claim flow and the review queue are live on Hedera testnet; the API's three metered endpoints are gated with x402 and settle through Blocky402, one payout and one decline are on the claims topic, and the images and compose file for a public deployment are built. The demonstration is seeded and its shot list is written. The scheduler still prints what it will do instead of doing it, and a later ticket fills it in.

## Requirements

- Node 22 or later
- pnpm 11.25.0, which is pinned by the `packageManager` field in [package.json](package.json). Run `corepack enable` and pnpm will match it.
- PostgreSQL 14 or later, for the API. Only the API needs it, and only when it runs: `pnpm test` has no database.
- Ports 3000 and 3210 free. The API refuses to start if 3210 is taken; the web app takes the next free port and prints which one, so read the address it prints rather than assuming 3000.

## Setup

    pnpm install
    cp .env.example .env

Three lines in `.env` are enough for everything below: `HEDERA_OPERATOR_ID`,
`HEDERA_OPERATOR_KEY` and `DATABASE_URL`. Leave every other line exactly as the
example has it. A blank line is read as unset rather than as an empty value, so
the contract addresses, the token, the topics and the account ids all come from
the two data files this repository already carries,
[contracts/deployments/testnet.json](contracts/deployments/testnet.json) and
[docs/hedera.testnet.json](docs/hedera.testnet.json). The oracle, API, Steward,
adjuster, policyholder and investor accounts each derive their key from the
operator key with HKDF, so the operator key is the only Hedera secret a clone
needs. Every variable is listed with a one line comment in
[.env.example](.env.example). `.env` is ignored by git and must never be
committed.

`pnpm test` needs none of it: the unit suite touches no chain and no database.

For the API, create the database and point `DATABASE_URL` at it:

    createdb creance
    pnpm api:migrate

`DATABASE_URL` is `postgresql://user:password@localhost:5432/creance` where the
server wants a password, or `postgresql:///creance?host=/var/run/postgresql`
where a unix socket and peer authentication are enough.

`pnpm api:migrate` applies the migrations under `apps/api/migrations` and seeds the fifteen occupation groups. It is idempotent: running it again prints `nothing to do`. The API also runs it at boot, so a first `pnpm dev` after `createdb` is enough.

## Fifteen minutes from a clean clone

The three flows, in the order to run them, with what each one should print. The
timings are a measured run on 5 September 2026 from a fresh clone of this
repository: node 22.23.1, pnpm 11.25.0, PostgreSQL on localhost, the operator
key and `DATABASE_URL` filled in and nothing else.

| Step | Command | Time |
| --- | --- | --- |
| Install | `pnpm install` | 8 seconds against a warm pnpm store, a few minutes on a cold one |
| Database | `createdb creance` then `pnpm api:migrate` | 3 seconds, prints `applied 001_init, 002_adjuster, 003_claims` |
| Unit tests, optional | `pnpm test` | 83 seconds |
| Boot | `pnpm dev` | the API answers `GET /health` after 10 seconds, the web app is ready in 2 |
| Worker flow | a browser at http://localhost:3000 | under two minutes to a bound policy, most of it waiting on testnet |
| Steward flow | `pnpm steward:run --as-of 2025-05 --cadence demo` | 38 seconds to a bound policy and three premium schedules |
| Oracle replay | `pnpm oracle:preflight` then `pnpm oracle:replay --dry-run --interval-ms 250` | 6 seconds, then 12 |

Under four minutes of wall clock from `git clone` to all three flows done,
skipping the optional unit suite. The two things that stretch it are a
cold pnpm store and the demo clock at its real cadence, which is ten seconds a
month by design and is what the video shows.

**The worker flow.** Open http://localhost:3000, press "Get a quote", choose
any of the fifteen occupations, all of which have a cover series and capacity
behind them, set the slider and press Continue. The price on screen is a real
quote from the API and every move of the slider is a paid call. The verify
screen runs the World Selfie Check when the three `WORLD_` variables are filled
in and otherwise runs the API's labelled interim issuer, which says on screen
that it is not a World check; a judge needs no World Developer Portal account
to finish the flow. Press Pay and the first premium settles over x402 from the
demo worker's testnet account, the policy binds, the receipt NFT is minted and
the receipt goes to the payments topic. Every settlement is printed in the
terminal `pnpm dev` runs in, with its HashScan link.

Binding writes to testnet and commits permanent exposure against the series
behind the occupation chosen, so bind at the smallest amount the slider offers
when repeating the run.

**The Steward flow.** `pnpm steward:run` needs `pnpm dev` running and pays every
metered call from the agent's own account. On live data the rule usually decides
hold, which is a complete cycle: it pays for the index, prints the three months
it read and writes the decision to the agent journal. `--as-of 2025-05` puts the
vantage on a month whose three month trend is rising, which is what makes the
rule buy, and the run then quotes, binds over x402, creates the premium
schedules and journals all of it. See [The Steward agent](#the-steward-agent).

**The oracle replay.** `pnpm oracle:preflight` reads every precondition and
sends nothing. The replay itself walks January 2025 to the newest month the
archive carries, all of it computed from the committed BLS snapshot with no
network and no key. `--dry-run` computes, gates, signs and encodes the whole
window and sends nothing, which is the right thing to run against the shared
testnet resources: the index topic already carries this window, and the first
value published for a period settles it forever. Without `--dry-run` the command
reads the topic back through the mirror node first and publishes only the months
that are missing from it. See [Which replay windows run](#which-replay-windows-run).

## Commands

Run all of these from the repository root.

| Command | What it does |
| --- | --- |
| `pnpm test` | Runs every unit test in every workspace. Chain free, no credentials needed. |
| `pnpm test:testnet` | Runs the integration tests against Hedera testnet: the contract lifecycle run through, one policy bound end to end through the API, one paid request of each kind through the x402 gate, then that policy's audit trail read back off the payments topic. Needs credentials and a database. |
| `pnpm dev` | Runs the web app on http://localhost:3000 and the API on http://localhost:3210, together. The component gallery, which is the design review surface, is at http://localhost:3000/gallery. The worker flow starts at http://localhost:3000 and runs through `/occupation`, `/amount`, `/verify`, `/pay` to `/home` and `/cover/index`. The investor screens are at http://localhost:3000/invest and http://localhost:3000/invest/subscribe, and the receipt for a policy is at http://localhost:3000/receipt/:policyId. All of them read the API. |
| `pnpm lint` | Runs eslint across the repository. |
| `pnpm typecheck` | Runs the TypeScript compiler in every workspace without emitting. |
| `pnpm oracle:once` | One live run. Pulls the sixteen BLS series, computes both trigger forms for every bindable group, runs the QA gates of [docs/INDEX-SPEC.md](docs/INDEX-SPEC.md) section 8, publishes one signed observation per group to the index topic, and submits the groups that have a cover series registered in CoverPool. Options: `--period YYYY-MM` (defaults to the newest month the source carries), `--source archive\|cache\|api` (defaults to `api`, the live path), `--series LABEL` to publish one group only, `--no-submit` to publish without a contract call, and `--dry-run` to compute, gate, sign and encode everything and send nothing. A group and month that already reached the index topic is never published again, whichever command put it there: the demo replay runs to the newest month the source carries and this command defaults to that same month, so running one after the other publishes it once. |
| `pnpm oracle:replay` | The demo clock. Replays real historical months for one cover series at one month per ten seconds, publishing and submitting exactly as the live path does, and writes the run state the API serves so the web app can show the REPLAY badge. Options: `--from YYYY-MM` (defaults to `2025-01`), `--to YYYY-MM`, `--series LABEL` (defaults to the demo series), `--interval-ms N` (defaults to 10000), `--source archive\|cache\|api` (defaults to `archive`, which covers the whole window with no BLS call), `--scenario NAME` for a labelled synthetic trigger from `apps/oracle/scenarios`, `--no-submit` and `--dry-run`. A scenario never writes the index topic and never calls the contract. Not every window can be replayed: see the note below. |
| `pnpm oracle:preflight` | Reads every precondition a real run depends on and prints it, sending nothing: the oracle's HBAR balance, the index topic and how many messages it already carries, and each series' status, `activeExposure`, reserve and last observed month. Run it before a testnet replay. |
| `pnpm oracle:verify` | Reads the index topic back through the mirror node and checks every message: that it is canonical JSON and that the signature recovers to the oracle's address. Public data only. Options: `--topic 0.0.x`, `--signer 0x...`. |
| `pnpm oracle:backtest` | Prints the open months per occupation group from January 2010 to the newest month the source carries, at the frozen per series attachment and level line, then the same window at the generic attachment of 2.0, a check that every series reproduces its frozen parameters from that source, and the empirical hazard on the distance to the level line. Options: `--from YYYY-MM`, `--source archive\|cache\|api`. |
| `pnpm oracle:backfill` | Computes the whole index history, settles nothing, and regenerates [docs/INDEX.md](docs/INDEX.md) from it. `pnpm oracle:backfill --from 2000-01` builds the full history. Options: `--from YYYY-MM`, `--source archive\|cache\|api`, `--out PATH`, and `--check` to regenerate and compare without writing. Deterministic: two runs over the same source produce a byte identical file. |
| `pnpm oracle:schedule` | Runs the daily index check and pipeline with QA gates and alerts. |
| `pnpm steward:run` | Runs one Steward cycle for the configured principal against Hedera testnet: reads the profile, pays for the index feed, applies the written decision rule, and if the rule says buy, quotes, binds with the first premium over x402, creates the next premiums as Scheduled Transactions and writes a journal entry to the agent-journal topic. Needs the API running with the x402 gate on. Options: `--profile PATH`, `--as-of YYYY-MM`, `--cadence monthly\|demo`, `--interval SECONDS`, `--premiums N`, `--wait`. See [The Steward agent](#the-steward-agent). |
| `pnpm adjuster:run` | One pass over the claims waiting for a decision: reads the review queue over the admin API, extracts the employer, the name, the job title and the end date from each evidence document with a vision-capable model, evaluates every rule in [docs/CLAIMS.md](docs/CLAIMS.md), publishes the decision record's fingerprint to the claims topic with the adjuster account's own key, and posts the decision back. A pass ends; nothing loops back over what it decided. Options: `--limit N`, `--watch`, `--interval SECONDS`, `--dry-run`. Needs the API running and `ADMIN_TOKEN` set. Without `ANTHROPIC_API_KEY` it still runs, and every claim that needs a document read is referred to the queue. See [The review queue](#the-review-queue). |
| `pnpm contracts:deploy` | Deploys CoverPool and CollateralVault to Hedera testnet and verifies them. |
| `pnpm hedera:setup` | Creates the day 0 Hedera testnet accounts, tokens and topics, and writes [docs/HEDERA.md](docs/HEDERA.md). Idempotent: run it again and it creates nothing. Needs the operator credentials in the local environment file. Add `--plan` to print what it would do and stop. |
| `pnpm hedera:schedule` | Runs the Scheduled Transactions spike against testnet: measures the expiry window, executes a scheduled premium transfer and chains the next month. Writes to testnet and costs fees. Stages: `bisect past immediate future chain`. |
| `pnpm series:capacity` | Gives every occupation group a series on Hedera testnet with capacity behind it, which is what makes its cover buyable. `register` opens each series in CollateralVault and registers it on CoverPool with that group's frozen calibration, then funds it with 25,000 TUSD so a bind has collateral; `notes` issues the Displacement Bond Note for each as a separate pass; `status` prints what is on chain per group and sends nothing; `all` runs register then notes. Name one group to act on it alone, for example `pnpm series:capacity register office_admin_support`. Idempotent against the chain rather than against the record, and resumable: it reads what the vault, the pool and the note already say, does only what is missing and writes the record after every series, so a run killed half way loses nothing and a second run sends no transactions. The note pass is deliberately last and never gates the cover: a series whose bond deploy fails keeps its capacity and stays buyable, the reason is written to `noteFailure` on that series, the run carries on to the next and exits non-zero at the end. Every series with a link for each transaction is [docs/HEDERA.md](docs/HEDERA.md). |
| `pnpm ats:issue` | Issues the demo Displacement Bond Note series as an Asset Tokenization Studio bond on Hedera testnet and runs the compliance sequence: roles, the credential issuer, a KYC grant per noteholder, the mints, a blocked then allowed transfer, pause, freeze and the first coupon. Idempotent: run it again and it does nothing. The run through with a link for every transaction is [docs/ATS.md](docs/ATS.md). Stages: `status throwaway issue roles issuer kyc1 mint1 blocked kyc2 allowed mint2 controls coupon couponcheck verify`. A second argument names the series to act on, by group key or by label, as in `pnpm ats:issue issue office_admin_support`; with no arguments it is the demo series and does exactly what it always did. |
| `pnpm coupons:pay` | Settles a declared coupon on Hedera testnet: seeds the premium account, subscribes the noteholders in the vault, pays each holder with a Scheduled Transaction carrying the vault's `fundCoupon` call, and publishes each settlement to the payments topic. Idempotent: run it again and it does nothing. The run through is [docs/ATS.md](docs/ATS.md) section 14. Stages: `status fund probe seed subscribe pay publish verify`. |
| `pnpm coupons:mature` | Runs a maturity redemption on Hedera testnet, on a short dated series opened for the purpose because the demo series matures in 2027: opens the series and a matching note, subscribes both noteholders, waits, then burns each holding through ATS and returns the principal from the vault. Stages: `status fund open bond subscribe wait redeem payout`. |
| `pnpm api:dev` | Runs the API alone on port 3210, reading Hedera testnet and the local database. Endpoints: `POST /v1/quote`, `POST /v1/bind`, `GET /v1/policy/:id`, `GET /v1/audit/:id`, `GET /v1/index/:group`, `GET /v1/series`, `GET /v1/series/:id`, `GET /v1/series/:id/coupons`, `POST /v1/world/rp-context`, `POST /v1/world/verify`, `POST /v1/claims`, `GET /v1/claims/:id`, `GET /v1/replay`, `GET /health`, `GET /healthz` and `GET /.well-known/jwks.json`, with the review queue under `/v1/admin/claims` behind `ADMIN_TOKEN`. The index, quote and bind routes are paid: see [Payment flow](#payment-flow). `GET /v1/replay` is the oracle's run state, which is what puts the REPLAY badge on the web app; it sits outside `/v1/index/` because everything under that prefix is metered. Set `PORT` to move it, and `X402_ENABLED=false` to serve them open. |
| `pnpm api:migrate` | Creates the API schema and seeds the fifteen occupation groups. Idempotent. |
| `pnpm --filter @creance/api claims:close-windows` | Reads every registered series and calls `closeWindow` on the ones whose claim window has ended, so the unclaimed reserve returns to the vault. Permissionless: any funded account can run it. It refuses before the deadline and prints when it will work, rather than sending a transaction that reverts. Add `--dry-run` to read and report only. |
| `pnpm --filter @creance/api testnet:claim` | Submits one proof of loss packet to a running API over HTTP, exactly as the web app will: a claim credential, an attestation signed by the policy wallet with its own key, and one of the committed documents. Options: `--policy pol_...` (required), `--packet a\|b`, `--holder ROLE`, `--url`, `--wait`. Then run `pnpm adjuster:run`. See [Claims](#claims). |
| `pnpm api:openapi` | Regenerates [recipes/bazantic/openapi.yaml](recipes/bazantic/openapi.yaml) and the JSON beside it from the routes. A test fails if the committed files differ. |
| `pnpm demo:seed` | Makes everything the demonstration of [docs/DEMO.md](docs/DEMO.md) needs true on Hedera testnet, by composing the commands below rather than repeating them: two policies bound with a backdated start so a separation in the loss window can be claimed, the noteholders on the note and in the vault, and the two committed claim packets fingerprinted and window checked against the cover they will be claimed on. Idempotent and stage based like `pnpm ats:issue`: a second run binds nothing and issues nothing, and it prints an id block with a HashScan link for everything the shot list needs. Stages: `status policies investors packets verify`. Add `--plan` to print what a run would do and stop, or `pnpm demo:seed scenario` to print the shot list. Needs `DATABASE_URL`, `ADMIN_TOKEN`, `EVIDENCE_KEK` and the operator credentials. |

Both oracle commands read `data/bls` first, the snapshot of the raw BLS files committed at kick-off, which is verified against its `PROVENANCE.txt` hashes before anything is computed. That makes the published tables reproducible from a clean clone with no network and no credentials. `--source cache` reads whatever a previous live fetch left under `var/cache/bls`, and `--source api` fetches from the BLS Public Data API and caches the raw responses there. The API path works without a key, on the v1 endpoint, at 25 requests a day; set `BLS_API_KEY` in `.env` to use v2 and its higher allowance. Both paths send `BLS_CONTACT` as the User-Agent, because BLS refuses a client that does not identify itself.

### Which replay windows run

The QA gates of [docs/INDEX-SPEC.md](docs/INDEX-SPEC.md) section 8 fail closed,
and one of them, the jump gate, legitimately refuses April 2020: every white
collar group moved more than five standard deviations that month. A window
spanning it therefore cannot be replayed, and the gate is right.

The gates run over the whole window before the first message is published, so a
window that cannot finish publishes nothing at all and the command exits 1
naming the month it stopped at and the longest window that would have run. Three
windows are known to complete:

| Command | Months | Note |
| --- | --- | --- |
| `pnpm oracle:replay` | 2025-01 to the newest month | The default, and the demo window of DESIGN.md 3.4. Opens April and May 2026 on the level form. |
| `pnpm oracle:replay --from 2021-01` | 2021-01 to the newest month | The longest window that runs in one go, 67 months. |
| `pnpm oracle:replay --from 2019-01 --to 2020-03` | 15 months | Everything before the pandemic. |

`pnpm oracle:replay --from 2019-01` on its own stops at 2020-04 and tells you to
add `--to 2020-03`. The gates are not overridable: a month that fails one is not
published, because the first value published for a period settles it forever.
Add `--dry-run` to test any window without sending anything.

### Replaying against the shared testnet resources

The index topic in [docs/HEDERA.md](docs/HEDERA.md) is one topic and everybody
running this repository writes to the same one. Because the first value
published for a period settles it forever, a run reads the topic back through
the mirror node before it walks and publishes only the months that are not on
it. A clean clone that runs the demo window therefore publishes nothing and says
so: `skipped N already published`. Only a month the topic does not carry is
published, and a month the topic carries without its contract call still gets
that call, from the message on the topic.

That is the safety net rather than the plan. For a first look, run the window
with `--dry-run`, which computes, gates, signs and encodes every month and sends
nothing, and add `--interval-ms 250` so a nineteen month window takes ten
seconds instead of three minutes. Keep the real cadence for the demo.

A dry run reaches no network at all, so it does not read the topic either and
reports the whole window as published. That is the run saying what it would have
done, not a claim about the topic. The real command is the one that reports
`skipped 19 already published`.

A single workspace can be run on its own, for example `pnpm --filter @creance/index-model test`.

## Layout

Five applications, two shared packages and one Hardhat project. `apps/api` is
the integration point: it prices and binds cover, meters three of its routes
with x402, verifies World proofs, serves the claims and audit reads, and is the
only thing that talks to Postgres. `apps/web` renders every screen and reads
that API on the server. `apps/oracle` turns the published BLS series into the
index, publishes each observation to the index topic and submits it to
CoverPool, which is what opens a month for an occupation group. `apps/steward`
buys cover as an agent and `apps/adjuster` decides claims as one, and both reach
the API over HTTP like any other client. `contracts` holds CoverPool and
CollateralVault, which hold the policies, the capacity and the money. Everything
on chain is Hedera testnet, and every account, token, topic and contract id is
in [docs/HEDERA.md](docs/HEDERA.md).

    apps/web            worker, investor and admin screens, and the demo clock
    apps/web/src/app    the worker flow: / then /occupation, /amount, /verify, /pay, /home, /cover/index
    apps/web/src/app/invest  the investor overview at /invest and subscribe at /invest/subscribe
    apps/web/src/app/receipt  the receipt for one policy at /receipt/:policyId
    apps/api            quotes, binding, claims, x402 middleware, World verification
    apps/api/src/investor  the investor endpoints, which read the chain directly
    apps/oracle         BLS fetch, ODI computation, HCS publish, replay
    apps/steward        buyer agent: the decision rule, the x402 payer, the premium schedule and the HCS journal
    apps/steward/profiles  the principal profiles the agent acts for, one file each
    apps/adjuster       claims agent that decides proof of loss packets
    contracts           Hardhat project for CoverPool and CollateralVault
    contracts/ats       issuance and lifecycle of the note in the Asset Tokenization Studio
    packages/index-model  ODI maths, calibration and backtests, no chain dependencies
    data/bls            snapshot of the raw BLS source files, with their hashes
    contracts/coupons   coupon settlement and the maturity demonstration
    packages/client     API client, the x402 payer helper, Scheduled Transactions, mirror node reads, amount conversion
    packages/client/src/x402  the payer: one Hedera account key in, a fetch that completes the 402 flow out
    apps/api/src/x402   the gate: the 402, the facilitator, the payments row and the topic message
    apps/api/src/audit  the audit trail: the message shapes with no writer yet, and the read that assembles a policy's trail from the topics
    apps/api/src/world  the World path: the signed rp_context, the verify forward, and the eligibility credential it earns
    recipes/bazantic    the OpenAPI document the Bazantic gateway imports

The investor screens are desktop, 1280 wide, and they fetch on the server rather than in the browser, so the API has to be running for them to render. `pnpm dev` starts it beside the web app. The origin is `CREANCE_API_URL` and defaults to the address the API listens on, so no configuration is needed to run them locally.

The worker flow is a 390 wide mobile design, centred on canvas at a desktop width. It fetches on the server too, so the same API has to be running. All three endpoints it reads are x402 gated, so the web app pays for them: the index read, the quote and the bind are settled from the demo worker's own testnet account, whose key it derives from `HEDERA_OPERATOR_KEY` exactly as the API derives its own. Every settlement is printed in the web app's terminal with its HashScan link. Without an operator key the screens still render against an API whose gate is off (`X402_ENABLED=false`) and say so otherwise.

Buying cover writes to Hedera testnet: `/pay` settles the first month's premium, binds a real policy, mints its receipt NFT and publishes a receipt to the payments topic, and every bind commits permanent exposure against the series behind the occupation chosen. Bind at the smallest amount the slider offers when repeating the run.

The check on `/verify` is a World Selfie Check. Fill in `WORLD_APP_ID`, `WORLD_RP_ID` and `WORLD_RP_SIGNING_KEY` from the World Developer Portal and the screen runs IDKit with the `selfieCheckLegacy` preset, the signal bound to the wallet id and an `rp_context` signed by the API; the completed result goes to the API, which forwards it to World and issues the eligibility credential on the strength of it. Scan the code with the World ID Sandbox App. Leave those variables blank and the API's labelled interim issuer runs instead, which mints the same credential without a check, and the screen says so.

The same pages are also a World App Mini App. The root layout mounts `MiniKitProvider` from `@worldcoin/minikit-js`, and [src/lib/surface.ts](apps/web/src/lib/surface.ts) is the one helper that answers whether this is World App or a browser. Inside World App the same `IDKitRequestWidget` runs over the native transport with no QR code, on the same preset, the same signed `rp_context` and the same server side verify, so only the copy changes: the check is confirming rather than waiting, and a failure does not offer a second device. No MiniKit command is called anywhere, so nothing in this build touches World Chain. Set `WORLD_MINI_APP_ID` to the Developer Portal Mini App and `GET /v1/world/mini-app` answers the links that enter it: the launch link `https://world.org/mini-app?app_id=<mini_app_id>`, and the deep link that opens one occupation's index page, `https://world.org/mini-app?app_id=<mini_app_id>&path=%2Fcover%2Findex%2Fcomputer_math`, which lands on `/cover/index/<group>` and works with no session. None of the in-app behaviour has been run on a device: no Mini App is registered yet, and [docs/DECISIONS.md](docs/DECISIONS.md) under T27 says what that leaves untested.

One person holds one active cover per series. That rule is a unique index in the database and a check before the pay step, so a second purchase with the same World ID is refused before anybody is asked to pay. Selfie Check is a medium-assurance credential: World [says so itself](https://docs.world.org/world-id/credentials/11), and it means someone holding two World ID accounts could hold two covers.

Workspaces are named under the `@creance` scope. Every one of them extends [tsconfig.base.json](tsconfig.base.json), which sets TypeScript to strict.

The API's schema is plain SQL under `apps/api/migrations`, applied in name order and recorded in `schema_migrations`. It is deliberately not owned by an ORM: the index oracle writes `observations`, `runs` and `source_files` in the same database, so the schema has to be readable by something that is not the API process.

Solidity sources belong in `contracts/contracts`, which is where Hardhat looks by default. [contracts/hardhat.config.ts](contracts/hardhat.config.ts) configures two networks and no others: the local in process chain for unit tests, and Hedera testnet through the Hashio JSON-RPC relay. The deploy key is read from the environment, so an empty environment simply leaves the account list empty.

## Payment flow

Three endpoints are paid per call, with the [x402 protocol](https://docs.x402.org)
version 2 over the `exact` scheme on `hedera:testnet`, settled through the
[Blocky402](https://blocky402.com/docs/testnet/) testnet facilitator.

| Endpoint | Price |
| --- | --- |
| `GET /v1/index/:group` | 0.01 TUSD, per call |
| `POST /v1/quote` | 0.05 TUSD |
| `POST /v1/bind` | the first month premium from the quote |
| `GET /v1/policy/:id`, `GET /v1/audit/:id` and everything else | free |

TUSD is this build's settlement token, [0.0.10366463](https://hashscan.io/testnet/token/0.0.10366463),
six decimals, so 0.01 is `10000` on the wire. Every amount in the protocol is an
integer string in the token's smallest unit.

Step by step, which is exactly what `pnpm test:testnet` runs:

1. **The call arrives with no payment.** The API answers `402 Payment Required`
   with a `PAYMENT-REQUIRED` header carrying base64 of the requirements: the
   scheme, the network, the amount, the token, the account to pay
   ([0.0.10366450](https://hashscan.io/testnet/account/0.0.10366450)), and the
   facilitator's own fee payer account
   ([0.0.7162784](https://hashscan.io/testnet/account/0.0.7162784)). The body is
   the same `application/problem+json` document every other refusal returns,
   with the price repeated in a readable form. The fee payer is not configured
   anywhere: the API reads it from the facilitator's `GET /supported` at
   startup, so a rotation on their side needs no change here.

2. **The payer builds a transfer.** `createX402Payer` in
   [packages/client](packages/client/src/x402/payer.ts) takes a Hedera account
   id and its ECDSA key and returns a `fetch`. On a 402 it builds a
   `TransferTransaction` moving exactly the advertised amount from the payer to
   `payTo`, sets the transaction id to one generated for the facilitator's fee
   payer, freezes it, signs it with the payer's key alone and retries the
   request with the serialised bytes in a `PAYMENT-SIGNATURE` header. It never
   touches `Authorization`, which is where `POST /v1/bind` carries the
   eligibility credential.

3. **The API verifies before it does the work.** It sends the payment and the
   requirements to the facilitator's `POST /verify`, which decodes the
   transaction, checks it is a bare transfer of the right token for the right
   amount to the right account, checks the payer's signature against the
   account's on-chain key, and checks the payer's balance and association. A
   refusal is a 402 with the reason and no work done.

4. **The handler runs.** The index is read, or the quote is priced, or the
   policy is bound: the receipt is published, `CoverPool.bind` is called and the
   policy NFT is minted.

5. **The API settles after the work.** It sends the same payment to `POST
   /settle`. The facilitator adds the fee payer signature and submits, so the
   network fee is paid by the facilitator and not by either party, and waits for
   consensus. The settlement receipt goes back to the caller in a
   `PAYMENT-RESPONSE` header. Settling last is what makes a bind that reverts
   free: no handler, no payment.

6. **The settlement is written down twice.** A `payments` row records the
   endpoint, the payer, the amount, the asset and the facilitator's transaction
   id, and the same facts go to the payments topic
   [0.0.10366471](https://hashscan.io/testnet/topic/0.0.10366471) as a
   `kind: "settlement"` message, so the audit trail can be checked on chain
   without asking us. `POST /v1/bind` settles the row it already wrote at
   `uncollected` rather than writing a second one.

Months two onwards are not x402. The premium schedule is Scheduled
Transactions, because the Hedera exact scheme requires a bare
`TransferTransaction` and forbids one wrapped in a `ScheduleCreateTransaction`.
The first premium is the paid request; the rest are pre-signed schedules.

One run of `pnpm test:testnet` on 5 September 2026, from the demo Steward
account [0.0.10366451](https://hashscan.io/testnet/account/0.0.10366451):

| What | Settlement |
| --- | --- |
| `GET /v1/index/computer_math`, 0.01 TUSD | [0.0.7162784-1788602390-475160190](https://hashscan.io/testnet/transaction/0.0.7162784-1788602390-475160190) |
| `POST /v1/quote`, 0.05 TUSD | [0.0.7162784-1788602392-809335465](https://hashscan.io/testnet/transaction/0.0.7162784-1788602392-809335465) |
| `POST /v1/bind`, the first premium of 0.841667 TUSD | [0.0.7162784-1788602397-120605122](https://hashscan.io/testnet/transaction/0.0.7162784-1788602397-120605122) |

Each one is a transfer of TUSD from 0.0.10366451 to 0.0.10366450 whose network
fee was paid by 0.0.7162784, and each is on the payments topic at sequence 16,
17 and 20.

## The Steward agent

`pnpm steward:run` is one cycle of the agent in [apps/steward](apps/steward),
acting for one principal. DESIGN.md 3.7 gives the loop and this is it in order:
read the principal's profile, pay for the index, decide by a written rule,
quote, bind with the first premium over x402, create the premium schedule, and
write a journal entry to the agent-journal topic
[0.0.10366475](https://hashscan.io/testnet/topic/0.0.10366475). The API has to
be running with the gate on; the agent pays every metered call from its own
testnet account [0.0.10366451](https://hashscan.io/testnet/account/0.0.10366451)
and needs enough of the settlement token for the index read, the quote and the
premiums.

The profile is committed and carries no secret: the occupation group, the
principal's wallet, the cover limit and where the eligibility credential comes
from. The default is
[apps/steward/profiles/policyholder-2.json](apps/steward/profiles/policyholder-2.json);
`STEWARD_PROFILE` points at another. The agent never performs the Selfie Check.
It binds by presenting a credential issued to its principal, and the policy NFT
is minted to the principal's wallet, not to the agent's.

The credential has two sources and the profile names which one this principal
uses. A credential the principal earned at `POST /v1/world/verify` is a real
Selfie Check, done on a phone by a person; the agent only carries it. The
default demo profile instead asks the API's interim issuer at
`POST /v1/demo/eligibility`, because an agent has no camera and a headless run
cannot produce a proof of personhood. The run prints which one it used in plain
words, and the interim one says on its own line that it is not a World check.

The rule, written down. Buy when there is no cover in force and the three month
ODI trend is rising, or when the term is inside its last 30 days. The trend is
the ODI at the vantage month and the two months before it, all three consecutive
calendar months with a published value, and it is rising when the three are
strictly increasing. The vantage is the newest published month unless `--as-of`
gives an earlier one, which is the same labelled replay the demo clock uses. The
rule is one pure function, its inputs and its result are printed in the run and
published in the journal entry, and a cycle that decides to hold still journals
and still exits 0.

That is what a run on live data usually does. The three month trend at the
newest published month has not been rising in recent readings, so `pnpm
steward:run` on its own pays for the index, prints the three months it read,
journals a hold and stops before the quote. Nothing is wrong with that run: it
is the rule working. To watch the buy path, put the vantage on a month whose
trend does rise, which is the same labelled replay the demo clock uses:

    pnpm steward:run --as-of 2025-05 --cadence demo

The journal entry records `replay: true` for such a cycle, so a reader can tell
a labelled vantage from a live one.

Months two onwards are not x402. The Hedera exact scheme requires a bare
`TransferTransaction` and forbids one wrapped in a `ScheduleCreateTransaction`,
so the first premium is the paid request and the rest are Scheduled Transactions
the agent creates and pre-signs itself, one per month, each held until its due
date and each carrying an admin key so a lapsed policy can stop them. A schedule
may not expire more than 62 days after it is created, so at the real monthly
cadence the third premium does not fit and is left to the watcher, which creates
each following month when one executes. `--cadence demo` runs the same code with
the due dates seconds apart, so a whole chain is visible inside one run.

A full run against testnet, with every link, is in
[docs/demo/steward.txt](docs/demo/steward.txt).

## Tokenization

The premiums are funded by investors who buy the series as a security. The
Displacement Bond Note is issued through the [Asset Tokenization
Studio](https://github.com/hashgraph/asset-tokenization-studio) release 8.0.0 as
a Bond with the ERC-3643 configuration: an identity registry, a KYC list of
investor accounts, transfer restrictions, and pause and freeze roles. The demo
note is contract
[0.0.10368240](https://hashscan.io/testnet/contract/0.0.10368240) and every
transaction behind the steps below is linked in [docs/ATS.md](docs/ATS.md).

Three commands, in this order. Each one is idempotent: run it again and it reads
the chain, finds the work done and does nothing, so a judge repeating a step
sees `nothing to do` rather than a second issuance.

    pnpm ats:issue        issuance, roles, the credential issuer, KYC, mints,
                          a blocked then an allowed transfer, pause, freeze
                          and the first declared coupon
    pnpm coupons:pay      the declared coupon settled to each holder by a
                          Scheduled Transaction, then published to the
                          payments topic
    pnpm coupons:mature   a maturity redemption, on a short dated series
                          opened for it because the demo series matures in 2027

Each command takes a stage name to run one step on its own, which is what to use
when watching a single operation rather than the whole sequence.
`pnpm ats:issue status` prints where the series has got to and sends nothing;
the stage lists are in [Commands](#commands) above.

What each step proves, and where the evidence is:

| Step | What it demonstrates | Links |
| --- | --- | --- |
| `issue` | The security exists on testnet with its coupon schedule configured | [docs/ATS.md](docs/ATS.md), "The run through" step 2 |
| `kyc1`, `mint1`, `kyc2`, `mint2` | The identity registry gates who may hold the note | [docs/HEDERA.md](docs/HEDERA.md), "The compliance demonstration" |
| `blocked` then `allowed` | The same transfer fails compliance and then succeeds after a KYC grant | [docs/HEDERA.md](docs/HEDERA.md), "The compliance demonstration" |
| `controls` | Pause and freeze, the two roles a regulated issuer needs | [docs/HEDERA.md](docs/HEDERA.md), "The compliance demonstration" |
| `coupon`, then `pnpm coupons:pay` | A coupon distribution paid by Scheduled Transaction, with the settlement on the payments topic | [docs/HEDERA.md](docs/HEDERA.md), "The first coupon" |
| `pnpm coupons:mature` | Redemption at maturity: the holding is burned through ATS and the principal returns from the vault | [docs/HEDERA.md](docs/HEDERA.md), "The maturity demonstration" |

The principal at risk logic is ours, not ATS's: the CollateralVault holds the
subscribed principal and the CoverPool reserves against it when a month opens,
pays approved claims out of the reserve and returns the remainder when the claim
window closes. That is why a paid claim lowers noteholder principal. Both
contracts are verified on HashScan and their addresses are in
[docs/HEDERA.md](docs/HEDERA.md).

## Claims

A payout needs two keys. The index key is the group's index being open, which
CoverPool decides and stores. The loss key is an approved proof of loss, and this
is how one is submitted.

    POST /v1/world/rp-context   purpose: claim, signal: the policy id
    POST /v1/world/verify       purpose: claim, and a claim credential comes back
    POST /v1/claims             the packet: the attestation, the documents, the statement
    GET  /v1/claims/{claimId}   the claimant's own status, free and carrying nothing personal

The packet is the four parts of DESIGN.md 3.9. A fresh Selfie Check with
`require_user_presence` on the claim action, bound to the policy id as its
signal, which earns a short lived credential in its own audience. An attestation
signed by the wallet that holds the cover, naming the employer, the job title,
the occupation, the last day of work and how it ended, ending with the sentence
the person ticks: "Everything here is true. I understand that a false claim is
fraud." At least one document, encrypted at rest, with only its SHA-256 reaching
the claims topic. And the statement itself, recorded as accepted or not.

The endpoint enforces the identity leg and nothing below it: a live person check
was completed, the check was made for the claim action, the cover is open for
claims, and no earlier claim exists for this person in this series. Everything
else is adjudication, and adjudication produces a decision with a reason a person
can act on rather than a validation error they cannot. So a resignation is
accepted here and declined by the Adjuster a second later, with a record and a
hash on a public topic.

The claims topic's submit key is the adjuster account's, so the API writes the
packet hash into the row and the Adjuster puts it on the topic at the start of
its next pass, before it decides anything. A packet hash on the topic, then the
decision hash that answers it, then a payout that references both.

**On approve, the payout runs in the same request.** The API asks CoverPool what
the claim pays, signs an EIP-712 authorisation over the policy id, the claim id,
the nullifier, the packet hash, the decision hash, the payee, the amount, the
separation timestamp and a thirty minute deadline, and calls `payClaim`. The
money moves inside that call or not at all. The authorisation is stored first, so
a payout that reverts for an environmental reason can be retried by anybody with
the same signature until its deadline, and the whole step is idempotent on the
transaction id.

**On decline, the reasons come back.** There is no chain call at all: a decline
is a hash on the claims topic and reasons in the claimant's own answer.

**When claims are not open**, the API says so with the current reading, read from
the chain rather than from a cached row:

    Claims aren't open.
    Your occupation is 1.20 better than average. Claims open within 0.68 of
    average. We'll tell you here if that changes.

### One person, one claim, and what our configuration costs that

Purchase and claim run two registered World actions here,
`occupation-cover-eligibility` and `occupation-cover-claim`. A nullifier is
scoped to the app and the action, so the same person gets a different number at
each step and the claim's check cannot be compared with the purchase's.

So the sentence this build is entitled to is the weaker one: **both were live
people, the claimant controls the wallet that holds the cover, and one person
claims once.** The wallet leg is real, because the attestation is signed by the
policy's own EVM address and the API recovers it. One claim per person per
series is enforced on the claim's own nullifier, with its own unique index.

Setting `WORLD_ACTION_ELIGIBILITY` and `WORLD_ACTION_CLAIM` to a single
registered action makes the two nullifiers identical and restores the stronger
sentence, "the same live person bought the cover and collects it", with no code
change. `GET /healthz` reports `world.continuity`, which says which of the two is
running. See [docs/DECISIONS.md](docs/DECISIONS.md) under T11 and T13.

The claim's camera check cannot be automated, so a labelled demo path,
`POST /v1/demo/claim-presence`, sits behind `DEMO_ELIGIBILITY_ISSUER` for the
scripts and the seed. It says what it is in its own response and the credential
it mints records `credential: demo-issuer`, so nothing downstream can claim a
camera ran when one did not.

One payout and one decline are on testnet, with every link, in
[docs/HEDERA.md](docs/HEDERA.md).

### The screens a person claims through

    /home              the cover, and "Start a claim" when the index is open
    /claim             what the cover pays for and what it does not
    /claim/job         employer, job title, last day of work, how it ended
    /claim/proof       the documents, one is enough
    /claim/confirm     the live person check
    /claim/review      every answer, the statement, and submit
    /claim/status      the answer when it arrives, and the reasons if it is no

Every call is made on the server, so the claim credential never reaches the
browser and the attestation is signed there with the key of the account the
cover was bound to. The files live in the web process between the upload screen
and the packet, and go no further: the API is where they are sealed.

Home carries the state of the cover: Covered, Claims open when the chain says
the series is open, Claim in progress while one is being decided, Paid out with
the amount received and a receipt, and Payment due when a premium has been
missed. A lapse, a failed payment and an offline browser have no server path to
force, so `WEB_DEMO_STATES=true` turns on `/home?demo=lapsed` and its five
siblings, which render from fixtures and say so on the screen.

## The review queue

Referred claims are reviewed at `/admin/claims`, a desktop screen that lists
each one with the Adjuster's reasons, the evidence fingerprints and the
statement behind it, and approves or declines through the endpoints below. A
decline asks for one plain sentence, because that sentence is what the person
reads.

The screen asks for the reviewer token before it shows anything. It is the same
`ADMIN_TOKEN` the API compares, typed once and exchanged for an opaque session
id in an httpOnly cookie; the token never reaches the browser. Approving moves
settlement funds, so the decide action checks that session before it calls the
API, not only the page that renders the button. "Sign out" ends it, and a
restart of the web server ends every session.

A claim needs two keys: the index has to be open for the occupation, and the
person has to show they lost their job. The second key is adjudicated. The
Adjuster reads the packet, checks it against the cover and the index, and either
decides the claim or hands it to a person, and the whole of it is in
[docs/CLAIMS.md](docs/CLAIMS.md).

The model extracts and the code decides. A vision-capable model reads one
document at a time and returns a closed record of what that document says. It
never sees the statement the person signed, it has no field in which to express
an opinion about the claim, and every rule outcome, the amount and the confidence
are computed afterwards in TypeScript from the cover, the frozen series terms and
the open months read off CoverPool. That is what makes an adjudication
reproducible from a fixture with no network, and explicable line by line when
somebody asks why a claim was declined.

A claim auto-approves only when every rule passes, the confidence reaches the
series threshold and the amount is within the series auto-approval limit.
Otherwise it refers, and a person works it from the queue:

    GET  /v1/admin/claims?status=under_review     the queue, with no personal data on it
    GET  /v1/admin/claims/{id}                    the review screen in one request
    GET  /v1/admin/claims/{id}/evidence/{id}      one decrypted document
    POST /v1/admin/claims/{id}/decide             approve or decline, with one sentence

All four are behind `ADMIN_TOKEN`, compared in constant time. Nothing decides a
claim by running out of time: an overdue claim is flagged and sorted to the top,
and that is all. A reviewer is not bound by the confidence threshold, because a
person reading the document is a better signal than a number computed about it,
and is bound by the hard rules: nobody approves a resignation, and the API
refuses it as well as the screen.

The reasons a person reads are written for them. "Resigning isn't covered. This
cover pays when your employer ends your job." A decline always says either what
would change the answer or why nothing would.

The decision record carries the decision, the reasons as codes, the confidence
with every component of it, the evidence fingerprints and the result of every
rule. It carries no name, no employer, no job title and no file name, which is a
design rule rather than an accident: its SHA-256 goes on a public topic forever,
so the answer to "show me the thing behind the hash" should be "here it is".
Only the hash, the two ids and the decision word are published. The first one is
on the claims topic at sequence 1; the links are in
[docs/HEDERA.md](docs/HEDERA.md).

Two synthetic packets are committed under `apps/adjuster/fixtures`, with invented
employers and documents rendered by a script. One is a clean redundancy that
auto-approves at a confidence of 0.940; one is a resignation that is declined in
under a second, without the document ever being read. Both are asserted by
`pnpm test`.

## Demo

    pnpm api:migrate
    pnpm demo:seed

That is the whole setup. It binds the two policies the two claim packets are
claimed on, leaves the note and the noteholder positions where they already are,
checks both letters against the cover they will be claimed on, and prints an id
block with a HashScan link for every id the demonstration needs. Run it twice: a
second run should bind nothing, which is the run that matters on the day.

[docs/DEMO.md](docs/DEMO.md) is the shot list: nine shots with their timings,
the command for each, what has to be true before it and what has to be legible
on screen, plus the recording procedure and the Bazantic screen recording. The
same sequence is committed as data and printed by `pnpm demo:seed scenario`.

Two things in it are worth knowing before you run anything. The demonstration
opens May 2026 live on camera, and a month can only be submitted once, so
`pnpm demo:seed status` reports whether it is still in hand and never spends it.
And the claim window on the demo series runs to 5 October 2026, so `closeWindow`
cannot execute on it inside the event; `pnpm --filter @creance/contracts
demo:release` shows the release for real on a series opened for the purpose with
its claim window measured in seconds, and the shot list says so out loud rather
than working around it.

## Audit trail

`GET /v1/audit/:policyId` is the trail for one policy, and it is free. The
database holds the sequence numbers of the messages and the mirror node holds
the messages themselves, so what comes back is what is on the topics rather
than what our rows say. Every entry carries its topic, its sequence number, its
transaction and a HashScan link, and says which of the two it came from: an
entry the topic does not carry is marked rather than shown as recorded. Nothing
in the response identifies a person.

The receipt screen at `/receipt/:policyId` in the web app is that endpoint,
rendered. The measured run through and the links are in
[docs/HEDERA.md](docs/HEDERA.md), section "Audit trail".

## Health

    curl -s http://127.0.0.1:3210/health

`GET /health` is what a judge, an uptime check and a deploy script all read. It
returns the commit the running build came from, whether Postgres, Hedera, the
index and World are configured, and the oracle's run state, so one call says
which code is live and whether the demo clock is walking. `GET /healthz` is the
same handler under the path that shipped first. Neither is behind the x402 gate.

The commit is `GIT_SHA`, baked into the image as a build argument and never set
at runtime, so what comes back is the commit the running image was built from
rather than the commit whoever deployed it happened to be standing on. Those are
the same after a normal deploy and differ after a deploy that skipped the build,
which is the case worth catching. Run from a clone with `pnpm dev` there is no
image and the endpoint says `unknown`; that is correct rather than broken,
because a working tree has no single commit.

## Deployment

Everything above runs from a clone with no containers, and that stays the
shortest path. For the public deployment there are three OCI images and a
compose file:

    CREANCE_GIT_SHA="$(git rev-parse HEAD)" docker compose up -d --build --force-recreate
    curl -s http://127.0.0.1:3210/health

`compose.yaml` runs Postgres, the API, the web app and the index oracle. The
API and the web app are published on 127.0.0.1 only; on a public host
[deploy/Caddyfile](deploy/Caddyfile) terminates TLS and routes `/v1/*`,
`/health`, `/healthz` and `/.well-known/jwks.json` to the API and everything
else to the web app, so both live on one origin.
[deploy/deploy.sh](deploy/deploy.sh) is the wrapper that builds with the current
commit and refuses to finish until `GET /health` returns it. The host
requirements and the steps are in [deploy/README.md](deploy/README.md).

`podman compose` runs the same files: the images are plain OCI and the compose
file uses no runtime-specific keys.

## Continuous integration

[.github/workflows/ci.yml](.github/workflows/ci.yml) installs with a frozen lockfile, then runs lint, typecheck and test on every pull request. It resolves pnpm from the `packageManager` field rather than pinning a version in the workflow, so the pnpm that installs is always the one that wrote the lockfile.

[.github/workflows/uptime.yml](.github/workflows/uptime.yml) checks `GET /health` on the public host every fifteen minutes and fails on anything but a 200 carrying a commit. It reads the repository variable `PUBLIC_SITE_URL` and does nothing when it is unset, so it is green before a host exists.

## Disclosure

This is a testnet prototype built during a hackathon. It is not an offer of insurance or of securities in any jurisdiction, it is not regulated advice, and no real funds are involved at any point. The occupation index is computed from public statistics for demonstration only.

## Licence

MIT. See [LICENSE](LICENSE).
