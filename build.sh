#!/usr/bin/env bash
# Deploy gmov lên server KHÔNG dùng nginx: build image rồi chạy db, redis, api, web.
# Browser gọi /api/v1/* cùng origin, Next.js proxy server-side tới BACKEND_URL.
#
#   ./build.sh                          # deploy, port lấy từ .env
#   ./build.sh --web-port 3000          # override port cho lần chạy này (không sửa .env)
#   ./build.sh --api-port 8000 --postgres-port 5432 --redis-port 6379
#   ./build.sh --no-cache               # build lại từ đầu
#   ./build.sh down [--volumes]         # dừng (thêm --volumes để xoá luôn data)
#   ./build.sh restart
#   ./build.sh logs [db|redis|api|web]
#   ./build.sh ps
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$ROOT/.env"
SERVICES=(db redis api web)

WEB_PORT=""
API_PORT=""
POSTGRES_PORT=""
REDIS_PORT=""
NO_CACHE=0
VOLUMES=0
COMMAND=""
LOG_SERVICE=""

usage() {
  cat <<'EOF'
Deploy gmov (không nginx) — build + chạy db, redis, api, web.

Cách dùng:
  ./build.sh [up] [--web-port N] [--api-port N] [--postgres-port N] [--redis-port N] [--no-cache]
  ./build.sh down [--volumes]
  ./build.sh restart
  ./build.sh logs [db|redis|api|web]
  ./build.sh ps
  ./build.sh -h | --help

Port truyền qua cờ chỉ áp dụng cho lần chạy này (ưu tiên hơn .env); không ghi vào .env.
Bỏ qua cờ nào thì port đó lấy từ .env / default của docker-compose.yml.
DATABASE_URL/REDIS_URL luôn được ép về db:5432 / redis:6379 cho container, dù .env
dev có đặt localhost.
Yêu cầu .env tồn tại: cp .env.example .env rồi sửa JWT_SECRET + POSTGRES_PASSWORD.
EOF
}

die() {
  echo "[build] $*" >&2
  exit 1
}

is_port() {
  [[ "$1" =~ ^[0-9]+$ ]] && [ "$1" -ge 1 ] && [ "$1" -le 65535 ]
}

# docker compose trong project, tự kèm --env-file nếu .env tồn tại.
compose() {
  local args=(-f "$ROOT/docker-compose.yml")
  [ -f "$ENV_FILE" ] && args+=(--env-file "$ENV_FILE")
  ( cd "$ROOT" && docker compose "${args[@]}" "$@" )
}

require_env() {
  [ -f "$ENV_FILE" ] || die ".env chưa có. Chạy: cp .env.example .env  rồi sửa JWT_SECRET + POSTGRES_PASSWORD."
}

warn_default_secrets() {
  grep -qE '^JWT_SECRET=change-me' "$ENV_FILE" 2>/dev/null \
    && echo "[build] CẢNH BÁO: JWT_SECRET vẫn là giá trị mẫu, đổi trước khi public."
  grep -qE '^POSTGRES_PASSWORD=change-me' "$ENV_FILE" 2>/dev/null \
    && echo "[build] CẢNH BÁO: POSTGRES_PASSWORD vẫn là giá trị mẫu, đổi trước khi public."
  return 0
}

# Cổng đang được chính project này public (cho phép deploy lại).
project_ports() {
  compose ps --format '{{.Ports}}' 2>/dev/null \
    | grep -oE '0\.0\.0\.0:[0-9]+' | cut -d: -f2 | sort -u || true
}

port_in_use() {
  ss -ltnH "sport = :$1" 2>/dev/null | grep -q .
}

# Đọc giá trị port từ .env (bỏ comment và dấu nháy) để biết port hiệu dụng.
env_value() {
  grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- \
    | sed 's/[[:space:]]*#.*//' | tr -d '"' | xargs
}

# Port hiệu dụng: cờ command > .env > default của docker-compose.yml.
effective_port() {
  local override="$1" key="$2" fallback="$3" value
  if [ -n "$override" ]; then
    echo "$override"
    return
  fi
  value="$(env_value "$key")"
  echo "${value:-$fallback}"
}

check_ports() {
  local owned port name flag
  owned="$(project_ports)"
  for entry in \
    "WEB_PORT:$(effective_port "$WEB_PORT" WEB_PORT 3000)" \
    "API_PORT:$(effective_port "$API_PORT" API_PORT 8000)" \
    "POSTGRES_PORT:$(effective_port "$POSTGRES_PORT" POSTGRES_PORT 5432)" \
    "REDIS_PORT:$(effective_port "$REDIS_PORT" REDIS_PORT 6379)"; do
    name="${entry%%:*}"
    port="${entry##*:}"
    if port_in_use "$port" && ! grep -qx "$port" <<<"$owned"; then
      flag="--$(echo "$name" | tr 'A-Z_' 'a-z-')"
      die "port $port ($name) đang bị tiến trình khác chiếm — đổi bằng $flag <port> hoặc tắt tiến trình đó (kiểm tra: ss -ltnp 'sport = :$port')."
    fi
  done
}

# Biến cho lần gọi compose. Ưu tiên env đã export > .env > default compose.
export_compose_env() {
  local pg_user pg_pass pg_db
  pg_user="${POSTGRES_USER:-$(env_value POSTGRES_USER)}"; pg_user="${pg_user:-gmov}"
  pg_pass="${POSTGRES_PASSWORD:-$(env_value POSTGRES_PASSWORD)}"; pg_pass="${pg_pass:-gmov_dev_password}"
  pg_db="${POSTGRES_DB:-$(env_value POSTGRES_DB)}"; pg_db="${pg_db:-gmov}"
  # Ep ve dia chi service: .env dev thuong tro localhost:5438/6389, neu de nguyen
  # thi container api se connect vao chinh no va chet.
  export DATABASE_URL="postgresql+asyncpg://$pg_user:$pg_pass@db:5432/$pg_db"
  export REDIS_URL="redis://redis:6379/0"
  set -a
  [ -n "$WEB_PORT" ] && export WEB_PORT
  [ -n "$API_PORT" ] && export API_PORT
  [ -n "$POSTGRES_PORT" ] && export POSTGRES_PORT
  [ -n "$REDIS_PORT" ] && export REDIS_PORT
  set +a
  return 0
}

wait_healthy() {
  local deadline=$((SECONDS + 180)) out ok service
  while [ "$SECONDS" -lt "$deadline" ]; do
    out="$(compose ps --format '{{.Service}} {{.State}} {{.Health}}' 2>/dev/null || true)"
    ok=1
    for service in "${SERVICES[@]}"; do
      grep -q "^$service running healthy" <<<"$out" || ok=0
    done
    [ "$ok" = 1 ] && return 0
    sleep 3
  done
  return 1
}

host_port() {
  compose port "$1" "$2" 2>/dev/null | head -1 | sed 's/.*://' || true
}

cmd_up() {
  require_env
  warn_default_secrets
  check_ports
  export_compose_env

  local build_args=() suffix=""
  if [ "$NO_CACHE" = 1 ]; then
    build_args+=(--no-cache)
    suffix=" (no-cache)"
  fi

  echo "[build] build + up: ${SERVICES[*]}$suffix"
  compose up -d --build "${build_args[@]}" "${SERVICES[@]}"

  echo "[build] chờ healthy..."
  if ! wait_healthy; then
    echo "[build] quá hạn 180s, trạng thái hiện tại:" >&2
    compose ps >&2 || true
    echo "[build] log gần nhất:" >&2
    compose logs --tail=30 "${SERVICES[@]}" >&2 || true
    exit 1
  fi

  local web_p api_p host
  host="$(hostname -f 2>/dev/null || hostname)"
  web_p="$(host_port web 3000)"
  api_p="$(host_port api 8000)"
  echo "[build] xong."
  echo "[build] web: http://$host:${web_p:-3000}"
  echo "[build] api: http://$host:${api_p:-8000}  (health: /health)"
  echo "[build] log: ./build.sh logs"
}

cmd_down() {
  local args=()
  [ "$VOLUMES" = 1 ] && args+=(-v)
  compose down "${args[@]}"
}

cmd_restart() {
  compose restart "${SERVICES[@]}"
}

cmd_logs() {
  local target=("${SERVICES[@]}")
  [ -n "$LOG_SERVICE" ] && target=("$LOG_SERVICE")
  compose logs -f --tail=100 "${target[@]}"
}

cmd_ps() {
  compose ps
}

while [ $# -gt 0 ]; do
  if [ "$COMMAND" = "logs" ] && [ -z "$LOG_SERVICE" ] && [[ "$1" =~ ^(db|redis|api|web)$ ]]; then
    LOG_SERVICE="$1"
    shift
    continue
  fi
  case "$1" in
    up|down|restart|logs|ps) COMMAND="$1"; shift ;;
    --web-port|--api-port|--postgres-port|--redis-port)
      [ $# -ge 2 ] || die "$1 cần một giá trị port"
      is_port "$2" || die "$1: '$2' không phải port hợp lệ (1-65535)"
      case "$1" in
        --web-port) WEB_PORT="$2" ;;
        --api-port) API_PORT="$2" ;;
        --postgres-port) POSTGRES_PORT="$2" ;;
        --redis-port) REDIS_PORT="$2" ;;
      esac
      shift 2 ;;
    --no-cache) NO_CACHE=1; shift ;;
    --volumes) VOLUMES=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "tham số không hợp lệ: '$1' (xem --help)" ;;
  esac
done

case "${COMMAND:-up}" in
  up) cmd_up ;;
  down) cmd_down ;;
  restart) cmd_restart ;;
  logs) cmd_logs ;;
  ps) cmd_ps ;;
  *) die "subcommand không hợp lệ: '$COMMAND' (xem --help)" ;;
esac
