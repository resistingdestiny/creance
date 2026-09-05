#!/bin/sh
# Build and start the public deployment, then prove it answers.
#
#     deploy/deploy.sh              build, start, wait for GET /health
#     deploy/deploy.sh --with-caddy also install deploy/Caddyfile and reload Caddy
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
for arg in "$@"; do
	case "$arg" in
	--with-caddy) WITH_CADDY=yes ;;
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

# The commit this build came from, baked into the images and returned by
# GET /health. It is the whole point of the health endpoint, so it is read here
# rather than left to whatever happens to be in the environment.
GIT_SHA=$(git rev-parse HEAD)
export GIT_SHA

echo "deploy: $SITE at $GIT_SHA with $COMPOSE"
$COMPOSE up -d --build

echo "deploy: waiting for the API to answer on 127.0.0.1:$API_PORT"
health="http://127.0.0.1:$API_PORT/health"
served=""
i=0
while [ "$i" -lt 60 ]; do
	served=$(curl -fsS "$health" 2>/dev/null | sed -n 's/.*"sha":"\([0-9a-f]*\)".*/\1/p') || served=""
	[ -n "$served" ] && break
	i=$((i + 1))
	sleep 2
done

if [ -z "$served" ]; then
	echo "deploy: the API did not answer GET /health in two minutes" >&2
	echo "deploy: $COMPOSE logs api" >&2
	exit 1
fi

if [ "$served" != "$GIT_SHA" ]; then
	echo "deploy: GET /health reports $served, not $GIT_SHA. A stale image is running." >&2
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
