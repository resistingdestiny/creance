# The web app image.
#
# Build from the repository root, not from this directory:
#
#     podman build -f apps/web/Dockerfile \
#       --build-arg NEXT_PUBLIC_SITE_URL=https://creance.co -t creance-web .
#
# Plain OCI instructions and no BuildKit syntax directive, so podman and docker
# build it the same way.

FROM docker.io/library/node:22-bookworm-slim

# corepack resolves pnpm from the packageManager field in package.json, so the
# pnpm that installs here is the one that wrote the lockfile.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable

RUN mkdir -p /repo && chown node:node /repo
WORKDIR /repo
USER node

# Every workspace manifest, because --frozen-lockfile compares the lockfile
# against the projects pnpm can see and a missing project reads as a stale
# lockfile. Only the web app and the client library are installed.
COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY --chown=node:node apps/adjuster/package.json apps/adjuster/
COPY --chown=node:node apps/api/package.json apps/api/
COPY --chown=node:node apps/oracle/package.json apps/oracle/
COPY --chown=node:node apps/steward/package.json apps/steward/
COPY --chown=node:node apps/web/package.json apps/web/
COPY --chown=node:node contracts/package.json contracts/
COPY --chown=node:node packages/client/package.json packages/client/
COPY --chown=node:node packages/index-model/package.json packages/index-model/
RUN pnpm install --frozen-lockfile --filter @creance/web...

COPY --chown=node:node packages/client packages/client
COPY --chown=node:node packages/index-model packages/index-model
COPY --chown=node:node apps/web apps/web

# The attribution series the index tab falls back to when the feed cannot be
# reached. It is imported by src/lib/attribution-model.ts and bundled by the
# build, not read from disk at runtime, so it has to be here before next build
# rather than beside the running app.
COPY --chown=node:node data/attribution data/attribution

# The three public variables are build arguments, not runtime ones. A framework
# public variable is inlined into the browser bundle when the build runs, so
# setting it in the compose file afterwards would change nothing on the page.
# See docs/DECISIONS.md, "The public origin is carried by a second, public
# variable".
#
# NEXT_PUBLIC_WALLET_MODE was a fourth and is gone: the wallet is chosen on the
# payment step now, not at build time. The Reown project id that lets the
# payment step offer a real wallet is not a build argument either. It is read
# from the web application's own environment file, which the copy above brings
# into the image, because that is the only file the framework reads a public
# variable from when it builds here. Without one the payment step offers the
# demo wallet alone and says why.
ARG NEXT_PUBLIC_SITE_URL=http://localhost:3000
ARG NEXT_PUBLIC_DEMO_INVESTOR=investor-1
ARG NEXT_PUBLIC_FONT_OPTION=A
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_DEMO_INVESTOR=$NEXT_PUBLIC_DEMO_INVESTOR
ENV NEXT_PUBLIC_FONT_OPTION=$NEXT_PUBLIC_FONT_OPTION

# Every screen that reads the API is force-dynamic, so the build reaches no
# database, no API and no Hedera node.
WORKDIR /repo/apps/web
RUN pnpm exec next build

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# next.config.ts picks the typeface module by alias, so the config and the
# source stay in the image and this is `next start` rather than a standalone
# server bundle.
CMD ["pnpm", "exec", "next", "start", "-H", "0.0.0.0"]
