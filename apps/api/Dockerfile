# The API image.
#
# Build from the repository root, not from this directory:
#
#     podman build -f apps/api/Dockerfile \
#       --build-arg GIT_SHA="$(git rev-parse HEAD)" -t creance-api .
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
# lockfile. The filter is what keeps the image small: only the API and the two
# libraries it depends on are installed, so the contracts Hardhat toolchain and
# the web app's Next dependencies never reach this image.
COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --chown=node:node apps/adjuster/package.json apps/adjuster/
COPY --chown=node:node apps/api/package.json apps/api/
COPY --chown=node:node apps/oracle/package.json apps/oracle/
COPY --chown=node:node apps/steward/package.json apps/steward/
COPY --chown=node:node apps/web/package.json apps/web/
COPY --chown=node:node contracts/package.json contracts/
COPY --chown=node:node packages/client/package.json packages/client/
COPY --chown=node:node packages/index-model/package.json packages/index-model/
RUN pnpm install --frozen-lockfile --filter @creance/api...

# The API has no build step: it runs from TypeScript through tsx, which is why
# the development dependencies stay in the image.
COPY --chown=node:node packages/client packages/client
COPY --chown=node:node packages/index-model packages/index-model
COPY --chown=node:node apps/api apps/api

# Read as data files rather than imported: the deployment record, the day 0
# testnet resources, and the BLS archive the index history is computed from at
# boot. packages/index-model finds the repository root by walking up to
# pnpm-workspace.yaml, so the workspace layout is preserved here on purpose.
COPY --chown=node:node contracts/deployments contracts/deployments
COPY --chown=node:node docs/hedera.testnet.json docs/hedera.testnet.json
COPY --chown=node:node data/bls data/bls

# The commit this image was built from. GET /health returns it, and that is the
# line in MISSION's definition of done.
ARG GIT_SHA=unknown
ENV GIT_SHA=$GIT_SHA

# main.ts defaults to 127.0.0.1, which is right on a laptop and answers nobody
# in a container.
ENV HOST=0.0.0.0
ENV PORT=3210
EXPOSE 3210

WORKDIR /repo/apps/api
CMD ["pnpm", "exec", "tsx", "src/main.ts"]
