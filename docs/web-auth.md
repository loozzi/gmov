# Web app shell (Phase 4)

## Auth flow

- Access token: memory-only (`lib/api.ts` module variable, never localStorage).
- Refresh token: httpOnly cookie `gmov_refresh` (30 days, `SameSite=Lax`,
  `Secure` in prod), set/rotated/cleared by Next Route Handlers:
  - `POST /api/auth/login` `{username, password}` → backend OAuth2 form →
    sets cookie, returns `{access_token}`.
  - `POST /api/auth/refresh` (cookie) → backend rotate → new cookie +
    `{access_token}`.
  - `POST /api/auth/logout` (cookie) → backend revoke + clear cookie.
- `apiFetch` attaches `Authorization: Bearer`, and on 401 performs ONE
  mutex-guarded refresh (`refreshPromise` shared) before retrying once.
- `AuthProvider` (boot: silent refresh → `/users/me`), `useAuth()` hook.
- `middleware.ts` redirects `/me/*` → `/login?next=...` when the cookie is absent.
- Server→backend base URL: `BACKEND_URL` (docker: `http://api:8000`);
  browser→backend: `NEXT_PUBLIC_API_URL`.

## UI

- Dark-first theme, brand accent rose `#e11d48` via Tailwind v4 `@theme` vars.
- shadcn-style primitives in `components/ui` (button, input, dropdown-menu,
  sheet, skeleton). Forms: react-hook-form + zod, server errors mapped to
  Vietnamese (`lib/errors.ts`).
- Browse pages (`/`, `/search`, `/list/[type]`, `/the-loai/[slug]`,
  `/quoc-gia/[slug]`, `/nam/[year]`) share `MovieGrid` + TanStack Query hooks
  (`lib/movies.ts`) with skeleton/error/empty states and pagination.
