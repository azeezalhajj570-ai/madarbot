#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${1:-/root/madarbot}"
ARCHIVE_PATH="${2:-/tmp/madarbot-release.tar.gz}"

mkdir -p "$APP_DIR"

if [ ! -f "$ARCHIVE_PATH" ]; then
  echo "Expected release archive at $ARCHIVE_PATH" >&2
  exit 1
fi

tar -xzf "$ARCHIVE_PATH" -C "$APP_DIR"

cd "$APP_DIR"

docker compose up -d postgres redis
docker compose run --rm migrate
docker compose up -d --build --remove-orphans backend bot agent_worker miniapp_agents
docker compose ps
