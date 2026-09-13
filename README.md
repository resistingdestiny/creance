# Creance

Cover for the day your job is automated.

You pay a small premium each month. If job losses climb far enough in your
occupation, and you lose your job, you get paid. Investors put up the money and
take the premiums as coupons. They can also trade notes, creating a real-time
prediction market on which professions are most at risk of automation.

Deployed on the Hedera testnet, using World for human validation including
Selfie Check, and offering two Bazantic gateways and recipes.

[creance.co](https://creance.co) · [api.creance.co](https://api.creance.co) ·
[open a real cover](https://creance.co/home/demo) with a published key

## The index

Each month we take the unemployment rate for an occupation, subtract the rate
across all occupations, and smooth it over three months. That number is the
Occupation Displacement Index. Every series has a line it has to cross before
claims open.

It goes to a Hedera topic and into the `CoverPool` contract, so what opens
claims is on chain and we cannot move it. The source is currently the US Bureau
of Labor Statistics, and in future could be augmented with data from job
adverts, company reports and the like.


## Your half

An open index is not enough. You also have to show you lost the job.

You file a World ID Selfie Check tied to your policy, your termination notice
and a statement. An adjuster built on Claude reads it and decides. It is not
deciding your payout, the on chain trigger does that. It only decides whether
you lost the job. Its reasoning goes to a claims topic you can read.

## One person, one cover

Selfie Check gives a stable nullifier per person. Buy twice on the same World ID
and the second is refused before you are asked for money. Enforced in the
database and again on the contract.

## Where the money comes from

Each series is a Displacement Bond Note, issued through the Hashgraph Asset
Tokenization Studio as an ERC-3643 bond with a KYC list. Investors fund a vault,
earn the premiums as coupons, and get the principal back at maturity less
payouts. Notes can be sold on.

## Paying monthly

x402 has no way to say "every month". Its Hedera scheme wants a bare transfer
and refuses a scheduled one. So the first premium is the x402 call and the rest
are Hedera Scheduled Transactions. Those expire after 62 days, so a watcher lays
down each month as the last one fires.

## On chain

| | |
| --- | --- |
| CoverPool | [0.0.10367199](https://hashscan.io/testnet/contract/0.0.10367199) |
| CollateralVault | [0.0.10367194](https://hashscan.io/testnet/contract/0.0.10367194) |
| NoteMarket | [0.0.10495570](https://hashscan.io/testnet/contract/0.0.10495570) |
| Note (ATS) | [0.0.10368240](https://hashscan.io/testnet/contract/0.0.10368240) |
| TUSD | [0.0.10366463](https://hashscan.io/testnet/token/0.0.10366463) |
| Index topic | [0.0.10366470](https://hashscan.io/testnet/topic/0.0.10366470) |
| Payments topic | [0.0.10366471](https://hashscan.io/testnet/topic/0.0.10366471) |
| Claims topic | [0.0.10366473](https://hashscan.io/testnet/topic/0.0.10366473) |

Everything on the site is read from those. [See it
live](https://creance.co/activity).

## Layout

    apps/api        pricing, binding, x402, World proofs, claims and audit
    apps/web        every screen
    apps/oracle     BLS to index, published on chain
    apps/steward    an agent that buys cover
    apps/adjuster   an agent that decides claims
    contracts       CoverPool, CollateralVault, NoteMarket, ATS

## Run it

    pnpm install
    cp .env.example .env
    pnpm dev

Node 22, pnpm 11, Postgres for the API. `pnpm test` needs neither a database nor
a network.

## More

[How it works inside](docs/INTERNALS.md) ·
[Decisions](docs/DECISIONS.md) ·
[What the chain and the SDKs actually did](docs/harness-notes.md) ·
[The index](docs/INDEX.md) ·
[Every id and gas figure](docs/HEDERA.md)

MIT.
