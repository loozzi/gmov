# Architecture decisions

Log ambiguous decisions here (Phase 0+). Newest last.

## 2026-09-15 — Phase 0 bootstrap

1. **No questions asked for trivial choices.** Per project instructions, the agent
   picks the most common option and records it here.
2. **Upstream identity = `slug`.** List items have no `id`; only detail has one.
   All user data (favorites, history, progress) keys by `slug`.
3. **Backend proxies + caches NguonC; frontend never calls NguonC directly.**
   Reason: single place for caching (Redis), timeout/retry, schema normalization,
   and hiding upstream flakiness. Cache key `nguonc:{path}:{query}`, TTL ~1h.
4. **JWT auth with PyJWT (HS256), no email verification.** Matches product spec
   (plain username/password accounts). `passlib[bcrypt]` for password hashing.
   (Known risk: passlib 1.7.4 vs bcrypt>=4.1 incompatibility — pin/evaluate in
   the auth phase; alternative is `pwdlib`.)
5. **Tailwind CSS v4 (`@import "tailwindcss"`) from day one.** shadcn/ui,
   TanStack Query, zustand, hls.js land in their feature phases, not Phase 0.
6. **pnpm workspace, single `pnpm-lock.yaml` at root; `uv.lock` committed for
   `apps/api`.** Both lockfiles are committed for reproducible Docker builds.
7. **Docker multi-stage for both apps; `docker-compose.yml` works with zero
   config** (sane `VAR:-default` fallbacks, `.env` optional). `nginx` deferred
   to a later hardening phase.
8. **`episodes[].server_data` observed empty on 2026-09-15.** Episode/stream
   parsing stays TBD until re-probed in the player phase; parser must handle
   empty lists. No stream field names invented.
