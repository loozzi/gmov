import type { Metadata } from "next";

import { BrowseGrid } from "@/components/movies/browse-grid";
import type { BrowseSource } from "@/lib/browse";
import { buildMetadata } from "@/lib/seo";
import { fetchYear } from "@/lib/server-movies";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ year: string }>;
}): Promise<Metadata> {
  const { year } = await params;
  return buildMetadata({
    title: `Phim năm ${year}`,
    description: `Danh sách phim năm ${year} mới cập nhật, xem online trên gmov.`,
    path: `/nam/${year}`,
  });
}

export default async function YearPage({
  params,
  searchParams,
}: {
  params: Promise<{ year: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { year } = await params;
  const { page } = await searchParams;
  const startPage = Math.max(1, Number.parseInt(page ?? "1", 10) || 1);
  const source: BrowseSource = { kind: "year", slug: year };
  const data = await fetchYear(year, startPage);

  return (
    <BrowseGrid
      title={`Phim năm ${year}`}
      source={source}
      startPage={startPage}
      initialData={data}
    />
  );
}
