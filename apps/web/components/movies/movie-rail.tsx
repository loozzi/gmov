import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { MovieCard } from "@/components/movies/movie-card";
import type { MovieCard as MovieCardType } from "@/lib/types";

interface Props {
  title: string;
  href?: string;
  movies: MovieCardType[];
  /** When set, the section renders even with no movies, showing this hint. */
  emptyHint?: string;
  /** Optional per-movie reason, keyed by movie slug. */
  reasons?: Record<string, string>;
  /** Replace the default card (e.g. to overlay feedback controls). */
  renderCard?: (movie: MovieCardType) => ReactNode;
}

export function MovieRail({
  title,
  href,
  movies,
  emptyHint,
  reasons,
  renderCard,
}: Props) {
  if (movies.length === 0 && !emptyHint) return null;
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
      {movies.length === 0 ? (
        <p className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          {emptyHint}
        </p>
      ) : (
        <div className="rail-scroll -mx-4 flex gap-4 overflow-x-auto px-4 pb-2">
          {movies.map((m) => (
            <div key={m.slug} className="w-36 shrink-0 sm:w-44">
              {renderCard ? renderCard(m) : <MovieCard movie={m} />}
              {reasons?.[m.slug] && (
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                  {reasons[m.slug]}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
