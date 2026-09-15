# Deploy production (domain + HTTPS)

Stack prod = `docker-compose.yml` + `docker-compose.prod.yml` (secrets thật,
nginx TLS, certbot). Mọi lệnh dưới chạy tại root repo.

## 0. Chuẩn bị

- Một VPS có Docker Engine ≥ 24 + Compose v2, mở port 80/443.
- Domain (ví dụ `phim.example.com`) trỏ bản ghi **A** về IP VPS. Kiểm tra:
  `dig +short phim.example.com` phải trả về IP VPS trước khi xin cert.

## 1. Sinh secrets

```bash
./scripts/gen-secrets.sh phim.example.com   # tạo .env.prod (mode 600)
# Mở .env.prod kiểm tra DOMAIN / ACME_EMAIL, KHÔNG commit file này.
```

## 2. Build + start (chưa có nginx)

```bash
set -a; source .env.prod; set +a
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build db redis api web
```

API tự từ chối boot nếu `JWT_SECRET`/`POSTGRES_PASSWORD` yếu
(`FATAL config error` trong log) — đó là tính năng, không phải bug.

## 3. Xin cert lần đầu

Port 80 còn trống (nginx chưa chạy) nên dùng standalone:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml run --rm -p 80:80 certbot \
  certonly --standalone --non-interactive --agree-tos \
  -m "$ACME_EMAIL" -d "$DOMAIN"
```

## 4. Bật nginx TLS

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build nginx
curl -sI https://phim.example.com/health   # expect 200 + Strict-Transport-Security
```

## 5. Gia hạn tự động (cron trên host, chạy 1 lần/tuần)

Certbot webroot cần nginx đang chạy:

```bash
0 3 * * 0 cd /opt/gmov && set -a; source .env.prod; set +a; \
  docker compose -f docker-compose.yml -f docker-compose.prod.yml run --rm certbot >/dev/null 2>&1 && \
  docker compose -f docker-compose.yml -f docker-compose.prod.yml exec nginx nginx -s reload
```

Service `certbot` mặc định là `certonly --webroot --keep-until-expiring`
→ no-op khi cert còn hạn, chỉ gia hạn khi sắp hết.

## 6. Cập nhật code

```bash
git pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

## Dùng edge khác thay certbot

- **Cloudflare (khuyến nghị nếu đã dùng CF):** bật proxy (đám mây cam) + SSL
  mode `Full (strict)`, origin vẫn chạy compose plain-HTTP (base file, port 80
  nội bộ). Khi đó KHÔNG dùng `docker-compose.prod.yml` cho nginx/certbot —
  chỉ cần `ENVIRONMENT=production` + secrets thật cho service api
  (có thể export tay thay vì cả file prod). Bỏ qua toàn bộ mục 3–5.
- **Caddy:** thay service nginx bằng caddy (`reverse_proxy web:3000`,
  `reverse_proxy /api/* api:8000`), Caddy tự xin + gia hạn cert, không cần
  certbot service.
