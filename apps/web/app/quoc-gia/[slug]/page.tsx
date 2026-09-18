import type { Metadata } from "next";

import { BrowseGrid } from "@/components/movies/browse-grid";
import type { BrowseSource } from "@/lib/browse";
import { COUNTRIES, labelFor } from "@/lib/catalog";
import { buildMetadata } from "@/lib/seo";
import { fetchCountry } from "@/lib/server-movies";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const label = labelFor(COUNTRIES, slug, slug);
  return buildMetadata({
    title: `Quốc gia: ${label}`,
    description: `Phim ${label} mới cập nhật, xem online trên gmov.`,
    path: `/quoc-gia/${slug}`,
  });
}

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
