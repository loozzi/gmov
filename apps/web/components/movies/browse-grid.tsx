"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef } from "react";
import { Film } from "lucide-react";

import { BrowseQuickSwitch } from "@/components/movies/browse-quick-switch";
import { MovieCard } from "@/components/movies/movie-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { browseHref, type BrowseSource } from "@/lib/browse";
import { useBrowseInfinite } from "@/lib/movies";
import type { MovieCard as MovieCardData, PaginatedMovies } from "@/lib/types";

const GRID_CLASS =
  "grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5";
const SKELETON_COUNT = 5;

interface Props {
  title: string;
  subtitle?: string;
  source: BrowseSource;
  startPage: number;
  initialData: PaginatedMovies | null;
  emptyMessage?: string;
}

export function BrowseGrid({
  title,
  subtitle,
  source,
  startPage,
  initialData,
  emptyMessage = "Không có phim nào trong mục này.",
}: Props) {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isPending } =
    useBrowseInfinite(source, startPage, initialData);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Upstream pagination shifts between requests, so the same movie can appear
  // on two pages. Keep the first occurrence to avoid duplicate React keys.
  const movies = useMemo(() => {
    const seen = new Set<string>();
    const out: MovieCardData[] = [];
    for (const page of data?.pages ?? []) {
      for (const movie of page.items) {
        if (seen.has(movie.slug)) continue;
        seen.add(movie.slug);
        out.push(movie);
      }
    }
    return out;
  }, [data]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
          void fetchNextPage();
        }
      },
      { rootMargin: "600px 0px", threshold: 0 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  if (!data) {
    if (isPending) {
      return (
        <section className="space-y-4">
          <div>
            <h1 className="text-2xl font-bold">{title}</h1>
            {subtitle && (
              <p className="text-muted-foreground text-sm">{subtitle}</p>
            )}
          </div>
          <BrowseQuickSwitch source={source} />
          <div className={GRID_CLASS}>
            {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
              <Skeleton key={i} className="aspect-[2/3] w-full" />
            ))}
          </div>
          <p
            aria-live="polite"
            className="text-muted-foreground text-center text-sm"
          >
            Đang tải thêm phim…
          </p>
        </section>
      );
    }

    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-bold">{title}</h1>
        <div className="border-border bg-card rounded-xl border p-8 text-center">
          <p className="text-muted-foreground text-sm">
            Không tải được dữ liệu. Hãy thử lại sau.
          </p>
        </div>
      </section>
    );
  }

  const lastPage = data.pages[data.pages.length - 1];
  const lastLoadedPage = lastPage?.current_page ?? startPage;
  const totalItems = data.pages[0]?.total_items ?? 0;

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">{title}</h1>
        {subtitle && (
          <p className="text-muted-foreground text-sm">{subtitle}</p>
        )}
      </div>

      <BrowseQuickSwitch source={source} />

      {movies.length === 0 ? (
        <div className="border-border bg-card flex flex-col items-center gap-3 rounded-xl border p-12 text-center">
          <Film className="text-muted-foreground size-10" />
          <p className="text-muted-foreground text-sm">{emptyMessage}</p>
          <Button variant="secondary" asChild>
            <Link href="/">Về trang chủ</Link>
          </Button>
        </div>
      ) : (
        <>
          <div className={GRID_CLASS}>
            {movies.map((m) => (
              <MovieCard key={m.slug} movie={m} />
            ))}
            {isFetchingNextPage &&
              Array.from({ length: SKELETON_COUNT }).map((_, i) => (
                <Skeleton
                  key={`skeleton-${i}`}
                  className="aspect-[2/3] w-full"
                />
              ))}
          </div>

          <div ref={sentinelRef} aria-hidden="true" className="h-px w-full" />

          <div className="flex flex-col items-center gap-3 pt-2">
            <p
              aria-live="polite"
              className="text-muted-foreground min-h-5 text-center text-sm"
            >
              {isFetchingNextPage ? "Đang tải thêm phim…" : ""}
            </p>

            {hasNextPage && (
              <Button variant="secondary" asChild>
                <a
                  href={browseHref(source, lastLoadedPage + 1)}
                  onClick={(e) => {
                    e.preventDefault();
                    void fetchNextPage();
                  }}
                >
                  Xem thêm
                </a>
              </Button>
            )}

            {!hasNextPage && !isFetchingNextPage && totalItems > 0 && (
              <p className="text-muted-foreground text-center text-sm">
                Đã xem hết {totalItems} phim.
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}
