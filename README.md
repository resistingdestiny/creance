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
| `pnpm dev` | Runs the web app on http://localhost:3000. The component gallery, which is the design review surface, is at http://localhost:3000/gallery. The API joins this command in T07. |
| `pnpm lint` | Runs eslint across the repository. |
| `pnpm typecheck` | Runs the TypeScript compiler in every workspace without emitting. |
| `pnpm oracle:once` | Pulls BLS data, computes the ODI and publishes one observation to HCS. |
| `pnpm oracle:replay` | Replays the demo clock from a start month. |
| `pnpm oracle:backtest` | Prints the backtest table per occupation group from 2010. |
| `pnpm oracle:backfill` | Loads the full index history from the archived BLS files. |
| `pnpm oracle:schedule` | Runs the daily index check and pipeline with QA gates and alerts. |
| `pnpm steward:run` | Runs one Steward cycle for the configured principal. |
| `pnpm adjuster:run` | Decides the pending claims once. |
| `pnpm contracts:deploy` | Deploys CoverPool and CollateralVault to Hedera testnet and verifies them. |
| `pnpm hedera:setup` | Creates the day 0 Hedera testnet accounts, tokens and topics, and writes [docs/HEDERA.md](docs/HEDERA.md). Idempotent: run it again and it creates nothing. Needs the operator credentials in the local environment file. Add `--plan` to print what it would do and stop. |
| `pnpm ats:issue` | Issues the demo Displacement Bond Note series through the ATS SDK. |
| `pnpm demo:seed` | Seeds the demo series, policyholders, investors and claim packets. |

A single workspace can be run on its own, for example `pnpm --filter @creance/index-model test`.

## Layout

    apps/web            worker, investor and admin screens, and the demo clock
    apps/api            quotes, binding, claims, x402 middleware, World verification
    apps/oracle         BLS fetch, ODI computation, HCS publish, replay
    apps/steward        buyer agent that pays for cover over x402
    apps/adjuster       claims agent that decides proof of loss packets
    contracts           Hardhat project for CoverPool and CollateralVault
    packages/index-model  ODI maths and backtests, no chain dependencies
    packages/client     API client including an x402 payer helper

Workspaces are named under the `@creance` scope. Every one of them extends [tsconfig.base.json](tsconfig.base.json), which sets TypeScript to strict.

Solidity sources belong in `contracts/contracts`, which is where Hardhat looks by default. [contracts/hardhat.config.ts](contracts/hardhat.config.ts) configures two networks and no others: the local in process chain for unit tests, and Hedera testnet through the Hashio JSON-RPC relay. The deploy key is read from the environment, so an empty environment simply leaves the account list empty.

## Continuous integration

[.github/workflows/ci.yml](.github/workflows/ci.yml) installs with a frozen lockfile, then runs lint, typecheck and test on every pull request. It resolves pnpm from the `packageManager` field rather than pinning a version in the workflow, so the pnpm that installs is always the one that wrote the lockfile.

## Disclosure

This is a testnet prototype built during a hackathon. It is not an offer of insurance or of securities in any jurisdiction, it is not regulated advice, and no real funds are involved at any point. The occupation index is computed from public statistics for demonstration only.

## Licence

MIT. See [LICENSE](LICENSE).
