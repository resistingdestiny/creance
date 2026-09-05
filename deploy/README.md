# Public deployment

What is here, and what a host has to provide before it will work. The local
development path needs none of this: see the README, which stays the primary
route for anyone reading the project for the first time.

    compose.yaml        Postgres, the API, the web app and the index oracle
    deploy/Caddyfile    TLS and the routing that keeps both apps on one origin
    deploy/deploy.sh    build, start, and prove GET /health returns this commit

## What the host must provide

- A fresh Linux VPS, 4 GB of memory or more. The web image builds Next.js, which
  is the heaviest step.
- Ports 80 and 443 open to the internet. Caddy needs 80 for the ACME HTTP
  challenge and 443 to serve. Nothing else needs to be reachable: the compose
  file publishes the API and the web app on 127.0.0.1 only, so Caddy is the one
  thing the internet can talk to.
- DNS for `creance.co`: an A record at the host's IPv4 address, and an AAAA
  record at its IPv6 address if it has one. Caddy will not get a certificate
  before the records resolve.
- An SSH user in the `docker` group, or a user that can run rootless podman.
- `git`, `curl`, `caddy`, and either `docker` with the compose plugin or
  `podman` with `podman-compose`.

## Steps

    git clone https://github.com/resistingdestiny/creance
    cd creance

Put the production `.env` at the repository root. It is the file `.env.example`
describes, filled in for testnet, and it never enters git.

A blank line in that file used to be a value rather than an absence, so
`CREANCE_DEPLOYMENT_RECORD=` with nothing after it handed the API an empty path
instead of the default and the process refused to boot. T23 fixed that: every
name the API and the oracle read is now read blank as unset. `GIT_SHA` is still
the one case where a blank line would do harm, because it would erase what the
image build baked in, and it is kept out of `.env.example` for that reason.

The values that matter to a deployment, beyond the Hedera and World credentials:

| Variable | Production value |
| --- | --- |
| `PUBLIC_SITE_URL` | `https://creance.co` |
| `NEXT_PUBLIC_SITE_URL` | `https://creance.co`, the same origin |
| `NEXT_PUBLIC_DEMO_INVESTOR`, `NEXT_PUBLIC_FONT_OPTION`, `NEXT_PUBLIC_WALLET_MODE` | as `.env.example` documents |
| `POSTGRES_PASSWORD` | anything; the database is not published off the host |

`DATABASE_URL`, `HOST`, `PORT`, `CREANCE_API_URL` and the three `ORACLE_*` paths
are overridden by `compose.yaml` for the containers, so whatever they hold for
local development is left alone.

The four `NEXT_PUBLIC_` values are build arguments of the web image, not runtime
variables: a framework public variable is inlined into the browser bundle when
the build runs. Changing one means rebuilding the web image, which
`deploy/deploy.sh` does every time. See docs/DECISIONS.md, "The public origin is
carried by a second, public variable".

Then:

    deploy/deploy.sh --with-caddy

It builds the three images with the commit from `git rev-parse HEAD`, starts
the four services, waits for `GET /health` to answer with that same commit,
checks the web app answers, installs `deploy/Caddyfile` and reloads Caddy. Drop
`--with-caddy` on later runs, when the Caddy configuration has not changed.

A redeploy is `git pull` and the same command. The database and the oracle's
state survive in named volumes.

The commit is baked into the images at build time and never set at runtime, so
`GET /health` answers with the commit the running image was built from. The
script compares that against `git rev-parse HEAD` and stops with

    deploy: GET /health reports <one commit>, not <another>. A stale image is running.

when they differ, which is what a redeploy that did not rebuild looks like.
`deploy/deploy.sh --no-build` starts what is already built without rebuilding,
which is useful for a restart and is the quickest way to see that check work.

## Checking it

    curl -s https://creance.co/health
    curl -sI https://creance.co/

`GET /health` returns the running commit, whether Postgres, Hedera, the index
and World are configured, and the oracle's run state. `GET /healthz` is the same
handler under the path that shipped first.

`.github/workflows/uptime.yml` runs the same check every fifteen minutes once
the repository variable `PUBLIC_SITE_URL` is set, and skips itself when it is
not.

## Ports

The compose file publishes `127.0.0.1:3210` for the API and `127.0.0.1:3000` for
the web app. If the host already has something on either, set `API_PORT` or
`WEB_PORT` for both the deploy script and Caddy:

    API_PORT=13210 WEB_PORT=13000 deploy/deploy.sh

Caddy reads the same two names from its own environment, defaulting to 3210 and
3000.

## The oracle service

The oracle container runs schedule mode: `pnpm run oracle:schedule` once a day,
with `restart: always`, which is what docs/INDEX-SPEC.md section 9 asks for. It
shares one volume with the API, mounted at `/repo/var` in both, so the run state
the oracle writes is the run state `GET /health` and `GET /v1/replay` serve. A
replay can be driven inside the running container:

    podman compose exec oracle pnpm run oracle:replay --from 2025-01 --to 2025-03

Until T26 fills in the body of `oracle:schedule` the daily run prints what it
will do and the loop waits. Replacing that script is the only change needed
here: the compose file and the image command stay as they are.
