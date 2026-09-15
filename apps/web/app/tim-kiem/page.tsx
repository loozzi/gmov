import { BrowseGrid } from "@/components/movies/browse-grid";
import { fetchSearch } from "@/lib/server-movies";

export const dynamic = "force-dynamic";

export default async function TimKiemPage({
  searchParams,
}: {
  searchParams: Promise<{ keyword?: string; page?: string }>;
}) {
  const { keyword = "", page } = await searchParams;
  const q = keyword.trim();
  const pageNum = Math.max(1, Number.parseInt(page ?? "1", 10) || 1);
  const data = q ? await fetchSearch(q, pageNum) : null;

  return (
    <BrowseGrid
      title={q ? `Kết quả cho "${q}"` : "Tìm kiếm"}
      subtitle={q ? undefined : "Nhập từ khóa vào ô tìm kiếm phía trên."}
      data={data}
      basePath="/tim-kiem"
      extraParams={q ? `keyword=${encodeURIComponent(q)}` : ""}
      emptyMessage="Không tìm thấy phim nào phù hợp. Thử từ khóa khác nhé."
    />
  );
}
