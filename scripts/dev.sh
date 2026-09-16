#!/usr/bin/env bash
# Chạy cả backend + frontend local trong một terminal.
#   ./scripts/dev.sh                  # api :8008, web :3000
#   API_PORT=8000 WEB_PORT=3001 ./scripts/dev.sh
# Ctrl-C dừng cả hai. DB/Redis dùng container compose (giữ nguyên khi thoát).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_PORT="${API_PORT:-8008}"
WEB_PORT="${WEB_PORT:-3000}"
COMPOSE="docker compose -f $ROOT/docker-compose.yml"

# 1. Postgres + Redis (chỉ tạo mới nếu chưa có; --no-recreate KHÔNG đụng
# container đang chạy — tránh sự cố recreate sai port như từng xảy ra).
if ! $COMPOSE up -d --no-recreate db redis >/dev/null 2>/tmp/opencode/dev-compose-err.log; then
  echo "[dev] không dựng được db/redis:"
  tail -5 /tmp/opencode/dev-compose-err.log
  echo "[dev] gợi ý: kiểm tra POSTGRES_PORT/REDIS_PORT trong .env có đụng port container khác không (docker ps)"
  exit 1
fi
echo "[dev] waiting for postgres..."
for _ in $(seq 1 30); do
  if $COMPOSE exec -T db pg_isready -U "${POSTGRES_USER:-gmov}" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
$COMPOSE exec -T db pg_isready -U "${POSTGRES_USER:-gmov}" >/dev/null \
  || { echo "[dev] postgres not ready, aborting"; exit 1; }

# 2. Deps web (lần đầu).
if [ ! -d "$ROOT/node_modules" ]; then
  echo "[dev] pnpm install..."
  (cd "$ROOT" && pnpm install)
fi

# 3. Backend nền. Nếu port đã có API chạy sẵn thì dùng chung (thoát script
# không tắt nó); nếu không thì tự start và tự dọn.
API_OURS=0
if curl -sf "http://localhost:$API_PORT/health" >/dev/null 2>&1; then
  echo "[dev] api :$API_PORT đã chạy sẵn — dùng chung (Ctrl-C không tắt nó)"
else
  (cd "$ROOT/apps/api" && uv run uvicorn app.main:app --reload --port "$API_PORT") &
  API_PID=$!
  API_OURS=1
  echo "[dev] waiting for api :$API_PORT..."
  for _ in $(seq 1 30); do
    if curl -sf "http://localhost:$API_PORT/health" >/dev/null 2>&1; then
      break
    fi
    sleep 2
  done
  if ! curl -sf "http://localhost:$API_PORT/health" >/dev/null 2>&1; then
    echo "[dev] api did not start, aborting"
    exit 1
  fi
fi

cleanup() {
  if [ "$API_OURS" = 1 ]; then
    # Ngoặc [u] để pkill không tự bắn shell đang chạy lệnh này.
    pkill -f "[u]vicorn app.main:app --reload --port $API_PORT" 2>/dev/null || true
  fi
  if [ -n "${WEB_PID:-}" ]; then
    kill "$WEB_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

# 4. Frontend nền + wait (để trap dọn được cả hai khi Ctrl-C/timeout).
if curl -sf "http://localhost:$WEB_PORT" >/dev/null 2>&1; then
  echo "[dev] port $WEB_PORT đã có tiến trình khác — đổi WEB_PORT hoặc tắt nó rồi chạy lại"
  exit 1
fi
echo "[dev] api :$API_PORT + web :$WEB_PORT"
cd "$ROOT"
BACKEND_URL="http://localhost:$API_PORT" \
  pnpm --filter gmov-web dev --port "$WEB_PORT" &
WEB_PID=$!
wait "$WEB_PID"
