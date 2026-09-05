# The index oracle image.
#
# Build from the repository root, not from this directory:
#
#     podman build -f apps/oracle/Dockerfile \
#       --build-arg GIT_SHA="$(git rev-parse HEAD)" -t creance-oracle .
#
# Plain OCI instructions and no BuildKit syntax directive, so podman and docker
# build it the same way.

FROM docker.io/library/node:22-bookworm-slim

# corepack resolves pnpm from the packageManager field in package.json, so the
# pnpm that installs here is the one that wrote the lockfile.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

RUN mkdir -p /repo && chown node:node /repo
WORKDIR /repo
USER node

# Every workspace manifest, because --frozen-lockfile compares the lockfile
# against the projects pnpm can see and a missing project reads as a stale
# lockfile. Only the oracle and the two libraries it depends on are installed.
COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY --chown=node:node apps/adjuster/package.json apps/adjuster/
COPY --chown=node:node apps/api/package.json apps/api/
COPY --chown=node:node apps/oracle/package.json apps/oracle/
COPY --chown=node:node apps/steward/package.json apps/steward/
COPY --chown=node:node apps/web/package.json apps/web/
COPY --chown=node:node contracts/package.json contracts/
COPY --chown=node:node packages/client/package.json packages/client/
COPY --chown=node:node packages/index-model/package.json packages/index-model/
RUN pnpm install --frozen-lockfile --filter @creance/oracle...

# The oracle has no build step either: its CLIs run from TypeScript through tsx.
COPY --chown=node:node packages/client packages/client
COPY --chown=node:node packages/index-model packages/index-model
COPY --chown=node:node apps/oracle apps/oracle

# The root scripts, because the container runs `pnpm run oracle:schedule`, the
# same command the README documents. Until T26 replaces its body it prints what
# it will do and exits.
COPY --chown=node:node scripts scripts

# Read as data files: the deployment record, the day 0 testnet resources, and
# the committed BLS archive, which is what lets a replay run with no network.
COPY --chown=node:node contracts/deployments contracts/deployments
COPY --chown=node:node docs/hedera.testnet.json docs/hedera.testnet.json
COPY --chown=node:node data/bls data/bls

# What a run writes: the run state the API serves at GET /health and
# GET /v1/replay, the observation store, and the raw BLS cache. In the deploy
# compose this is a volume shared with the API, mounted at the same path in
# both, which is what makes ORACLE_STATE_PATH mean the same file to both.
RUN mkdir -p /repo/var/oracle /repo/var/cache/bls
VOLUME /repo/var

# The commit this image was built from. A build argument and never a runtime
# variable: a runtime value beats the image's own ENV, and a container would then
# report the deploying shell rather than the image it is running.
ARG GIT_SHA=unknown
# The RUN is not decoration. podman 4.9.3 does not treat a change of build
# argument as invalidating a later ENV layer, so a rebuild at a new commit
# reuses the old ENV and the image reports a commit that is not its own. A RUN
# carrying the value in its command text has that value in its cache key, so it
# and everything after it rebuild. Measured; see docs/harness-notes.md.
RUN echo "$GIT_SHA" > /repo/.git-sha
ENV GIT_SHA=$GIT_SHA

# Schedule mode: the daily index check of docs/INDEX-SPEC.md section 9. The loop
# is the schedule, so the container stays up and `restart: always` in the compose
# file means what it says rather than papering over an exiting process. One
# invocation of the script is one check, which is why the loop can own the
# cadence: the check publishes only what the source has and the store does not.
CMD ["sh", "-c", "while true; do pnpm run oracle:schedule; sleep 86400; done"]
