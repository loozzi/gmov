# AGENTS.md — working agreement for gmov (all phases must re-read this file)

## Stack (mandatory)

- Monorepo: `apps/api` (FastAPI) + `apps/web` (Next.js). pnpm workspace for web.
- Backend: Python 3.12, FastAPI, SQLAlchemy 2.0 (async) + asyncpg, Alembic,
  Pydantic v2, pydantic-settings, PostgreSQL 16, Redis 7, httpx (async),
  passlib[bcrypt], PyJWT. Dependencies via `uv` (`apps/api/pyproject.toml` + `uv.lock`).
- Frontend: Next.js 15 (App Router) + TypeScript strict, Tailwind CSS v4,
  shadcn/ui, lucide-react, TanStack Query v5, zustand, hls.js, next/image.
- Infra: multi-stage Dockerfiles in `docker/` (+ `entrypoint-api.sh`, `nginx.conf`),
  `docker-compose.yml` (api, web, db, redis, nginx on `gmov-net`) and
  `docker-compose.dev.yml` override (hot reload, source mounts).

## Directory layout

```
.
├── apps/api/        # FastAPI: app/ (routers, services, models, schemas, core)
├── apps/web/        # Next.js App Router
├── docker/          # Dockerfile.api, Dockerfile.web, (later) nginx.conf
├── docs/            # nguonc-api.md, decisions.md, (later) phase plans
├── docker-compose.yml
├── .env.example     # full template, no secrets
├── AGENTS.md        # this file
└── README.md
```

Upstream film source: https://phim.nguonc.com/api — real schemas documented in
`docs/nguonc-api.md`. NEVER invent upstream fields; if a response differs,
trust the response and update that doc.

## Dev commands

```bash
cp .env.example .env            # optional; compose has defaults
docker compose up --build       # production-like: web :80 (nginx), api :8000
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build  # dev hot reload

# backend (local, without docker)
cd apps/api && uv sync && uv run uvicorn app.main:app --reload

# frontend (local, without docker)
pnpm install                    # at repo root
pnpm --filter gmov-web dev
```

## Conventions

- Commits: Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`),
  message in English, scope-clear. ≥1 meaningful commit per phase.
- Python: `snake_case`, modules <300 lines, layered split
  (router → service → repository/model; no DB access in routers).
  Full type hints; Pydantic v2 schemas at API boundary.
- TypeScript: `camelCase` vars, `PascalCase` components, strict TS, no `any`
  without justification. Server Components by default; `"use client"` only where needed.
- API routes: `/api/<resource>` (e.g. `/api/films`, `/api/auth/login`).
- Env: new variable → add to `.env.example` + `docker-compose.yml` default the same PR.
  NEVER commit `.env` or secrets.
- Ambiguous architecture choice → pick the most common option, log it in
  `docs/decisions.md`, keep going. Do not block on trivia.

## Pre-commit checklist (every phase)

1. `docker compose up --build` succeeds; `/health` (api) and web `/` respond.
2. No secrets in diff (`git diff --cached` reviewed); `.env` untracked.
3. New/changed endpoints or schemas reflected in `docs/` if applicable.
4. Commit message follows Conventional Commits, in English.
5. Push to remote after commit.
