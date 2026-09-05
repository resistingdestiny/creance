# Creance

Workers buy monthly parametric cover against their occupation being displaced, and investors fund the payouts by buying Displacement Bond Notes that earn the premiums as coupons. A public occupation index computed from official labour statistics decides when claims open, and a claim pays only when the claimant can also show they lost their job.

Everything runs on Hedera testnet. There is no mainnet path and no real money anywhere in this repository.

## Status

This is the scaffold. Every workspace is in place with a placeholder test, and every command listed below exists but prints what it will do instead of doing it. Later tickets fill in the bodies one at a time.

## Requirements

- Node 22 or later
- pnpm 11.25.0, which is pinned by the `packageManager` field in [package.json](package.json). Run `corepack enable` and pnpm will match it.

## Setup

    pnpm install
    cp .env.example .env

Then fill in the blanks in `.env`. Every variable is listed with a one line comment in [.env.example](.env.example). Nothing in the scaffold needs credentials, so `pnpm test` works before you fill anything in. `.env` is ignored by git and must never be committed.

## Commands

Run all of these from the repository root.

| Command | What it does |
| --- | --- |
| `pnpm test` | Runs every unit test in every workspace. Chain free, no credentials needed. |
| `pnpm test:testnet` | Runs the integration tests against Hedera testnet. Needs `.env`. |
| `pnpm dev` | Runs the web app on http://localhost:3000. The component gallery, which is the design review surface, is at http://localhost:3000/gallery. The investor screens are at http://localhost:3000/invest and http://localhost:3000/invest/subscribe, and they read the API, so run `pnpm api:dev` beside this. The API joins this command in T07. |
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
| `pnpm api:dev` | Runs the investor endpoints locally on port 3210: `GET /v1/series/:id` and `GET /v1/series/:id/coupons`, reading Hedera testnet. |
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
    packages/client     API client, Scheduled Transactions and amount conversion

The investor screens are desktop, 1280 wide, and they fetch on the server rather than in the browser, so `pnpm api:dev` has to be running beside `pnpm dev` for them to render. The origin is `CREANCE_API_URL` and defaults to the address `pnpm api:dev` listens on, so no configuration is needed to run them locally.

Workspaces are named under the `@creance` scope. Every one of them extends [tsconfig.base.json](tsconfig.base.json), which sets TypeScript to strict.

Solidity sources belong in `contracts/contracts`, which is where Hardhat looks by default. [contracts/hardhat.config.ts](contracts/hardhat.config.ts) configures two networks and no others: the local in process chain for unit tests, and Hedera testnet through the Hashio JSON-RPC relay. The deploy key is read from the environment, so an empty environment simply leaves the account list empty.

## Continuous integration

[.github/workflows/ci.yml](.github/workflows/ci.yml) installs with a frozen lockfile, then runs lint, typecheck and test on every pull request. It resolves pnpm from the `packageManager` field rather than pinning a version in the workflow, so the pnpm that installs is always the one that wrote the lockfile.

## Disclosure

This is a testnet prototype built during a hackathon. It is not an offer of insurance or of securities in any jurisdiction, it is not regulated advice, and no real funds are involved at any point. The occupation index is computed from public statistics for demonstration only.

## Licence

MIT. See [LICENSE](LICENSE).
