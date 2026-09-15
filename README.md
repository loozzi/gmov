# gmov — web xem phim

Streaming web lấy dữ liệu từ API công khai NguonC (https://phim.nguonc.com):
duyệt/tìm kiếm/lọc phim, xem HLS, tài khoản thường, "Xem tiếp", yêu thích, lịch sử.

## Stack

- `apps/api`: FastAPI (Python 3.12, SQLAlchemy 2.0 async, PostgreSQL 16, Redis 7)
- `apps/web`: Next.js 15 + TypeScript strict + Tailwind CSS v4
- Hạ tầng: Docker multi-stage + docker-compose. Xem `AGENTS.md` để biết quy ước.

## Quickstart

```bash
cp .env.example .env   # optional — compose runs with defaults without it
docker compose up --build
```

- Web: http://localhost:3000
- API: http://localhost:8000 — health: http://localhost:8000/health
- Docs: `docs/nguonc-api.md` (upstream schema thực tế), `docs/decisions.md`
