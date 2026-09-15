import { BrowseGrid } from "@/components/movies/browse-grid";
import { fetchYear } from "@/lib/server-movies";

export const dynamic = "force-dynamic";

export default async function YearPage({
  params,
  searchParams,
}: {
  params: Promise<{ year: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { year } = await params;
  const { page } = await searchParams;
  const pageNum = Math.max(1, Number.parseInt(page ?? "1", 10) || 1);
  const data = await fetchYear(year, pageNum);

  return (
    <BrowseGrid
      title={`Phim năm ${year}`}
      data={data}
      basePath={`/nam/${year}`}
    />
  );
}
