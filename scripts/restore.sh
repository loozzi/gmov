#!/usr/bin/env bash
# Khôi phục DB gmov từ file backup .sql.gz (tạo bởi db-backup service).
# Chạy qua `docker compose exec` nên KHÔNG cần psql trên host.
#
# Dùng: ./scripts/restore.sh [--yes] [--service db] <đường-dẫn-file-backup>
#
# Cảnh báo: file dump chứa DROP statements (--clean) nên các object hiện có
# trong DB đích sẽ bị thay thế. Kiểm tra kỹ DB đích trước khi chạy.
set -euo pipefail

SERVICE="db"
YES=0
FILE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --yes) YES=1; shift ;;
    --service) SERVICE="$2"; shift 2 ;;
    -h|--help)
      echo "Dùng: $0 [--yes] [--service db] <backup.sql.gz>"; exit 0 ;;
    *) FILE="$1"; shift ;;
  esac
done

if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  echo "Lỗi: file backup không tồn tại: '${FILE:-<trống>}'" >&2
  echo "Dùng: $0 [--yes] <backup.sql.gz>" >&2
  exit 1
fi
case "$FILE" in
  *.sql.gz) ;;
  *) echo "Lỗi: file phải có đuôi .sql.gz" >&2; exit 1 ;;
esac

PGUSER="${PGUSER:-gmov}"
PGDATABASE="${PGDATABASE:-gmov}"

echo "Chuẩn bị restore '$FILE' vào DB '$PGDATABASE' (service '$SERVICE')."
if [ "$YES" -ne 1 ]; then
  read -r -p "Object hiện có sẽ bị DROP + tạo lại. Tiếp tục? [y/N] " ans
  [ "$ans" = "y" ] || [ "$ans" = "Y" ] || { echo "Hủy."; exit 1; }
fi

gunzip -c "$FILE" | docker compose exec -T "$SERVICE" \
  psql -U "$PGUSER" -d "$PGDATABASE" -v ON_ERROR_STOP=1 -q

echo "--- verify ---"
docker compose exec -T "$SERVICE" psql -U "$PGUSER" -d "$PGDATABASE" -c \
  "SELECT 'users=' || (SELECT count(*) FROM users) || ' favorites=' || (SELECT count(*) FROM favorites) || ' watch_progress=' || (SELECT count(*) FROM watch_progress) || ' refresh_tokens=' || (SELECT count(*) FROM refresh_tokens) AS counts;"
echo "Restore xong."
