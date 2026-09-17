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
  (optimistic), resume button, search suggestions, browse listings
  (`BrowseGrid` + `BrowseQuickSwitch`, see below), `/me/*` pages.
- **Browse pages** (`/list/[type]`, `/the-loai`, `/quoc-gia`, `/nam`,
  `/tim-kiem`) render page 1 on the server and keep appending on scroll; the
  `source`/`startPage`/`initialData` props are the only contract between the
  server page and the island (`lib/browse.ts`).

## Pages

- `/` — hero carousel (top 5 latest) + Xem tiếp (auth island, first) + rails:
  Mới cập nhật, Phim lẻ, Phim bộ, Hoạt hình, TV Shows.
- `/phim/[slug]` — backdrop/poster, meta (năm, thời lượng, thể loại, quốc gia,
  đạo diễn, diễn viên, mô tả), `generateMetadata` (title/description/og:image),
  ResumeButton ("Xem ngay" / "Xem tiếp tập X từ MM:SS"), FavoriteButton
  (optimistic + rollback), server/episode grid linking `/xem/...` (Phase 6),
  và rail **"Phim liên quan"** (server-rendered từ
  `/api/v1/movies/{slug}/related`, đặt giữa danh sách tập và bình luận; rail tự
  ẩn khi không có ứng viên — thuật toán: `docs/api-movies.md`).
- `/tim-kiem?keyword=&page=` — server results; header search debounces 400ms
  and shows 5 quick suggestions. Old `/search` redirects here.
- `/me`, `/me/favorites`, `/me/watchlist`, `/me/history` — auth pages (middleware-guarded).
  History reuses continue-watching data (no separate table, see decisions #17).
- `MovieCard` — client component with blur placeholder + error fallback icon.

## Duyệt phim: cuộn vô tận + chuyển nhanh

- **Trang 1 vẫn SSR** (giữ indexable + paint đầu như cũ): mỗi `page.tsx` fetch
  trang bắt đầu rồi truyền `source` + `startPage` + `initialData` xuống client
  island `BrowseGrid`; island dùng `useInfiniteQuery` (`lib/movies.ts`) với
  `initialData` nên không refetch lại trang 1.
- **`?page=N` vẫn hoạt động**: vào thẳng trang N (deep-link/back-forward không
  vỡ) rồi cuộn tiếp từ N+1. Nút "Xem thêm" luôn render dạng `<a href="?page=N+1">`
  — no-JS và crawler vẫn đi tiếp được; có JS thì `preventDefault()` + `fetchNextPage()`.
- **Sentinel `IntersectionObserver`** (`rootMargin: 600px`) tự nạp trang kế; đang
  nạp thì chèn skeleton trong lưới + `aria-live="polite"`; hết thì hiện
  "Đã xem hết N phim.". Item được **khử trùng theo `slug`** giữa các trang vì
  thứ tự upstream có thể dịch giữa 2 request.
- **Quick switch**: `BrowseQuickSwitch` là hàng chip cuộn ngang, `sticky top-16`
  (dưới header `h-16`), chip đang xem có `aria-current="page"`; nguồn chip lấy
  theo loại trang (thể loại/quốc gia/năm/danh mục). Trang `/tim-kiem` không có
  chip; `/tim-kiem` không keyword thì page không render grid (tránh fetch rỗng).
- **Chi phí**: First Load JS của các trang duyệt tăng ~23 kB (113 → 136 kB) do
  island mang theo logic infinite query — chấp nhận để đổi lấy cuộn vô tận.

## Tiến độ xem cho khách (chưa đăng nhập)

- **Lưu ở `localStorage`** (`gmov:progress:v1`, tối đa 50 phim mới nhất) trong
  `lib/guest-progress.ts`. Đây là writer duy nhất của store; React đọc qua
  `useSyncExternalStore` (SSR trả store rỗng, hydrate sau mount nên không lệch
  hydration). Dữ liệu hỏng/private mode/quota đều degrade thành "rỗng", không ném lỗi.
- **Hook nguồn-aware:** `useProgress`, `useContinueWatching`, `useDeleteProgress`
  (`lib/me.ts`) tự chọn server hay local theo `isAuthenticated`, nên component
  tiêu thụ không cần biết dữ liệu nằm ở đâu. Nhờ đó rail "Xem tiếp", `ResumeButton`
  ("Xem tiếp tập X từ MM:SS") và toast resume chạy được cho cả khách; link "Lịch
  sử xem" chỉ hiện khi đã đăng nhập (trang `/me/history` vẫn yêu cầu đăng nhập).
- **Ghi:** heartbeat 15s, lúc pause và lúc rời trang trong `watch-view.tsx` đi qua
  một hàm `persist` duy nhất — khách ghi local (đồng bộ), tài khoản dùng
  `keepalive` như cũ. Chế độ embed (không có m3u8) với khách cũng ghi entry vị trí
  `0` để "Xem tiếp" đi theo tập vừa mở.
- **Gộp khi đăng nhập:** `GuestProgressMerge` (mount trong `providers.tsx`) đẩy
  entry local lên server nếu server chưa có phim đó hoặc bản local mới hơn; xoá
  entry sau khi ghi thành công; gặp 429/lỗi mạng thì dừng và để phần còn lại thử
  lại ở lần đăng nhập sau. Log out KHÔNG khôi phục lại local (đúng nghĩa "gộp").
- **Chưa hỗ trợ:** dấu ✓ "đã xem" theo tập cho khách — v1 chỉ lưu progress; các
  dấu này tự sinh lại sau khi đăng nhập và xem tiếp.

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
