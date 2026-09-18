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

- `/` — hero carousel (top 5 latest) + rail **Gợi ý cho bạn** (auth island,
  client component — xem mục Gợi ý bên dưới) + Xem tiếp + rails: Mới cập nhật,
  Phim lẻ, Phim bộ, Hoạt hình, TV Shows.
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
- `/login`, `/register` — form đăng nhập/đăng ký; xong thì **luôn** `replace` sang
  `/profiles?next=<đích cũ>` (đích lọc open redirect — decision #132).
- `/profiles` — "Ai đang xem?" — màn hình chọn profile full-screen (xem mục Profiles bên dưới).
- `/profiles/manage` — đổi tên/avatar, đặt/xoá PIN, xoá profile, "Làm lại sở thích".
- `/onboarding` — quiz 3 bước thiết lập gu (M2, xem mục Gợi ý bên dưới).
- `MovieCard` — client component with blur placeholder + error fallback icon.

## Profiles (M1)

- **`/profiles` — "Ai đang xem?" (trang chọn profile)**: màn hình immersive
  full-screen (`AppShell` ẩn header/footer cho riêng route này), nền tối, grid
  avatar lớn giữa màn hình (`useProfiles`), profile đang xem có nhãn "Đang xem",
  profile có PIN có badge ổ; bấm một card → switch rồi **rời trang** tới `next`
  (query param, đã lọc open-redirect ở `lib/nav.ts`) hoặc `/`; profile khoá mở
  `ProfilePinDialog`. Nút "Thêm profile" (`ProfileFormDialog`) chỉ hiện khi chưa
  đủ `max`. Không có nút bỏ qua (bắt buộc chọn) và không có header để thoát ra;
  khách chưa đăng nhập thấy lời nhắc + link `/login`. Cạnh "Quản lý profile" có
  nút **"Đăng xuất"** (`data-testid="chooser-logout"`, chỉ hiện khi đã đăng nhập):
  người không vào được profile nào (khoá hết, quên PIN) vẫn thoát được tài khoản;
  đăng xuất xong ở lại trang, thấy ngay lời nhắc khách.
  **Đăng nhập/đăng ký luôn đáp xuống đây** (`router.replace("/profiles")`), kể cả
  tài khoản một profile. Bấm card **đang xem** cũng đi qua `POST /switch` như mọi
  card khác: chọn lại profile có PIN thì phải nhập PIN, không có lối tắt.
- **`/profiles/manage`**: mỗi profile một hàng — đổi tên & avatar, đặt/đổi/xoá
  PIN (dialog riêng, cần **mật khẩu tài khoản**), và nút xoá. Profile mặc định
  **không có nút xoá**. Xoá profile có PIN → dialog nhập PIN + cảnh báo; xoá
  profile không PIN → `window.confirm`. Xoá chỉ mất dữ liệu của profile đó.
  Đổi tên/avatar của profile **có PIN** phải nhập thêm "Mã PIN" trong dialog
  (server trả `PIN_REQUIRED` thì ô PIN tự hiện, kể cả khi cache `has_pin` cũ).
  Sau switch: `setAccessToken` mới + `queryClient.resetQueries()` (data per-profile
  nằm rải ở nhiều query key). Xoá **profile đang dùng** thì server không phát
  profile kế nhiệm (mặc định có thể đang khoá PIN): trang `clear()` cache rồi
  `router.replace("/profiles")` để chọn lại. Không dùng localStorage — profile
  nhớ theo phiên/thiết bị qua refresh cookie.
- **`ProfilePinDialog`** (mọi chỗ chỉ hỏi PIN: mở khoá/chuyển profile ở trang
  chọn + menu header, xác nhận xoá profile có PIN): modal **full-screen**
  (`DialogContent.fullScreen`) nền tối; ô PIN là `type="password"` nên không bao
  giờ đọc được chữ số. Ngược lại `ProfileSetPinDialog` (đặt/đổi PIN trong
  `/profiles/manage`, có cả mật khẩu tài khoản) vẫn là dialog thường.
- **`ProfileGate`** (trong `AppShell`, mọi route không immersive): đã đăng nhập
  mà **chưa chọn profile** → giữ một placeholder rồi `router.replace("/profiles?next=<đường
  dẫn hiện tại>")`. Vì login không chọn profile, mọi endpoint gắn profile trả
  `403 PROFILE_REQUIRED`; gate đưa người dùng về chooser thay vì để trang hiện
  lỗi. Miễn trừ: `/profiles`, `/profiles/manage`, `/login`, `/register` — và
  khách chưa đăng nhập vẫn duyệt web bình thường.
- **Header switcher** (`ProfileMenu`, cạnh avatar): dropdown liệt kê profile
  (avatar, tên, ổ khoá nếu có PIN, dấu check cho profile hiện tại) + link
  "Đổi profile" về `/profiles` + link "Quản lý profile"; chọn profile khoá sẽ mở
  PIN dialog trước khi switch. Dropdown dùng `modal={false}` để không khoá scroll
  trang (tránh nháy scrollbar). API: `docs/api-profiles.md`.

## Onboarding & gợi ý (M2)

### `/onboarding` — quiz 3 bước

- **Bước 1 — "Gu của bạn là gì?"**: grid chip thể loại + quốc gia lấy từ
  `lib/catalog.ts` (`GENRES`/`COUNTRIES`, nguồn tĩnh — upstream không có endpoint
  menu, ruling R1). Phải chọn ≥1 để nút "Tiếp tục" bật.
- **Bước 2 — "Chọn poster bạn thích"**: 2 hàng × 6 poster lấy từ listing công
  khai (`/movies/latest` + listing của thể loại/quốc gia đầu tiên đã chọn), mỗi
  poster có nút thích/bỏ qua; like gửi `POST /me/preferences/posters`.
- **Bước 3 — "Sẵn sàng xem phim!"**: tổng kết + "Bắt đầu xem" → `PUT /me/preferences`.
- **"Bỏ qua" ở mọi bước** → `PUT /me/preferences` với `skipped: true` rồi về `/`.
- **Guard client-side**: nếu profile hiện tại có `onboarding_completed_at` và
  không vào bằng `?again=1` → `router.replace("/")`; chưa đăng nhập → CTA đăng
  nhập. Không dùng middleware (middleware chỉ thấy cookie refresh).
- `?again=1` (từ "Làm lại sở thích") bỏ qua guard để onboard lại.
- Test ids ổn định cho Playwright: `onboarding-genre-<slug>`,
  `onboarding-country-<slug>`, `onboarding-next`, `onboarding-skip`,
  `onboarding-poster-like-<slug>`, `onboarding-poster-skip-<slug>`,
  `onboarding-finish`.

### Rail gợi ý trên trang chủ

`RecommendationsRail` là **client component** (ruling R4) theo mẫu
`continue-watching-rail`: `useAuth()` + `useRecommendations()`, trả `null` khi
chưa đăng nhập.

- Tiêu đề theo `source`: **"Gợi ý cho bạn"** (`personal`), **"Phổ biến"**
  (`popular`); `newest` **ẩn hẳn** vì trùng rail tĩnh "Mới cập nhật". Cũng ẩn
  khi đang tải, lỗi, hoặc `items.length === 0`.
- `MovieRail` nhận thêm prop optional `reasons` (`Record<slug, string>`); rail
  render **dòng lý do** ngắn dưới mỗi card (`"Vì bạn thích Hành Động"`). Đây là
  text per-card, không có UI phụ (xem `docs/todo.md`).
- API + engine: `docs/api-recommendations.md`.

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
