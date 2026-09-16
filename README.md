# gmov — web xem phim

[![CI](https://github.com/loozzi/gmov/actions/workflows/ci.yml/badge.svg)](https://github.com/loozzi/gmov/actions/workflows/ci.yml)

Streaming web lấy dữ liệu từ API công khai NguonC (https://phim.nguonc.com):
duyệt/tìm kiếm/lọc phim, xem qua trình phát nhúng, tài khoản thường, "Xem tiếp",
yêu thích, lịch sử xem.

## Stack

- `apps/api`: FastAPI (Python 3.12, SQLAlchemy 2.0 async, PostgreSQL 16, Redis 7)
- `apps/web`: Next.js 15 + TypeScript strict + Tailwind CSS v4
- Hạ tầng: Docker multi-stage + docker-compose + nginx reverse proxy.
- Quy ước làm việc: `AGENTS.md`. Tài liệu API: `docs/api-auth.md`,
  `docs/api-movies.md`, `docs/api-library.md`. Quyết định kiến trúc:
  `docs/decisions.md`.

## Yêu cầu hệ thống

- Docker Engine ≥ 24 + Docker Compose v2 (chạy production hoặc full stack), **hoặc**
- Local dev: Python 3.12 + `uv`, Node.js 22 + `pnpm` 9+, Postgres 16, Redis 7.

## Chạy production (khuyến nghị)

```bash
cp .env.example .env   # sửa JWT_SECRET + POSTGRES_PASSWORD thật
docker compose up --build -d
```

Có domain + muốn HTTPS: làm theo `docs/deploy.md` (`scripts/gen-secrets.sh` +
`docker-compose.prod.yml` với nginx TLS + certbot).

- Web: http://localhost (nginx → web), API trực tiếp: http://localhost:8000
- API qua nginx: http://localhost/api/v1/movies/latest, health: http://localhost/health
- Xem logs: `docker compose logs -f api web`
- Dừng: `docker compose down` (giữ data) / `docker compose down -v` (xóa sạch DB)

> Browser chỉ gọi cùng origin với web (`/api/v1/*` được proxy server-side
> tới backend). Backend chạy port khác `:8000`? Báo cho web lúc chạy dev:
> `BACKEND_URL=http://localhost:8008 pnpm --filter gmov-web dev`.
> Lưu ý: request `/api/*` luôn cùng origin với web (httpOnly cookie bắt buộc
> same-origin) — đó là thiết kế, không phải bug.

## Chạy dev (hot reload)

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

Mount source trực tiếp: sửa code là api (uvicorn `--reload`) và web (`next dev`)
tự nạp lại. Truy cập dev thẳng http://localhost:3000 (web) và
http://localhost:8000/docs (Swagger).

Chạy lẻ từng app (cần Postgres/Redis local, API mặc định `:8000`):

```bash
./scripts/dev.sh   # một lệnh chạy cả hai: dựng db/redis (nếu chưa có),
                   # api :8008 + web :3000; Ctrl-C dừng cả hai (db/redis giữ lại).
                   # Đổi port: API_PORT=8000 WEB_PORT=3001 ./scripts/dev.sh

```bash
# backend
cd apps/api && uv sync && uv run uvicorn app.main:app --reload
# test backend
cd apps/api && uv run pytest -q

# frontend (tại root repo)
pnpm install
pnpm --filter gmov-web dev
pnpm --filter gmov-web build   # phải pass trước khi commit
```

> Backend chạy port khác `:8000`? Báo cho web biết lúc chạy dev:
> `BACKEND_URL=http://localhost:8008 pnpm --filter gmov-web dev`.
> Mọi request `/api/*` luôn cùng origin với web — đó là thiết kế, không phải bug.

## CI

GitHub Actions (`.github/workflows/ci.yml`) chạy mỗi push/PR: ruff + pytest
backend (trừ test integration cần mạng), lint/typecheck/build frontend, và build
2 Docker image (không push registry). Lighthouse đo tay 2026-09-15: trang chủ
**93**, chi tiết phim **95** (mục tiêu ≥ 85).

## Tạo tài khoản đầu tiên

1. Mở web → **Đăng ký** (email, tên đăng nhập ≥3 ký tự, mật khẩu ≥8 ký tự).
2. Đăng ký xong tự đăng nhập. Hoặc gọi API trực tiếp:

```bash
curl -X POST http://localhost:8000/api/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"ban@example.com","username":"ten_cua_ban","password":"mat-khau-8-ky-tu"}'
```

## Troubleshooting

| Triệu chứng | Cách xử lý |
|---|---|
| `api` báo `Connection refused` tới DB | Chờ `db` healthy: `docker compose ps`; compose đã có `depends_on`, thường tự hết sau vài giây |
| `alembic upgrade head` lỗi khi start api | Xem log `docker compose logs api`; DB trống thì migration tự tạo bảng lần đầu — không chạy tay |
| Web trắng trang / API 502 `UPSTREAM_ERROR` | Nguồn NguonC chập chờn — thử lại sau; response cache sẽ kèm header `X-Cache: STALE` |
| `ERR_PNPM_IGNORED_BUILDS` khi build web | `allowBuilds` đã commit trong `pnpm-workspace.yaml`; nếu thêm dep mới cần build script, chạy `pnpm approve-builds` rồi commit |
| Port 80/3000/8000/5432 bận | Đổi `NGINX_PORT`/`WEB_PORT`/`API_PORT`/`POSTGRES_PORT` trong `.env` |
| Quên mật khẩu postgres dev | Mặc định `gmov_dev_password` (xem `.env.example`); reset sạch: `docker compose down -v` rồi `up` lại |
| Next build lỗi `notFound()` trả 200 | Hành vi chuẩn của Next với streamed routes (đã xác minh) — UI + thẻ noindex vẫn đúng |
