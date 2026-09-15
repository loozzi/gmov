#!/usr/bin/env bash
# Sinh secrets production an toàn vào file .env.prod (KHÔNG commit file này).
# Dùng: ./scripts/gen-secrets.sh [domain] [output=.env.prod]
set -euo pipefail

DOMAIN="${1:-example.com}"
OUT="${2:-.env.prod}"

if [ -e "$OUT" ]; then
  echo "Refusing to overwrite existing $OUT (xóa tay nếu muốn tạo lại)."
  exit 1
fi

JWT_SECRET=$(openssl rand -hex 32)
POSTGRES_PASSWORD=$(openssl rand -hex 32)

cat > "$OUT" <<EOF
# Sinh tự động bởi scripts/gen-secrets.sh — KHÔNG commit, KHÔNG chia sẻ.
ENVIRONMENT=production
DOMAIN=$DOMAIN
ACME_EMAIL=admin@$DOMAIN
JWT_SECRET=$JWT_SECRET
POSTGRES_USER=gmov
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
POSTGRES_DB=gmov
CORS_ORIGINS=https://$DOMAIN
PUBLIC_API_URL=https://$DOMAIN
EOF
chmod 600 "$OUT"
echo "Wrote $OUT (mode 600). Đổi DOMAIN/ACME_EMAIL cho đúng rồi chạy:"
echo "  set -a; source $OUT; set +a"
echo "  docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d"
