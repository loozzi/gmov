"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { Clapperboard } from "lucide-react";

import type { MovieCard as MovieCardType } from "@/lib/types";

// Tiny shimmer placeholder (base64 SVG) while posters load.
const BLUR_PLACEHOLDER =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MDAiIGhlaWdodD0iNjAwIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjMWMxYzIyIi8+PC9zdmc+";

export function MovieCard({ movie }: { movie: MovieCardType }) {
  const [failed, setFailed] = useState(false);
  const src = movie.poster_url || movie.thumb_url;

  return (
    <Link
      href={`/phim/${movie.slug}`}
      className="group block overflow-hidden rounded-lg border border-transparent bg-card transition-all duration-200 hover:z-10 hover:scale-[1.04] hover:border-foreground/20 hover:shadow-2xl dark:hover:border-white/30"
    >
      <div className="relative aspect-[2/3] w-full overflow-hidden bg-muted">
        {src && !failed ? (
          <Image
            src={src}
            alt={movie.name}
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 25vw, 20vw"
            placeholder="blur"
            blurDataURL={BLUR_PLACEHOLDER}
            className="object-cover transition-transform duration-300 group-hover:scale-105"
            loading="lazy"
            onError={() => setFailed(true)}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-muted-foreground">
            <Clapperboard className="size-8" />
            <span className="line-clamp-2 text-xs">{movie.name}</span>
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
