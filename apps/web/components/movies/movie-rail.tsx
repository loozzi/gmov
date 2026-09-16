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
    <section className="group/rail space-y-2">
      <div className="flex items-baseline gap-2">
        <h2 className="text-lg font-semibold sm:text-xl">{title}</h2>
        {href && (
          <Link
            href={href}
            className="flex translate-x-0 items-center gap-0.5 text-xs font-medium text-muted-foreground opacity-100 transition-all duration-200 group-hover/rail:translate-x-1 hover:text-brand sm:opacity-0 sm:group-hover/rail:opacity-100"
          >
            Xem tất cả <ChevronRight className="size-3.5" />
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
