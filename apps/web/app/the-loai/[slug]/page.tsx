import type { Metadata } from "next";

import { BrowseGrid } from "@/components/movies/browse-grid";
import type { BrowseSource } from "@/lib/browse";
import { GENRES, labelFor } from "@/lib/catalog";
import { buildMetadata } from "@/lib/seo";
import { fetchGenre } from "@/lib/server-movies";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const label = labelFor(GENRES, slug, slug);
  return buildMetadata({
    title: `Thể loại: ${label}`,
    description: `Phim ${label} mới cập nhật, xem online trên gmov.`,
    path: `/the-loai/${slug}`,
  });
}

export default async function GenrePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { slug } = await params;
  const { page } = await searchParams;
  const startPage = Math.max(1, Number.parseInt(page ?? "1", 10) || 1);
  const source: BrowseSource = { kind: "genre", slug };
  const data = await fetchGenre(slug, startPage);

  return (
    <BrowseGrid
      title={`Thể loại: ${labelFor(GENRES, slug, slug)}`}
      source={source}
      startPage={startPage}
      initialData={data}
    />
  );
}
