export interface CatalogEntry {
  slug: string;
  label: string;
}

export const LIST_TYPES: CatalogEntry[] = [
  { slug: "dang-chieu", label: "Đang chiếu" },
  { slug: "phim-le", label: "Phim lẻ" },
  { slug: "phim-bo", label: "Phim bộ" },
  { slug: "tv-shows", label: "TV Shows" },
];

export const GENRES: CatalogEntry[] = [
  { slug: "hanh-dong", label: "Hành Động" },
  { slug: "phieu-luu", label: "Phiêu Lưu" },
  { slug: "hoat-hinh", label: "Hoạt Hình" },
  { slug: "phim-hai", label: "Hài" },
  { slug: "hinh-su", label: "Hình Sự" },
  { slug: "tai-lieu", label: "Tài Liệu" },
  { slug: "chinh-kich", label: "Chính Kịch" },
  { slug: "gia-dinh", label: "Gia Đình" },
  { slug: "gia-tuong", label: "Giả Tưởng" },
  { slug: "lich-su", label: "Lịch Sử" },
  { slug: "kinh-di", label: "Kinh Dị" },
  { slug: "phim-nhac", label: "Nhạc" },
  { slug: "bi-an", label: "Bí Ẩn" },
  { slug: "lang-man", label: "Lãng Mạn" },
  { slug: "khoa-hoc-vien-tuong", label: "Khoa Học Viễn Tưởng" },
  { slug: "gay-can", label: "Gây Cấn" },
  { slug: "chien-tranh", label: "Chiến Tranh" },
  { slug: "tam-ly", label: "Tâm Lý" },
  { slug: "tinh-cam", label: "Tình Cảm" },
  { slug: "co-trang", label: "Cổ Trang" },
  { slug: "mien-tay", label: "Miền Tây" },
];

export const COUNTRIES: CatalogEntry[] = [
  { slug: "au-my", label: "Âu Mỹ" },
  { slug: "trung-quoc", label: "Trung Quốc" },
  { slug: "han-quoc", label: "Hàn Quốc" },
  { slug: "nhat-ban", label: "Nhật Bản" },
  { slug: "thai-lan", label: "Thái Lan" },
  { slug: "dai-loan", label: "Đài Loan" },
  { slug: "hong-kong", label: "Hồng Kông" },
  { slug: "viet-nam", label: "Việt Nam" },
  { slug: "anh", label: "Anh" },
  { slug: "phap", label: "Pháp" },
  { slug: "an-do", label: "Ấn Độ" },
  { slug: "nga", label: "Nga" },
];

export const YEARS: CatalogEntry[] = Array.from({ length: 11 }, (_, i) => {
  const year = String(2026 - i);
  return { slug: year, label: year };
});

export function labelFor(
  entries: CatalogEntry[],
  slug: string,
  fallback: string,
): string {
  return entries.find((e) => e.slug === slug)?.label ?? fallback;
}
