#!/bin/sh
# Build and start the public deployment, then prove it answers.
#
#     deploy/deploy.sh              build, start, wait for GET /health
#     deploy/deploy.sh --with-caddy also install deploy/Caddyfile and reload Caddy
#     deploy/deploy.sh --no-build   start what is already built, do not rebuild
#
# Run it from a clone on the public host, with the production .env already in
# place at the repository root. It reads no secret and prints none: the only
# values it looks at in .env are the two public origins, which it checks agree.
#
# The container runtime is whichever of docker compose and podman compose the
# host has. Set COMPOSE to force one.

set -eu

cd "$(dirname "$0")/.."

WITH_CADDY=no
BUILD=yes
for arg in "$@"; do
	case "$arg" in
	--with-caddy) WITH_CADDY=yes ;;
	--no-build) BUILD=no ;;
	*)
		echo "deploy: unknown option $arg" >&2
		exit 2
		;;
	esac
done

COMPOSE=${COMPOSE:-}
if [ -z "$COMPOSE" ]; then
	if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
		COMPOSE="docker compose"
	elif command -v podman >/dev/null 2>&1; then
		COMPOSE="podman compose"
	else
		echo "deploy: this host has neither docker compose nor podman" >&2
		exit 1
	fi
fi

if [ ! -f .env ]; then
	echo "deploy: .env is missing. Copy .env.example to .env and fill it in." >&2
	exit 1
fi

# A container runtime passes an environment file through verbatim: a value
# followed by a comment arrives with the comment attached, so
# `PUBLIC_SITE_URL=https://creance.co  # the origin` would make the API issue
# credentials for an origin with a comment in it. See docs/harness-notes.md.
# .env.example keeps every comment on its own line and a production file has to
# do the same, so this refuses rather than quietly stripping.
INLINE=$(grep -n '^[A-Z_][A-Z0-9_]*=.*[[:space:]]#' .env | cut -d: -f1 | tr '\n' ' ' || true)
if [ -n "$INLINE" ]; then
	echo "deploy: .env has a comment on the same line as a value, at line(s) $INLINE." >&2
	echo "deploy: the runtime passes those through as part of the value." >&2
	echo "deploy: move the comment onto its own line, as .env.example does." >&2
	exit 1
fi

# GIT_SHA is a build argument of the images and never a runtime setting. A line
# for it in .env, blank or otherwise, is passed to the container by `env_file`
# and overrides what the build baked in, so GET /health would report the
# operator's file rather than the running image's own commit. .env.example no
# longer carries the name; a file copied from an older one still might.
if grep -q '^GIT_SHA=' .env; then
	echo "deploy: .env sets GIT_SHA. It is baked into the image at build time and" >&2
	echo "deploy: a value here overrides that, so GET /health would stop reporting" >&2
	echo "deploy: the commit the running image was built from. Delete the line." >&2
	exit 1
fi

# One key from the file, last definition wins, exactly as a shell would read it.
setting() {
	grep "^$1=" .env | tail -n 1 | cut -d= -f2- | tr -d '\r' | sed 's/[[:space:]]*$//'
}

SITE=$(setting PUBLIC_SITE_URL)
PUBLIC_SITE=$(setting NEXT_PUBLIC_SITE_URL)

if [ -z "$SITE" ]; then
	echo "deploy: PUBLIC_SITE_URL is not set in .env. It is the canonical origin." >&2
	exit 1
fi

if [ -z "$PUBLIC_SITE" ]; then
	echo "deploy: NEXT_PUBLIC_SITE_URL is not set in .env. Set it to $SITE." >&2
	echo "deploy: it is what the browser bundle is built with. See docs/DECISIONS.md." >&2
	exit 1
fi

# The browser bundle is built from NEXT_PUBLIC_SITE_URL and everything on the
# server from PUBLIC_SITE_URL. Two different values means a page that links to
# an origin the API does not answer on, and it is invisible until a judge clicks.
if [ "$SITE" != "$PUBLIC_SITE" ]; then
	echo "deploy: PUBLIC_SITE_URL is $SITE and NEXT_PUBLIC_SITE_URL is $PUBLIC_SITE." >&2
	echo "deploy: they carry the same origin and must match. See docs/DECISIONS.md." >&2
	exit 1
fi

API_PORT=${API_PORT:-3210}
WEB_PORT=${WEB_PORT:-3000}
export API_PORT WEB_PORT

# The commit this build came from. It goes in as a build argument, the images
# bake it, and GET /health reads it back out of the running container below.
#
# CREANCE_GIT_SHA rather than GIT_SHA because podman-compose lets the project's
# own `.env` shadow the shell for substitution, and because `env_file` would
# hand a GIT_SHA line straight to the container and override the baked value.
# Nothing named GIT_SHA belongs in either file. See the comment in compose.yaml
# and docs/harness-notes.md.
GIT_SHA=$(git rev-parse HEAD)
CREANCE_GIT_SHA=$GIT_SHA
export CREANCE_GIT_SHA

echo "deploy: $SITE at $GIT_SHA with $COMPOSE"
if [ "$BUILD" = yes ]; then
	$COMPOSE up -d --build
else
	echo "deploy: --no-build, so whatever is already built is what starts"
	$COMPOSE up -d
fi

echo "deploy: waiting for the API to answer on 127.0.0.1:$API_PORT"
health="http://127.0.0.1:$API_PORT/health"
served=""
i=0
while [ "$i" -lt 60 ]; do
	served=$(curl -fsS "$health" 2>/dev/null | sed -n 's/.*"sha":"\([^"]*\)".*/\1/p') || served=""
	[ -n "$served" ] && break
	i=$((i + 1))
	sleep 2
done

if [ -z "$served" ]; then
	echo "deploy: the API did not answer GET /health in two minutes" >&2
	echo "deploy: $COMPOSE logs api" >&2
	exit 1
fi

# The two sides of this come from different places, which is the point. $GIT_SHA
# is this working tree's HEAD; $served is what the running image was built with,
# baked into it by the build argument and never set at runtime. They differ when
# a deploy started an image older than the checkout, which is exactly what
# --no-build can do and what a half finished redeploy leaves behind.
if [ "$served" != "$GIT_SHA" ]; then
	echo "deploy: GET /health reports $served, not $GIT_SHA. A stale image is running." >&2
	echo "deploy: rerun without --no-build to rebuild the images at this commit." >&2
	exit 1
fi

echo "deploy: GET /health reports $served"

if ! curl -fsS -o /dev/null "http://127.0.0.1:$WEB_PORT/"; then
	echo "deploy: the web app did not answer on 127.0.0.1:$WEB_PORT" >&2
	exit 1
fi
echo "deploy: the web app answers on 127.0.0.1:$WEB_PORT"

if [ "$WITH_CADDY" = yes ]; then
	echo "deploy: installing deploy/Caddyfile and reloading Caddy"
	sudo install -m 0644 -o root -g root deploy/Caddyfile /etc/caddy/Caddyfile
	sudo systemctl reload caddy
fi

echo "deploy: done. $SITE/health should now return $GIT_SHA."
