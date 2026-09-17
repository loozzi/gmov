import { BrowseGrid } from "@/components/movies/browse-grid";
import type { BrowseSource } from "@/lib/browse";
import { labelFor, LIST_TYPES } from "@/lib/catalog";
import { fetchList } from "@/lib/server-movies";

export const dynamic = "force-dynamic";

const VALID_TYPES = new Set(LIST_TYPES.map((t) => t.slug));

export default async function ListPage({
  params,
  searchParams,
}: {
  params: Promise<{ type: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { type } = await params;
  const { page } = await searchParams;
  const startPage = Math.max(1, Number.parseInt(page ?? "1", 10) || 1);
  const source: BrowseSource = { kind: "list", slug: type };
  const data = VALID_TYPES.has(type) ? await fetchList(type, startPage) : null;

  return (
    <BrowseGrid
      title={labelFor(LIST_TYPES, type, "Danh mục")}
      source={source}
      startPage={startPage}
      initialData={data}
    />
  );
}
