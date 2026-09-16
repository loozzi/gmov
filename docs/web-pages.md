# Content pages (Phase 5)

## Rendering strategy

- **Server Components first (SEO):** `/`, `/list/[type]`, `/the-loai/[slug]`,
  `/quoc-gia/[slug]`, `/nam/[year]`, `/tim-kiem`, `/phim/[slug]` fetch the
  backend directly via `lib/server-movies.ts` (`BACKEND_URL`, never exposed
  to the browser).
- **Dynamic, not pre-rendered:** browse pages use `export const dynamic =
  "force-dynamic"` because build-time prerendering would bake in EMPTY data
  (no backend at Docker build time). SSR HTML is still fully indexable.
  Detail pages keep `revalidate = 1800` (dynamic route + data cache).
- **Client islands:** hero carousel, continue-watching rail, favorite button
  (optimistic), resume button, search suggestions, `/me/*` pages.

## Pages

- `/` — hero carousel (top 5 latest) + Xem tiếp (auth island, first) + rails:
  Mới cập nhật, Phim lẻ, Phim bộ, Hoạt hình, TV Shows.
- `/phim/[slug]` — backdrop/poster, meta (năm, thời lượng, thể loại, quốc gia,
  đạo diễn, diễn viên, mô tả), `generateMetadata` (title/description/og:image),
  ResumeButton ("Xem ngay" / "Xem tiếp tập X từ MM:SS"), FavoriteButton
  (optimistic + rollback), server/episode grid linking `/xem/...` (Phase 6).
- `/tim-kiem?keyword=&page=` — server results; header search debounces 400ms
  and shows 5 quick suggestions. Old `/search` redirects here.
- `/me`, `/me/favorites`, `/me/watchlist`, `/me/history` — auth pages (middleware-guarded).
  History reuses continue-watching data (no separate table, see decisions #17).
- `MovieCard` — client component with blur placeholder + error fallback icon.

## Chuyển động (motion)

- **CSS-first, không thêm thư viện.** Token easing + `@keyframes` nằm trong
  `@theme` của `app/globals.css`; dùng qua utility `animate-*` (`animate-zoom-in`,
  `animate-reveal-up`, `animate-toast-in`, `animate-shimmer`, `animate-hero`…).
- **Overlay/điều hướng:** dropdown, dialog, sheet dùng animation `data-[state=*]`
  nên Radix giữ mounted tới khi animation đóng chạy xong; `app/template.tsx` fade
  mỗi lần đổi route; header đổ bóng dần khi cuộn.
- **Nội dung:** hero có ken-burns + caption reveal; rail/section dùng `Reveal`
  (IntersectionObserver) fade-up khi vào khung nhìn; skeleton là shimmer; thanh
  tiến độ "Xem tiếp" fill bằng `scaleX`.
- **Micro-interaction:** nút có `active:scale-[0.98]`; icon yêu thích/muốn xem/sao
  "pop" khi thao tác thành công.
- **Accessibility:** một reset `prefers-reduced-motion` toàn cục; `Reveal` mặc
  định hiển thị (không ẩn khi thiếu JS). Quyết định chi tiết: `docs/decisions.md`
  #85–90, thiết kế: `docs/superpowers/specs/2026-09-16-motion-design.md`.
