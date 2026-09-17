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
19. **Chưa có spoiler tag** — `reason=spoiler` chỉ dùng để báo cáo, không có
    cơ chế đánh dấu/che nội dung chủ động.
20. **Chưa có thông báo cho moderator** — không email/push khi hàng đợi có
    báo cáo mới; moderator phải tự vào `/admin/reports`.
21. ~~**Chưa có auto-moderation theo từ khoá**~~ — DONE (2026-09-17:
    `MODERATION_BLOCKED_KEYWORDS` + `services/moderation_filter.py`, khớp
    không phân biệt hoa/thường/dấu tiếng Việt, ẩn ngay + tạo report
    `source=auto` vào hàng đợi). Còn lại: obfuscation kiểu "s.p.a.m"/zero-width
    không bị bắt (khớp chuỗi con thuần).

## Nợ phát sinh từ hardening + kiểm duyệt (2026-09-16)

22. **Refresh reuse: grace-path lọt family revocation** — dưới READ COMMITTED
    (Postgres), một rotation hợp lệ trên member sống KHÁC có thể INSERT token
    mới sau khi theft branch đã khóa family (family lock không predicate-lock
    row mới). Đóng hẳn cần `SELECT ... FOR UPDATE` kèm predicate hoặc
    `pg_advisory_xact_lock(hash(family_id))`. Không test được trên SQLite.
23. **Access token sống ≤30 phút sau khi family bị compromise** — bản chất JWT
    stateless (`ACCESS_TOKEN_EXPIRE_MINUTES`), chấp nhận cho v1. Thu hồi tức
    thì cần denylist/versioned token.
24. **Migration backfill `refresh_tokens.family_id`** — `UPDATE ... SET
    family_id = id` quét toàn bảng dưới ACCESS EXCLUSIVE; ổn ở scale hiện tại,
    batch nếu bảng lớn.
25. ~~**`Comment.is_hidden` dùng `server_default="false"`**~~ — DONE
    (2026-09-17: model đổi sang `false()` + migration `c41d7e9b2a05`
    (`alter_column server_default=sa.false()`). Xác nhận lại bug: DDL SQLite là
    `DEFAULT 'false'` → lưu **text** `'false'` → `bool()` = True; test mới
    `tests/test_comment_hidden_default.py` (upgrade migration rồi INSERT raw
    không set `is_hidden`) đỏ trước / xanh sau. Postgres đã verify: default là
    boolean `false`, raw insert trả `f`).
26. **E2E fixture bypass throttle** — `global-setup` xóa key `ratelimit:*` thay
    vì nâng cap; chỉ trong test env, chấp nhận.
27. ~~**`player.spec` đã fail sẵn trong môi trường này**~~ — DONE (2026-09-17).
    Điều tra bằng probe đo timeline: toast hiện ở 107ms nhưng seek chỉ áp ở
    ~208ms (video còn autoplay từ 0 trước đó) → đúng 2 race của **test**, không
    phải bug sản phẩm: (a) `VideoPlayer` mặc định `autoPlay = true` + Playwright
    ép `--autoplay-policy=no-user-gesture-required` nên nút overlay "Phát"
    unmount giữa lúc click → Playwright retry tới hết 240s; (b) test đọc
    `currentTime` một lần ngay sau toast, rơi vào khe ~100ms trước khi seek áp
    (cold cache thì lâu hơn). Sửa: click best-effort (`timeout: 5s` + catch) và
    chờ **vị trí khác 0 đầu tiên** (≥2s) thay vì đọc một lần — resume đúng nhảy
    ngay tới ~t1, còn resume hỏng phát lại từ 0 nên chỉ đạt 2s sau ~2s và bị
    bound ±5s bắt. Verify: 3/3 pass (`--repeat-each=3`) + mutation test (ép
    `target = 0`) fail đúng "got 2.05".
28. **Pool "Phim liên quan" bị giới hạn bởi dữ liệu upstream (đã ĐO, đừng
    tăng page mù quáng)** — đo 2026-09-17 trên 4 phim (`de-che-dai-han-phan-1`,
    `luc-luong-lanterns-phan-1`, `giac-quan-thu-sau-mat-trai`, `tay-co-bac`):
    mọi listing (genre/country/year) trả **10 item/trang**, xếp mới-nhất-trước;
    match cùng người **chỉ xuất hiện ở trang 1**, các trang sâu hơn 0 hit
    (year list 7 trang: 0 unique; genre list #3+ chỉ lặp lại hit đã có ở #1) và
    2/4 phim không có match cùng người nào dù quét hết genre+country+year. Kết
    luận: `CANDIDATE_PAGES=3`/`MAX_GENRE_LISTS=2` **không phải** nút thắt — tăng
    độ sâu chỉ tốn thêm call upstream mà ~0 giá trị. Fix thật sự duy nhất là
    **index cast/director riêng** (crawl toàn catalog để tra "phim khác của
    người này"), ngoài scope v1; đường ống hiện tại đã lấy hết tín hiệu mà
    upstream cho phép (chi tiết + số đo: decisions #107).
29. ~~**`/related` chưa có rate limit theo IP**~~ — DONE (2026-09-17: 60
    req/phút/IP qua `check_rate_limit`, tính cả cache HIT; chỉ endpoint catalog
    này bị giới hạn vì mỗi cache miss fan-out ~10 call upstream).

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
35. **Đổi/đặt PIN không thu hồi phiên đã gắn profile đó.** Từ #136, "đã xác minh
    PIN" chính là `refresh_tokens.profile_id`; phiên đã chọn profile trước khi
    PIN được đặt vẫn giữ nguyên lựa chọn, nên đứa trẻ đang mở sẵn phiên đó không
    bị đá ra khi phụ huynh đặt PIN. Muốn bịt: khi `set_pin` đổi/đặt PIN, set
    `profile_id = NULL` cho mọi phiên khác của profile (giữ phiên hiện tại, vì nó
    vừa chứng minh mật khẩu + `current_pin`). Cố ý để ngoài phạm vi fix login.
