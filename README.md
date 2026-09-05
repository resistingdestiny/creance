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
| `pnpm oracle:once` | Pulls BLS data, computes the ODI and publishes one observation to HCS. |
| `pnpm oracle:replay` | Replays the demo clock from a start month. |
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

A single workspace can be run on its own, for example `pnpm --filter @creance/index-model test`.

## Layout

    apps/web            worker, investor and admin screens, and the demo clock
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

Workspaces are named under the `@creance` scope. Every one of them extends [tsconfig.base.json](tsconfig.base.json), which sets TypeScript to strict.

Solidity sources belong in `contracts/contracts`, which is where Hardhat looks by default. [contracts/hardhat.config.ts](contracts/hardhat.config.ts) configures two networks and no others: the local in process chain for unit tests, and Hedera testnet through the Hashio JSON-RPC relay. The deploy key is read from the environment, so an empty environment simply leaves the account list empty.

## Continuous integration

[.github/workflows/ci.yml](.github/workflows/ci.yml) installs with a frozen lockfile, then runs lint, typecheck and test on every pull request. It resolves pnpm from the `packageManager` field rather than pinning a version in the workflow, so the pnpm that installs is always the one that wrote the lockfile.

## Disclosure

This is a testnet prototype built during a hackathon. It is not an offer of insurance or of securities in any jurisdiction, it is not regulated advice, and no real funds are involved at any point. The occupation index is computed from public statistics for demonstration only.

## Licence

MIT. See [LICENSE](LICENSE).
