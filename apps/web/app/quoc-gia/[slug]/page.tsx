import { BrowseGrid } from "@/components/movies/browse-grid";
import type { BrowseSource } from "@/lib/browse";
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
  const startPage = Math.max(1, Number.parseInt(page ?? "1", 10) || 1);
  const source: BrowseSource = { kind: "country", slug };
  const data = await fetchCountry(slug, startPage);

  return (
    <BrowseGrid
      title={`Quốc gia: ${labelFor(COUNTRIES, slug, slug)}`}
      source={source}
      startPage={startPage}
      initialData={data}
    />
  );
}
