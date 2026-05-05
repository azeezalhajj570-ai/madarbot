#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

compose_args=(-f docker-compose.yml)
if [ -f docker-compose.runtime.yml ]; then
  compose_args+=(-f docker-compose.runtime.yml)
fi

cleanup() {
  docker compose "${compose_args[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
}

http_get() {
  local url="$1"
  docker compose "${compose_args[@]}" exec -T backend python -c \
    "import sys, urllib.request; print(urllib.request.urlopen(sys.argv[1]).read().decode())" \
    "$url"
}

http_status() {
  local url="$1"
  docker compose "${compose_args[@]}" exec -T backend python -c \
    "import sys, urllib.request, urllib.error
url = sys.argv[1]
try:
    with urllib.request.urlopen(url) as response:
        print(response.status)
except urllib.error.HTTPError as exc:
    print(exc.code)" \
    "$url"
}

cleanup
trap cleanup EXIT

docker compose "${compose_args[@]}" up -d postgres redis
docker compose "${compose_args[@]}" run --rm migrate
docker compose "${compose_args[@]}" up -d backend miniapp dashboard

for _ in $(seq 1 40); do
  if http_get http://127.0.0.1:8080/health >/dev/null 2>&1; then
    break
  fi
  sleep 3
done

http_get http://127.0.0.1:8080/health | grep -q '"status":"ok"'
http_get http://127.0.0.1:8080/auth/providers | grep -q '"telegram"'
http_get http://127.0.0.1:8080/api/auth/providers | grep -q '"telegram"'
http_get http://127.0.0.1:8080/groups >/dev/null
if [ "$(http_status http://127.0.0.1:8080/api/auth/me)" != "401" ]; then
  echo "expected /api/auth/me to require auth" >&2
  exit 1
fi
http_get http://127.0.0.1:8080/webapp | grep -qi '<!doctype html'
http_get http://127.0.0.1:8080/dashboard | grep -qi '<!doctype html'
http_get http://miniapp/ | grep -qi '<!doctype html'
http_get http://dashboard/ | grep -qi '<!doctype html'

docker compose "${compose_args[@]}" ps
