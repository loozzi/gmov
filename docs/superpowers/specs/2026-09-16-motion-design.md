# Thiết kế: lớp chuyển động (motion) cho web

- Ngày: 2026-09-16
- Phạm vi: `apps/web` (giao diện), không đổi API/DB/hợp đồng dữ liệu.
- Người quyết định: agent (người dùng đã uỷ quyền tự quyết và yêu cầu hoàn thành).

## 1. Bối cảnh

Web gần như chưa có chuyển động:

- Chỉ **một** `@keyframes` duy nhất (`hero-fade`) trong `app/globals.css:60`.
- 20 utility `transition-*` rải rác, chỉ có `duration-200/300`, **không có** utility `ease-*`.
- Radix `dialog` / `sheet` / `dropdown-menu` **không có** animation vào/ra (`data-[state=*]`), nên mở/đóng rất "giật".
- Toast, gợi ý tìm kiếm, skeleton (`animate-pulse`) đều không có chuyển động riêng.
- `prefers-reduced-motion` chỉ được xử lý ở đúng 2 chỗ (`globals.css`, `hero-carousel.tsx`).

Mục tiêu: thêm một lớp chuyển động **nhất quán, nhẹ, có thể dự đoán, tôn trọng accessibility** mà không tăng bundle và không đổi hành vi nghiệp vụ.

## 2. Quyết định kiến trúc

**Zero dependency, CSS-first.** Dùng Tailwind v4 CSS-first (`@theme` + `@keyframes` + lớp tiện ích) thay vì thêm `framer-motion`/`motion`/`gsap`.

Lý do:

1. Repo đã CSS-first (không có `tailwind.config.*`), nên token/keyframe nằm cùng chỗ với design token hiện có.
2. Không đổi `pnpm-lock.yaml`, không tăng bundle runtime, không rủi ro SSR/hydration.
3. Phần lớn chuyển động cần thiết (overlay vào/ra, reveal, shimmer) là **khai báo được bằng CSS**; JS chỉ cần cho IntersectionObserver và vài micro-interaction.
4. Có tiền lệ trong repo: `hero-fade` + `@media (prefers-reduced-motion)`.

Phân loại quy trình: **bounded** (thay đổi cục bộ trên các component đã tồn tại, không đổi interface). Spec này thay cho plan riêng; checklist ở §6 là kế hoạch thực thi.

## 3. Hệ token chuyển động

Thêm vào `@theme` trong `app/globals.css`:

| Token | Giá trị | Dùng cho |
|---|---|---|
| `--ease-standard` | `cubic-bezier(0.2, 0, 0, 1)` | enter/exit overlay, hover, micro |
| `--ease-emphasized` | `cubic-bezier(0.16, 1, 0.3, 1)` | reveal nội dung, hero caption |
| `--ease-back` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | pop icon (favorite/watchlist/star) |

Duration dùng thang có sẵn của Tailwind (`duration-150` micro, `200` overlay, `300` hover card, `500` reveal). Hero dùng mốc dài riêng (`600ms` fade + `7s` ken-burns khớp `ROTATE_MS`).

Namespace `--animate-*` (kèm `@keyframes` trong `@theme` để Tailwind chỉ phát CSS khi dùng):

`fade-in`, `fade-out`, `zoom-in`, `zoom-out`, `overlay-in`, `overlay-out`, `dialog-in`, `dialog-out` (kèm `translate(-50%, -50%)` để không phá căn giữa), `sheet-in-left`, `sheet-in-right`, `sheet-out-left`, `sheet-out-right`, `toast-in`, `toast-out`, `reveal-up`, `pop`, `ken-burns`, `shimmer`.

## 4. Accessibility

- Một reset toàn cục:
  ```css
  @media (prefers-reduced-motion: reduce) {
    *, ::before, ::after {
      animation-duration: 1ms !important;
      animation-delay: 0ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 1ms !important;
      scroll-behavior: auto !important;
    }
  }
  ```
  Mọi animation kết thúc ở trạng thái cuối ổn định (opacity 1) nên nội dung luôn hiển thị.
- `Reveal` (IntersectionObserver) **không bao giờ** ẩn nội dung khi không có JS: mặc định render hiển thị, chỉ ẩn sau khi mount nếu phần tử nằm **dưới màn hình** và JS đang chạy, và bỏ qua hoàn toàn khi `prefers-reduced-motion: reduce`.
- Không dùng animation để truyền tải thông tin chỉ có ở chuyển động (mọi trạng thái vẫn có text/màu/icon tĩnh).

## 5. Bề mặt áp dụng

| File | Thay đổi |
|---|---|
| `app/globals.css` | token easing, keyframes, lớp `.skeleton-shimmer`, reset reduced-motion |
| `app/template.tsx` (mới) | fade-in nhẹ khi đổi route (chỉ opacity để không tạo containing block cho `fixed`) |
| `components/ui/reveal.tsx` (mới) | wrapper IntersectionObserver + stagger tuỳ chọn |
| `components/ui/dropdown-menu.tsx` | `data-[state]` zoom-in/out, `transform-origin` theo Radix |
| `components/ui/dialog.tsx` | overlay fade + content zoom (kèm căn giữa) |
| `components/ui/sheet.tsx` | overlay fade + trượt theo cạnh |
| `components/ui/toaster.tsx` | toast vào/ra (thêm trạng thái `closing`) |
| `components/ui/skeleton.tsx` | shimmer thay `animate-pulse` |
| `components/ui/button.tsx` | nhấn `active:scale-[0.98]`, easing token |
| `components/layout/site-header.tsx` | đổ bóng khi cuộn |
| `components/layout/search-box.tsx` | gợi ý trượt+mờ khi hiện |
| `components/movies/hero-carousel.tsx` | ken-burns cho backdrop, caption reveal, dot mượt |
| `components/movies/movie-card.tsx`, `poster-thumb.tsx` | ảnh poster fade-in khi mount |
| `components/movies/continue-watching-rail.tsx` | thanh tiến độ fill `scaleX`, poster fade |
| `components/movies/favorite-button.tsx`, `watchlist-button.tsx` | icon `pop` khi toggle thành công |
| `components/movies/star-input.tsx` | sao hover/nhấn scale, pop khi chọn |
| `app/page.tsx`, `app/phim/[slug]/page.tsx` | bọc rail/section bằng `Reveal` (stagger) |
| `app/error.tsx`, `app/not-found.tsx`, `app/offline/page.tsx` | reveal nhẹ cho khối thông báo |

## 6. Checklist thực thi

1. Foundation: `globals.css` (token + keyframes + shimmer + reduced-motion) — commit riêng.
2. Primitive: dropdown, dialog, sheet, toaster, skeleton, button — commit riêng.
3. Nội dung: `template.tsx`, `reveal.tsx`, hero, card/poster, continue-watching — commit riêng.
4. Micro + trang: favorite/watchlist/star, header, search, home/detail, error/not-found/offline.
5. Verify: `lint`, `typecheck`, production `build` (dừng dev server trước), Playwright ảnh + kiểm tra tương tác, và một lượt giả lập `prefers-reduced-motion`.
6. Docs: mục trong `docs/decisions.md`, cập nhật `docs/web-pages.md` nếu cần.

## 7. Không thuộc phạm vi

- Không thêm nút mũi tên/kéo-thả cho rail (giữ nguyên cuộn hiện tại) — tránh đổi hành vi.
- Không đổi layout, màu, hay logic nghiệp vụ.
- Không animation cho dữ liệu động (số liệu, danh sách phân trang) để tránh nhấp nháy khi refetch.

## 8. Rủi ro & giảm thiểu

| Rủi ro | Giảm thiểu |
|---|---|
| `transform` trên ancestor tạo containing block phá `fixed` | Chỉ animate `opacity` cho `template.tsx`; không transform wrapper chứa portal/fixed |
| Animation exit của Radix cắt sớm | Radix giữ mounted tới `animationend` khi có animation ở `data-state=closed` |
| Ảnh poster fade dựa `onLoad` bị kẹt khi ảnh cache | Dùng animation CSS lúc mount (không phụ thuộc `onLoad`) |
| `Reveal` ẩn nội dung khi JS lỗi | Mặc định hiển thị; chỉ ẩn sau mount và chỉ với phần tử dưới màn hình |
| `!important` trong reset reduced-motion phá style khác | Chỉ áp khi người dùng bật giảm chuyển động; trạng thái cuối giữ nguyên |
