import { BrowseGrid } from "@/components/movies/browse-grid";
import { GENRES, labelFor } from "@/lib/catalog";
import { fetchGenre } from "@/lib/server-movies";

export const dynamic = "force-dynamic";

export default async function GenrePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { slug } = await params;
  const { page } = await searchParams;
  const pageNum = Math.max(1, Number.parseInt(page ?? "1", 10) || 1);
  const data = await fetchGenre(slug, pageNum);

  return (
    <BrowseGrid
      title={`Thể loại: ${labelFor(GENRES, slug, slug)}`}
      data={data}
      basePath={`/the-loai/${slug}`}
    />
  );
}
