import Link from "next/link";
import { ChevronLeft, ChevronRight, Film } from "lucide-react";

import { MovieCard } from "@/components/movies/movie-card";
import { Button } from "@/components/ui/button";
import type { PaginatedMovies } from "@/lib/types";

interface Props {
  title: string;
  subtitle?: string;
  data: PaginatedMovies | null;
  basePath: string;
  extraParams?: string;
  emptyMessage?: string;
}

export function BrowseGrid({
  title,
  subtitle,
  data,
  basePath,
  extraParams = "",
  emptyMessage = "Không có phim nào trong mục này.",
}: Props) {
  if (!data) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-bold">{title}</h1>
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">
            Không tải được dữ liệu. Hãy thử lại sau.
          </p>
        </div>
      </section>
    );
  }

  const pageHref = (page: number) =>
    `${basePath}?page=${page}${extraParams ? `&${extraParams}` : ""}`;

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">{title}</h1>
        {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
      </div>

      {data.items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card p-12 text-center">
          <Film className="size-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{emptyMessage}</p>
          <Button variant="secondary" asChild>
            <Link href="/">Về trang chủ</Link>
          </Button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {data.items.map((m) => (
              <MovieCard key={m.slug} movie={m} />
            ))}
          </div>
          <div className="flex items-center justify-center gap-3 pt-2">
            {data.current_page > 1 ? (
              <Button variant="secondary" size="sm" asChild>
                <Link href={pageHref(data.current_page - 1)}>
                  <ChevronLeft /> Trước
                </Link>
              </Button>
            ) : (
              <Button variant="secondary" size="sm" disabled>
                <ChevronLeft /> Trước
              </Button>
            )}
            <span className="text-sm text-muted-foreground">
              Trang {data.current_page} / {data.total_page}
            </span>
            {data.current_page < data.total_page ? (
              <Button variant="secondary" size="sm" asChild>
                <Link href={pageHref(data.current_page + 1)}>
                  Sau <ChevronRight />
                </Link>
              </Button>
            ) : (
              <Button variant="secondary" size="sm" disabled>
                Sau <ChevronRight />
              </Button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
