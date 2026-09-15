"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Play } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { MovieCard as MovieCardType } from "@/lib/types";

const ROTATE_MS = 6000;

export function HeroCarousel({ movies }: { movies: MovieCardType[] }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const count = movies.length;

  const go = useCallback(
    (dir: 1 | -1) => setIndex((i) => (i + dir + count) % count),
    [count],
  );

  useEffect(() => {
    if (paused || count < 2) return;
    const timer = setTimeout(() => go(1), ROTATE_MS);
    return () => clearTimeout(timer);
  }, [index, paused, count, go]);

  if (count === 0) return null;
  const movie = movies[index];
  const backdrop = movie.poster_url || movie.thumb_url;

  return (
    <section
      className="relative overflow-hidden rounded-2xl border border-border"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="relative h-64 sm:h-80 lg:h-96">
        {backdrop && (
          <Image
            key={movie.slug}
            src={backdrop}
            alt=""
            fill
            priority
            sizes="100vw"
            className="object-cover object-top"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-background/80 via-transparent to-transparent" />

        <div className="absolute bottom-0 left-0 max-w-2xl space-y-3 p-5 sm:p-8">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {movie.quality && (
              <span className="rounded-md bg-brand px-2 py-0.5 font-semibold text-brand-foreground">
                {movie.quality}
              </span>
            )}
            {movie.year && (
              <span className="text-muted-foreground">{movie.year}</span>
            )}
            {movie.current_episode && (
              <span className="text-muted-foreground">
                {movie.current_episode}
              </span>
            )}
          </div>
          <h1 className="text-2xl font-bold sm:text-4xl">{movie.name}</h1>
          {movie.original_name && (
            <p className="text-sm text-muted-foreground">{movie.original_name}</p>
          )}
          <div className="flex gap-2 pt-1">
            <Button asChild>
              <Link href={`/phim/${movie.slug}`}>
                <Play /> Xem ngay
              </Link>
            </Button>
            <Button variant="secondary" asChild>
              <Link href={`/phim/${movie.slug}`}>Chi tiết</Link>
            </Button>
          </div>
        </div>

        {count > 1 && (
          <>
            <div className="absolute top-1/2 right-3 left-3 flex -translate-y-1/2 justify-between">
              <Button
                variant="secondary"
                size="icon"
                aria-label="Trước"
                onClick={() => go(-1)}
              >
                <ChevronLeft />
              </Button>
              <Button
                variant="secondary"
                size="icon"
                aria-label="Sau"
                onClick={() => go(1)}
              >
                <ChevronRight />
              </Button>
            </div>
            <div className="absolute right-4 bottom-4 flex gap-1.5">
              {movies.map((m, i) => (
                <button
                  key={m.slug}
                  aria-label={`Slide ${i + 1}`}
                  onClick={() => setIndex(i)}
                  className={cn(
                    "h-1.5 cursor-pointer rounded-full transition-all",
                    i === index ? "w-6 bg-brand" : "w-1.5 bg-white/40",
                  )}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
