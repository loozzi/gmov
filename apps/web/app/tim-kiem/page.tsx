import type { Metadata } from "next";

import { BrowseGrid } from "@/components/movies/browse-grid";
import type { BrowseSource } from "@/lib/browse";
import { buildMetadata } from "@/lib/seo";
import { fetchSearch } from "@/lib/server-movies";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ keyword?: string }>;
}): Promise<Metadata> {
  const { keyword = "" } = await searchParams;
  const q = keyword.trim();
  return buildMetadata({
    title: q ? `Tìm kiếm: ${q}` : "Tìm kiếm",
    description: q
      ? `Kết quả tìm kiếm cho "${q}" trên gmov.`
      : "Tìm kiếm phim trên gmov.",
    path: q ? `/tim-kiem?keyword=${encodeURIComponent(q)}` : "/tim-kiem",
    // Search result pages are thin/duplicated; keep them out of the index.
    noIndex: true,
  });
}

export default async function TimKiemPage({
  searchParams,
}: {
  searchParams: Promise<{ keyword?: string; page?: string }>;
}) {
  const { keyword = "", page } = await searchParams;
  const q = keyword.trim();
  const startPage = Math.max(1, Number.parseInt(page ?? "1", 10) || 1);

  // No keyword: never render the grid — it would fetch `keyword=` from the
  // client for a listing that has nothing to show.
  if (!q) {
    return (
      <section className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold">Tìm kiếm</h1>
          <p className="text-muted-foreground text-sm">
            Nhập từ khóa vào ô tìm kiếm phía trên.
          </p>
        </div>
      </section>
    );
  }

  const source: BrowseSource = { kind: "search", keyword: q };
  const data = await fetchSearch(q, startPage);

  return (
    <BrowseGrid
      title={`Kết quả cho "${q}"`}
      source={source}
      startPage={startPage}
      initialData={data}
      emptyMessage="Không tìm thấy phim nào phù hợp. Thử từ khóa khác nhé."
    />
  );
}
