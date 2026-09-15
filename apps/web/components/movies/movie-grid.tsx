"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

import { MovieCard } from "@/components/movies/movie-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toVietnameseMessage } from "@/lib/errors";
import type { PaginatedMovies } from "@/lib/types";

interface Props {
  title: string;
  subtitle?: string;
  query: {
    data: PaginatedMovies | undefined;
    isLoading: boolean;
    isError: boolean;
    error: unknown;
  };
  page: number;
  onPage: (page: number) => void;
  emptyMessage?: string;
}

export function MovieGrid({
  title,
  subtitle,
  query,
  page,
  onPage,
  emptyMessage = "Không có phim nào.",
}: Props) {
  const { data, isLoading, isError, error } = query;

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">{title}</h1>
        {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
      </div>

      {isLoading && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="aspect-[2/3] w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          ))}
        </div>
      )}

      {isError && (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">
            {toVietnameseMessage(error)}
          </p>
        </div>
      )}

      {data && data.items.length === 0 && (
        <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          {emptyMessage}
        </div>
      )}

      {data && data.items.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {data.items.map((m) => (
              <MovieCard key={m.slug} movie={m} />
            ))}
          </div>
          <div className="flex items-center justify-center gap-3 pt-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={page <= 1}
              onClick={() => onPage(page - 1)}
            >
              <ChevronLeft /> Trước
            </Button>
            <span className="text-sm text-muted-foreground">
              Trang {data.current_page} / {data.total_page}
            </span>
            <Button
              variant="secondary"
              size="sm"
              disabled={page >= data.total_page}
              onClick={() => onPage(page + 1)}
            >
              Sau <ChevronRight />
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
