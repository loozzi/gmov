import { keepPreviousData, useQuery } from "@tanstack/react-query";

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
