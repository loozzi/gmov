import { BrowseGrid } from "@/components/movies/browse-grid";
import { COUNTRIES, labelFor } from "@/lib/catalog";
import { fetchCountry } from "@/lib/server-movies";

export const dynamic = "force-dynamic";

export default async function CountryPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { slug } = await params;
  const { page } = await searchParams;
  const pageNum = Math.max(1, Number.parseInt(page ?? "1", 10) || 1);
  const data = await fetchCountry(slug, pageNum);

  return (
    <BrowseGrid
      title={`Quốc gia: ${labelFor(COUNTRIES, slug, slug)}`}
      data={data}
      basePath={`/quoc-gia/${slug}`}
    />
  );
}
