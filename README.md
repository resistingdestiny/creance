# Creance

Workers buy monthly parametric cover against their occupation being displaced, and investors fund the payouts by buying Displacement Bond Notes that earn the premiums as coupons. A public occupation index computed from official labour statistics decides when claims open, and a claim pays only when the claimant can also show they lost their job.

Everything runs on Hedera testnet. There is no mainnet path and no real money anywhere in this repository.

## Status

Being built. The contracts, the note series, the coupon and maturity runs, the index model, the API and the investor screens are live on Hedera testnet; the API's three metered endpoints are gated with x402 and settle through Blocky402. The oracle, the Steward and the Adjuster commands still print what they will do instead of doing it, and later tickets fill them in one at a time.

## Requirements

- Node 22 or later
- pnpm 11.25.0, which is pinned by the `packageManager` field in [package.json](package.json). Run `corepack enable` and pnpm will match it.
- PostgreSQL 14 or later, for the API. Only the API needs it, and only when it runs: `pnpm test` has no database.

## Setup

    pnpm install
    cp .env.example .env

Then fill in the blanks in `.env`. Every variable is listed with a one line comment in [.env.example](.env.example). Nothing in the scaffold needs credentials, so `pnpm test` works before you fill anything in. `.env` is ignored by git and must never be committed.

For the API, point `DATABASE_URL` at a PostgreSQL database you can write to and create the schema:

    createdb creance
    pnpm api:migrate

`pnpm api:migrate` applies the migrations under `apps/api/migrations` and seeds the fifteen occupation groups. It is idempotent: running it again prints `nothing to do`. The API also runs it at boot, so a first `pnpm dev` after `createdb` is enough.

## Commands

Run all of these from the repository root.

| Command | What it does |
| --- | --- |
| `pnpm test` | Runs every unit test in every workspace. Chain free, no credentials needed. |
| `pnpm test:testnet` | Runs the integration tests against Hedera testnet: the contract lifecycle run through, one policy bound end to end through the API, one paid request of each kind through the x402 gate, then that policy's audit trail read back off the payments topic. Needs credentials and a database. |
| `pnpm dev` | Runs the web app on http://localhost:3000 and the API on http://localhost:3210, together. The component gallery, which is the design review surface, is at http://localhost:3000/gallery. The investor screens are at http://localhost:3000/invest and http://localhost:3000/invest/subscribe, and the receipt for a policy is at http://localhost:3000/receipt/:policyId. All of them read the API. |
| `pnpm lint` | Runs eslint across the repository. |
| `pnpm typecheck` | Runs the TypeScript compiler in every workspace without emitting. |
| `pnpm oracle:once` | One live run. Pulls the sixteen BLS series, computes both trigger forms for every bindable group, runs the QA gates of [docs/INDEX-SPEC.md](docs/INDEX-SPEC.md) section 8, publishes one signed observation per group to the index topic, and submits the groups that have a cover series registered in CoverPool. Options: `--period YYYY-MM` (defaults to the newest month the source carries), `--source archive\|cache\|api` (defaults to `api`, the live path), `--series LABEL` to publish one group only, `--no-submit` to publish without a contract call, and `--dry-run` to compute, gate, sign and encode everything and send nothing. |
| `pnpm oracle:replay` | The demo clock. Replays real historical months for one cover series at one month per ten seconds, publishing and submitting exactly as the live path does, and writes the run state the API serves so the web app can show the REPLAY badge. Options: `--from YYYY-MM` (defaults to `2025-01`), `--to YYYY-MM`, `--series LABEL` (defaults to the demo series), `--interval-ms N` (defaults to 10000), `--source archive\|cache\|api` (defaults to `archive`, which covers the whole window with no BLS call), `--scenario NAME` for a labelled synthetic trigger from `apps/oracle/scenarios`, `--no-submit` and `--dry-run`. A scenario never writes the index topic and never calls the contract. Not every window can be replayed: see the note below. |
| `pnpm oracle:preflight` | Reads every precondition a real run depends on and prints it, sending nothing: the oracle's HBAR balance, the index topic and how many messages it already carries, and each series' status, `activeExposure`, reserve and last observed month. Run it before a testnet replay. |
| `pnpm oracle:verify` | Reads the index topic back through the mirror node and checks every message: that it is canonical JSON and that the signature recovers to the oracle's address. Public data only. Options: `--topic 0.0.x`, `--signer 0x...`. |
| `pnpm oracle:backtest` | Prints the open months per occupation group from January 2010 to the newest month the source carries, at the frozen per series attachment and level line, then the same window at the generic attachment of 2.0, a check that every series reproduces its frozen parameters from that source, and the empirical hazard on the distance to the level line. Options: `--from YYYY-MM`, `--source archive\|cache\|api`. |
| `pnpm oracle:backfill` | Computes the whole index history, settles nothing, and regenerates [docs/INDEX.md](docs/INDEX.md) from it. `pnpm oracle:backfill --from 2000-01` builds the full history. Options: `--from YYYY-MM`, `--source archive\|cache\|api`, `--out PATH`, and `--check` to regenerate and compare without writing. Deterministic: two runs over the same source produce a byte identical file. |
| `pnpm oracle:schedule` | Runs the daily index check and pipeline with QA gates and alerts. |
| `pnpm steward:run` | Runs one Steward cycle for the configured principal. |
| `pnpm adjuster:run` | Decides the pending claims once. |
| `pnpm contracts:deploy` | Deploys CoverPool and CollateralVault to Hedera testnet and verifies them. |
| `pnpm hedera:setup` | Creates the day 0 Hedera testnet accounts, tokens and topics, and writes [docs/HEDERA.md](docs/HEDERA.md). Idempotent: run it again and it creates nothing. Needs the operator credentials in the local environment file. Add `--plan` to print what it would do and stop. |
| `pnpm hedera:schedule` | Runs the Scheduled Transactions spike against testnet: measures the expiry window, executes a scheduled premium transfer and chains the next month. Writes to testnet and costs fees. Stages: `bisect past immediate future chain`. |
| `pnpm ats:issue` | Issues the demo Displacement Bond Note series as an Asset Tokenization Studio bond on Hedera testnet and runs the compliance sequence: roles, the credential issuer, a KYC grant per noteholder, the mints, a blocked then allowed transfer, pause, freeze and the first coupon. Idempotent: run it again and it does nothing. The run through with a link for every transaction is [docs/ATS.md](docs/ATS.md). Stages: `status throwaway issue roles issuer kyc1 mint1 blocked kyc2 allowed mint2 controls coupon couponcheck verify`. |
| `pnpm coupons:pay` | Settles a declared coupon on Hedera testnet: seeds the premium account, subscribes the noteholders in the vault, pays each holder with a Scheduled Transaction carrying the vault's `fundCoupon` call, and publishes each settlement to the payments topic. Idempotent: run it again and it does nothing. The run through is [docs/ATS.md](docs/ATS.md) section 14. Stages: `status fund probe seed subscribe pay publish verify`. |
| `pnpm coupons:mature` | Runs a maturity redemption on Hedera testnet, on a short dated series opened for the purpose because the demo series matures in 2027: opens the series and a matching note, subscribes both noteholders, waits, then burns each holding through ATS and returns the principal from the vault. Stages: `status fund open bond subscribe wait redeem payout`. |
| `pnpm api:dev` | Runs the API alone on port 3210, reading Hedera testnet and the local database. Endpoints: `POST /v1/quote`, `POST /v1/bind`, `GET /v1/policy/:id`, `GET /v1/audit/:id`, `GET /v1/index/:group`, `GET /v1/series/:id`, `GET /v1/series/:id/coupons`, `GET /v1/replay`, `GET /healthz` and `GET /.well-known/jwks.json`. The index, quote and bind routes are paid: see [Payment flow](#payment-flow). `GET /v1/replay` is the oracle's run state, which is what puts the REPLAY badge on the web app; it sits outside `/v1/index/` because everything under that prefix is metered. Set `PORT` to move it, and `X402_ENABLED=false` to serve them open. |
| `pnpm api:migrate` | Creates the API schema and seeds the fifteen occupation groups. Idempotent. |
| `pnpm api:openapi` | Regenerates [recipes/bazantic/openapi.yaml](recipes/bazantic/openapi.yaml) and the JSON beside it from the routes. A test fails if the committed files differ. |
| `pnpm demo:seed` | Seeds the demo series, policyholders, investors and claim packets. |

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

A single workspace can be run on its own, for example `pnpm --filter @creance/index-model test`.

## Layout

    apps/web            worker, investor and admin screens, and the demo clock
    apps/web/src/app/invest  the investor overview at /invest and subscribe at /invest/subscribe
    apps/web/src/app/receipt  the receipt for one policy at /receipt/:policyId
    apps/api            quotes, binding, claims, x402 middleware, World verification
    apps/api/src/investor  the investor endpoints, which read the chain directly
    apps/oracle         BLS fetch, ODI computation, HCS publish, replay
    apps/steward        buyer agent that pays for cover over x402
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
    recipes/bazantic    the OpenAPI document the Bazantic gateway imports

The investor screens are desktop, 1280 wide, and they fetch on the server rather than in the browser, so the API has to be running for them to render. `pnpm dev` starts it beside the web app. The origin is `CREANCE_API_URL` and defaults to the address the API listens on, so no configuration is needed to run them locally.

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

## Continuous integration

[.github/workflows/ci.yml](.github/workflows/ci.yml) installs with a frozen lockfile, then runs lint, typecheck and test on every pull request. It resolves pnpm from the `packageManager` field rather than pinning a version in the workflow, so the pnpm that installs is always the one that wrote the lockfile.

## Disclosure

This is a testnet prototype built during a hackathon. It is not an offer of insurance or of securities in any jurisdiction, it is not regulated advice, and no real funds are involved at any point. The occupation index is computed from public statistics for demonstration only.

## Licence

MIT. See [LICENSE](LICENSE).
