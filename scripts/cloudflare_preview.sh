#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env"
LOCAL_URL="http://127.0.0.1:8000"
WEBAPP_PATH="/webapp"
DASHBOARD_PATH="/dashboard"
WRITE_ENV=1

usage() {
  cat <<'EOF'
Usage: scripts/cloudflare_preview.sh [options]

Starts a temporary Cloudflare tunnel to the local dashboard/backend and prints
the public Telegram WebApp URL. By default it also updates .env so the bot
opens the new preview URL.

Options:
  --url URL           Local origin to expose (default: http://127.0.0.1:8000)
  --env-file PATH     Env file to update (default: .env in repo root)
  --webapp-path PATH  Public path appended for WEBAPP_URL (default: /webapp)
  --dashboard-path P  Public path appended for DASHBOARD_URL (default: /dashboard)
  --no-env            Do not update DASHBOARD_URL and WEBAPP_URL
  --help              Show this help message
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --url)
      LOCAL_URL="$2"
      shift 2
      ;;
    --env-file)
      ENV_FILE="$2"
      shift 2
      ;;
    --webapp-path)
      WEBAPP_PATH="$2"
      shift 2
      ;;
    --dashboard-path)
      DASHBOARD_PATH="$2"
      shift 2
      ;;
    --no-env)
      WRITE_ENV=0
      shift
      ;;
    --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -x "${ROOT_DIR}/cloudflared-linux-amd64" ]]; then
  CLOUDFLARED=("${ROOT_DIR}/cloudflared-linux-amd64")
elif command -v cloudflared >/dev/null 2>&1; then
  CLOUDFLARED=("$(command -v cloudflared)")
else
  echo "cloudflared binary not found. Expected ./cloudflared-linux-amd64 or cloudflared on PATH." >&2
  exit 1
fi

append_path() {
  local base_url="$1"
  local suffix="$2"
  if [[ "$suffix" == "/" ]]; then
    printf '%s\n' "${base_url%/}/"
    return
  fi
  printf '%s%s\n' "${base_url%/}" "${suffix}"
}

replace_env_value() {
  local file_path="$1"
  local key="$2"
  local value="$3"
  local temp_file

  temp_file="$(mktemp)"
  if [[ -f "$file_path" ]]; then
    awk -v key="$key" -v value="$value" '
      BEGIN { replaced = 0 }
      index($0, key "=") == 1 {
        print key "=" value
        replaced = 1
        next
      }
      { print }
      END {
        if (!replaced) {
          print key "=" value
        }
      }
    ' "$file_path" >"$temp_file"
  else
    printf '%s=%s\n' "$key" "$value" >"$temp_file"
  fi
  mv "$temp_file" "$file_path"
}

LOG_FILE="$(mktemp)"
cleanup() {
  if [[ -n "${TUNNEL_PID:-}" ]] && kill -0 "${TUNNEL_PID}" >/dev/null 2>&1; then
    kill "${TUNNEL_PID}" >/dev/null 2>&1 || true
    wait "${TUNNEL_PID}" >/dev/null 2>&1 || true
  fi
  rm -f "$LOG_FILE"
}
trap cleanup EXIT INT TERM

echo "Starting Cloudflare tunnel for ${LOCAL_URL}"
# Ignore any user-level cloudflared config so quick tunnels do not inherit
# unrelated ingress rules and accidentally return Cloudflare-managed 404s.
"${CLOUDFLARED[@]}" --config /dev/null tunnel --url "${LOCAL_URL}" --no-autoupdate >"$LOG_FILE" 2>&1 &
TUNNEL_PID=$!

PUBLIC_BASE_URL=""
for _ in $(seq 1 60); do
  if ! kill -0 "$TUNNEL_PID" >/dev/null 2>&1; then
    cat "$LOG_FILE" >&2
    echo "cloudflared exited before publishing a tunnel URL." >&2
    exit 1
  fi

  PUBLIC_BASE_URL="$(grep -Eo 'https://[-a-z0-9]+\.trycloudflare\.com' "$LOG_FILE" | head -n 1 || true)"
  if [[ -n "$PUBLIC_BASE_URL" ]]; then
    break
  fi
  sleep 1
done

if [[ -z "$PUBLIC_BASE_URL" ]]; then
  cat "$LOG_FILE" >&2
  echo "Timed out waiting for the Cloudflare public URL." >&2
  exit 1
fi

PUBLIC_WEBAPP_URL="$(append_path "$PUBLIC_BASE_URL" "$WEBAPP_PATH")"
PUBLIC_DASHBOARD_URL="$(append_path "$PUBLIC_BASE_URL" "$DASHBOARD_PATH")"
PUBLIC_ADMIN_WEBAPP_URL="$(append_path "$PUBLIC_BASE_URL" "/webapp/admin")"
PUBLIC_AGENTS_WEBAPP_URL="$(append_path "$PUBLIC_BASE_URL" "/webapp/agents")"

if [[ "$WRITE_ENV" -eq 1 ]]; then
  replace_env_value "$ENV_FILE" "DASHBOARD_URL" "$PUBLIC_DASHBOARD_URL"
  replace_env_value "$ENV_FILE" "WEBAPP_URL" "$PUBLIC_WEBAPP_URL"
  replace_env_value "$ENV_FILE" "ADMIN_WEBAPP_URL" "$PUBLIC_ADMIN_WEBAPP_URL"
  replace_env_value "$ENV_FILE" "AGENTS_WEBAPP_URL" "$PUBLIC_AGENTS_WEBAPP_URL"
fi

cat <<EOF
Tunnel ready.

Local origin:      ${LOCAL_URL}
Public origin:     ${PUBLIC_BASE_URL}
WebApp URL:        ${PUBLIC_WEBAPP_URL}
Dashboard URL:     ${PUBLIC_DASHBOARD_URL}
Admin WebApp URL:  ${PUBLIC_ADMIN_WEBAPP_URL}
Agents WebApp URL: ${PUBLIC_AGENTS_WEBAPP_URL}
Env updated:       $([[ "$WRITE_ENV" -eq 1 ]] && printf 'yes (%s)' "$ENV_FILE" || printf 'no')

Keep this process running while testing the Telegram WebApp preview.
Press Ctrl+C to stop the tunnel.
EOF

wait "$TUNNEL_PID"
