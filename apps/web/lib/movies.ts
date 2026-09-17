import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
} from "@tanstack/react-query";

import { browsePath, type BrowseSource } from "@/lib/browse";
import { apiFetch } from "@/lib/api";
import type { PaginatedMovies } from "@/lib/types";

export function useSearch(keyword: string, page: number) {
  return useQuery({
    queryKey: ["movies", "search", keyword, page],
    queryFn: () =>
      apiFetch<PaginatedMovies>(
        `/api/v1/movies/search?keyword=${encodeURIComponent(keyword)}&page=${page}`,
        { auth: false },
      ),
    placeholderData: keepPreviousData,
    enabled: keyword.trim().length > 0,
  });
}

/**
 * Listing pages: SSR delivers the starting page as `initialData`, the client
 * keeps appending until the backend reports no page left. `startPage` comes
 * from `?page=N`, so deep links keep working.
 */
export function useBrowseInfinite(
  source: BrowseSource,
  startPage: number,
  initialData: PaginatedMovies | null,
) {
  return useInfiniteQuery({
    queryKey: ["browse", source, startPage],
    queryFn: ({ pageParam }) =>
      apiFetch<PaginatedMovies>(browsePath(source, pageParam), { auth: false }),
    initialPageParam: startPage,
    getNextPageParam: (last) =>
      last.current_page < last.total_page ? last.current_page + 1 : undefined,
    initialData: initialData
      ? { pages: [initialData], pageParams: [startPage] }
      : undefined,
  });
}
