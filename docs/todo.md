# Tech debt & follow-ups (reviewed 2026-09-15)

Brought forward — none blocks current functionality.

## Backend

1. ~~No rate limit on `/auth/register`~~ — DONE (Batch 2: 3/h + 10/day/IP,
   honeypot, trusted-proxy IP). Còn lại: CAPTCHA nếu bị abuse có chủ đích.
2. **No refresh-token reuse detection** — rotation revokes the old token, but a
   stolen refresh used twice isn't flagged. Consider invalidating the whole
   token family on reuse.
3. ~~Refresh flow isn't atomic~~ — DONE (Batch 3: single-transaction rotation
   + rollback, proven by signer-outage test).
4. ~~`expires_at` never pruned~~ — DONE (Batch 3: APScheduler purge every 6h +
   `expires_at` index). Còn lại: theo dõi log purge sau deploy thật.
5. **Login rate-limit key is IP-only** — shared NATs share a bucket; consider
   `ip+username` composite key.
6. **`GET /health` always returns 200** — orchestrators can't distinguish
   degraded state (intentional; revisit if alerting needs it).

## Frontend

7. ~~No web E2E tests~~ — DONE (Batch 4: Playwright, 8 specs auth/browse/
    library/player-resume + CI job + trace upload). Còn lại: mở rộng khi có
    tính năng mới.
8. ~~No `sitemap.xml` / `robots.txt`~~ — DONE (Batch 5: `app/sitemap.ts`
    ~1000 URL từ upstream latest, revalidate 6h + `app/robots.ts`. Verify live:
    1004 URL).
9. ~~`NEXT_PUBLIC_API_URL` baked at build time~~ — DONE rồi SUPERSEDED:
    single-origin proxy (`app/api/v1/[...path]/route.ts` streaming tới
    `BACKEND_URL`); xóa `/api/config` + `PUBLIC_API_URL` hoàn toàn, còn 1 biến.
10. **Embed player is a black box** — GIỮ LẠI CỐ TÌNH: nguồn chỉ có embed
    (Batch 1 verdict C, re-verify Batch 5 không thay đổi). Không có cách hợp lệ
    nào để tracking cross-origin; "Xem tiếp" giữ ở mức tập phim + đánh dấu tay.
11. **`/xem` bundle ~190kB** (hls.js) — GIỮ LẠI CỐ TÌNH: đã route-split (chỉ tải
    ở trang xem), và là đường dự phòng khi upstream có m3u8. Lazy-load thêm chỉ
    tiết kiệm vài chục kB với code phức tạp hơn — không đáng.
12. ~~Search suggestions lack keyboard navigation~~ — DONE (Batch 5: ↑/↓/Enter/
    Esc + `role=combobox/listbox/option`, `aria-activedescendant`. Có E2E test).
13. ~~No PWA / offline support~~ — DONE (Batch 5: OG image tự thiết kế
    `opengraph-image.tsx`, `manifest.ts`, `icon.svg`, SW app-shell + trang
    `/offline`. SW KHÔNG cache video/media/API/cross-origin — cố tình).

## Infra / Docs

14. **No registry push / deploy pipeline** — CI only builds images. Add push +
    release versioning when a registry is chosen.
15. ~~Secrets are dev-defaults in compose~~ — DONE (Batch 2: production guard
    chết ngay khi boot + `docker-compose.prod.yml` với `${VAR:?}` +
    `scripts/gen-secrets.sh`). Còn lại: xoay secret định kỳ.
16. ~~No DB backups~~ — DONE (Batch 3: `db-backup` service daily+gzip+rotation,
    `scripts/restore.sh`, `docs/backup.md`, live restore test PASS 2026-09-15).
    Còn lại: copy backup off-site (S3/rclone).
17. ~~Nginx has no TLS~~ — DONE (Batch 2: `nginx.tls.conf.template` + certbot
    service + `docs/deploy.md`). Còn lại: deploy thật lên domain + thắt CSP
    bằng nonce thay `'unsafe-inline'`.

## Kiểm duyệt bình luận (nợ tương lai, ngoài scope v1)

18. **Chưa có ban/khoá người dùng** — chỉ ẩn bình luận, không cấm được
    người đăng. Thêm khi bị spam lặp lại.
19. **Chưa có spoiler tag** — `reason=spoiler` chỉ dùng để báo cáo, không có
    cơ chế đánh dấu/che nội dung chủ động.
20. **Chưa có thông báo cho moderator** — không email/push khi hàng đợi có
    báo cáo mới; moderator phải tự vào `/admin/reports`.
21. **Chưa có auto-moderation theo từ khoá** — chỉ ẩn theo ngưỡng số người
    báo cáo, không lọc nội dung tự động.
