# Tech debt & follow-ups (reviewed 2026-09-15)

Brought forward — none blocks current functionality.

## Backend

1. ~~No rate limit on `/auth/register`~~ — DONE (Batch 2: 3/h + 10/day/IP,
   honeypot, trusted-proxy IP). Còn lại: CAPTCHA nếu bị abuse có chủ đích.
2. **No refresh-token reuse detection** — rotation revokes the old token, but a
   stolen refresh used twice isn't flagged. Consider invalidating the whole
   token family on reuse.
3. **Refresh flow isn't atomic** — if issuing the new pair fails after revoking
   the old row, the user must log in again. Wrap rotate+issue in one transaction.
4. **`expires_at` never pruned** — `refresh_tokens` grows forever. Add periodic
   cleanup of expired/revoked rows.
5. **Login rate-limit key is IP-only** — shared NATs share a bucket; consider
   `ip+username` composite key.
6. **`GET /health` always returns 200** — orchestrators can't distinguish
   degraded state (intentional; revisit if alerting needs it).

## Frontend

7. **No web E2E tests** — only backend pytest exists. Add Playwright flows
   (register → browse → watch → resume) in CI.
8. **No `sitemap.xml` / `robots.txt`** — dynamic slugs unknown at build; add a
   sitemap route backed by upstream latest pages.
9. **`NEXT_PUBLIC_API_URL` baked at build time** — switching API domain needs a
   rebuild. Consider runtime config endpoint for the public bundle.
10. **Embed player is a black box** — no progress tracking or error detection
    possible cross-origin; revisit if upstream ever serves direct `m3u8`.
11. **`/xem` bundle ~190kB** (hls.js) — fine today since it's route-split, but
    lazy-load the HLS path only when `m3u8_url` exists.
12. **Search suggestions lack keyboard navigation** (arrow keys + enter).
13. **No PWA / offline support**, no default OG image for pages without poster.

## Infra / Docs

14. **No registry push / deploy pipeline** — CI only builds images. Add push +
    release versioning when a registry is chosen.
15. ~~Secrets are dev-defaults in compose~~ — DONE (Batch 2: production guard
    chết ngay khi boot + `docker-compose.prod.yml` với `${VAR:?}` +
    `scripts/gen-secrets.sh`). Còn lại: xoay secret định kỳ.
16. **No DB backups** — `pgdata` volume has no backup/restore documented.
17. ~~Nginx has no TLS~~ — DONE (Batch 2: `nginx.tls.conf.template` + certbot
    service + `docs/deploy.md`). Còn lại: deploy thật lên domain + thắt CSP
    bằng nonce thay `'unsafe-inline'`.
