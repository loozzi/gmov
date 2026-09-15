"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

import { MovieGrid } from "@/components/movies/movie-grid";
import { Skeleton } from "@/components/ui/skeleton";
import { useSearch } from "@/lib/movies";

function SearchResults() {
  const searchParams = useSearchParams();
  const keyword = searchParams.get("keyword") ?? "";
  const [page, setPage] = useState(1);
  const query = useSearch(keyword, page);

  return (
    <MovieGrid
      title={keyword ? `Kết quả cho "${keyword}"` : "Tìm kiếm"}
      query={{ ...query, isLoading: query.isLoading && keyword.length > 0 }}
      page={page}
      onPage={setPage}
      emptyMessage="Không tìm thấy phim nào phù hợp."
    />
  );
}

export default function SearchPage() {
  return (
    <Suspense
      fallback={
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} className="aspect-[2/3] w-full" />
          ))}
        </div>
      }
    >
      <SearchResults />
    </Suspense>
  );
}
