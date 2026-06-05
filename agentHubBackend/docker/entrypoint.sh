#!/bin/sh
set -eu

APP_STORAGE_ROOT="${APP_STORAGE_ROOT:-/app/data}"
mkdir -p "$APP_STORAGE_ROOT"
chown -R node:node "$APP_STORAGE_ROOT" 2>/dev/null || true

if [ -S /var/run/docker.sock ]; then
  DOCKER_GID="${DOCKER_GID:-$(stat -c '%g' /var/run/docker.sock 2>/dev/null || true)}"
  if [ -n "$DOCKER_GID" ]; then
    if ! awk -F: -v gid="$DOCKER_GID" '$3 == gid { found = 1 } END { exit(found ? 0 : 1) }' /etc/group; then
      addgroup -S -g "$DOCKER_GID" dockerhost >/dev/null 2>&1 || true
    fi

    DOCKER_GROUP="$(awk -F: -v gid="$DOCKER_GID" '$3 == gid { print $1; exit }' /etc/group || true)"
    if [ -n "$DOCKER_GROUP" ]; then
      addgroup node "$DOCKER_GROUP" >/dev/null 2>&1 || true
    fi
  fi
fi

exec su-exec node "$@"
