# Tech debt & follow-ups (reviewed 2026-09-16)

Brought forward — none blocks current functionality.

## Backend

1. ~~No rate limit on `/auth/register`~~ — DONE (Batch 2: 3/h + 10/day/IP,
   honeypot, trusted-proxy IP). Còn lại: CAPTCHA nếu bị abuse có chủ đích.
2. ~~No refresh-token reuse detection~~ — DONE (Hardening 2026-09-16: mỗi
   login phiên một `family_id`; token đã revoke bị trình lại sau cửa sổ grace
   30s → revoke toàn bộ family còn sống + đánh dấu `compromised`, trả 401
   `INVALID_REFRESH_TOKEN`).
3. ~~Refresh flow isn't atomic~~ — DONE (Batch 3: single-transaction rotation
   + rollback, proven by signer-outage test).
4. ~~`expires_at` never pruned~~ — DONE (Batch 3: APScheduler purge every 6h +
   `expires_at` index). Còn lại: theo dõi log purge sau deploy thật.
5. ~~Login rate-limit key is IP-only~~ — DONE (Hardening 2026-09-16: key tổ hợp
   `ip+username` — `ratelimit:login-fail:{ip}:{username.lower()}` — nên NAT
   dùng chung không còn chia chung bucket brute-force).
6. **`GET /health` always returns 200** — GIỮ LẠI CỐ TÌNH: orchestrators không
   cần phân biệt trạng thái suy giảm; xem lại nếu alerting yêu cầu.

## Frontend

7. ~~No web E2E tests~~ — DONE (Batch 4: Playwright + CI job + trace upload).
   Đã mở rộng: `moderation.spec` (đăng → báo cáo qua UI → ẩn → placeholder →
   bỏ ẩn → dọn dẹp, 2026-09-16). Còn lại: mở rộng tiếp khi có tính năng mới.
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

18. ~~**Chưa có ban/khoá người dùng**~~ — DONE (2026-09-17: `users.banned_at`
    + `ban_reason`, `POST /admin/users/{id}/ban|unban`, thực thi ở
    `deps._resolve_user`/login/refresh; UI cấm/bỏ cấm ngay trên hàng report).
    Còn lại: chưa có trang danh sách người bị cấm (phải vào từ hàng report của
    họ) — xem #30.
19. ~~**Chưa có spoiler tag**~~ — DONE (2026-09-17): cột
    `comments.has_spoiler` + tác giả tự tick + ngưỡng tự động
    `COMMENT_SPOILER_REPORT_THRESHOLD=2` + moderator
    `/admin/comments/{id}/spoiler|unspoiler`; veil che mờ ở client
    (decisions #138, `docs/api-moderation.md`).

## Nợ phát sinh từ hardening + kiểm duyệt (2026-09-16)

22. ~~**Refresh reuse: grace-path lọt family revocation**~~ — DONE
    (2026-09-17): `pg_advisory_xact_lock` theo family ở cả `refresh` và
    `logout` (guard dialect, test SQLite không đổi) + `logout` xoá cả family;
    test Postgres-only `test_auth_concurrency_integration.py` (mutation test
    xác nhận đỏ khi tắt lock). decisions #139 điều chỉnh #80.

30. **Chưa có trang quản lý người bị cấm** — cấm/bỏ cấm chỉ thao tác được từ
    hàng report của người đó (`AdminCommentUser.id`); không có `GET /admin/users`
    để xem/lọc danh sách đang bị cấm. Thêm khi số lượng ban đủ nhiều để cần.

## Lộ trình tính năng (profiles & recommendations)

31. ~~**M1 — Profiles**~~ — DONE (2026-09-17): profiles per tài khoản (tối đa
    5), dữ liệu xem re-key sang `profile_id`, profile trong phiên (`sid`/`pid`),
    CRUD + switch + PIN soft-gate, UI `/profiles` + `/profiles/manage` +
    header switcher. API: `docs/api-profiles.md`; quyết định: `docs/decisions.md`
    #112–116; E2E: `apps/web/e2e/profiles.spec.ts`.
32. ~~**M2 — Onboarding & gợi ý**~~ — DONE (2026-09-17): kho catalog snapshot
    (`catalog_items`) + refresh APScheduler TTL 24h/CLI, sở thích per-profile
    (`profile_preferences`: quiz + poster like), engine xếp hạng deterministic
    (trọng số explicit lưu DB, hành vi tính lúc scoring), onboarding 3 bước
    (`/onboarding`, skip được), rail "Gợi ý cho bạn" kèm `reason` + fallback
    "Phổ biến"/"Mới cập nhật" (ẩn khi `newest`), và "Làm lại sở thích" trong
    `/profiles/manage`. API: `docs/api-recommendations.md`; quyết định:
    `docs/decisions.md` #117–126; E2E: `apps/web/e2e/onboarding.spec.ts`.

## Nợ phát sinh từ M2 (onboarding & gợi ý)

33. **Poster bị "bỏ qua" không được lưu.** `POST /me/preferences/posters` nhận
    `skipped` nhưng `profile_preferences` không có cột nên tín hiệu âm này mất;
    engine chỉ nhận tín hiệu dương từ poster like. Nếu cần "đừng gợi ý thể loại
    này nữa" thì phải thêm cột + migration (debt nhỏ, cố ý không làm v1).
34. **Lý do gợi ý chỉ là text per-card, không có UI phụ.** `MovieRail.reasons`
    render một dòng `"Vì bạn thích <nhãn>"` dưới card; không có tooltip/badge
    riêng, và rail fallback luôn `reason = null`. Đủ dùng cho v1, mở rộng khi
    cần giải thích gợi ý trực quan hơn.
