import Image from "next/image";
import Link from "next/link";
import { Clapperboard } from "lucide-react";

import type { MovieCard as MovieCardType } from "@/lib/types";

export function MovieCard({ movie }: { movie: MovieCardType }) {
  const src = movie.poster_url || movie.thumb_url;
  return (
    <Link
      href={`/phim/${movie.slug}`}
      className="group block overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-brand"
    >
      <div className="relative aspect-[2/3] w-full overflow-hidden bg-muted">
        {src ? (
          <Image
            src={src}
            alt={movie.name}
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 25vw, 20vw"
            className="object-cover transition-transform duration-300 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <Clapperboard className="size-8" />
          </div>
        )}
        {movie.quality && (
          <span className="absolute top-2 left-2 rounded-md bg-black/70 px-1.5 py-0.5 text-[11px] font-semibold text-white">
            {movie.quality}
          </span>
        )}
        {movie.current_episode && (
          <span className="absolute bottom-2 left-2 rounded-md bg-brand px-1.5 py-0.5 text-[11px] font-semibold text-brand-foreground">
            {movie.current_episode}
          </span>
        )}
      </div>
      <div className="space-y-0.5 p-2.5">
        <p className="truncate text-sm font-semibold group-hover:text-brand">
          {movie.name}
        </p>
        {movie.original_name && (
          <p className="truncate text-xs text-muted-foreground">
            {movie.original_name}
          </p>
        )}
      </div>
    </Link>
  );
}
