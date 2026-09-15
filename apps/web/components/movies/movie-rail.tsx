import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { MovieCard } from "@/components/movies/movie-card";
import type { MovieCard as MovieCardType } from "@/lib/types";

interface Props {
  title: string;
  href?: string;
  movies: MovieCardType[];
}

export function MovieRail({ title, href, movies }: Props) {
  if (movies.length === 0) return null;
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">{title}</h2>
        {href && (
          <Link
            href={href}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-brand"
          >
            Xem tất cả <ChevronRight className="size-4" />
          </Link>
        )}
      </div>
      <div className="rail-scroll -mx-4 flex gap-4 overflow-x-auto px-4 pb-2">
        {movies.map((m) => (
          <div
            key={m.slug}
            className="w-36 shrink-0 sm:w-44"
          >
            <MovieCard movie={m} />
          </div>
        ))}
      </div>
    </section>
  );
}
