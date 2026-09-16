"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Info, Play } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { MovieCard as MovieCardType } from "@/lib/types";

const ROTATE_MS = 7000;

export function HeroCarousel({ movies }: { movies: MovieCardType[] }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const count = movies.length;

  const go = useCallback(
    (dir: 1 | -1) => setIndex((i) => (i + dir + count) % count),
    [count],
  );

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (paused || count < 2) return;
    const timer = setTimeout(() => go(1), ROTATE_MS);
    return () => clearTimeout(timer);
  }, [index, paused, count, go]);

  if (count === 0) return null;
  const movie = movies[index];
  const backdrop = movie.poster_url || movie.thumb_url;

  return (
    <section
      aria-roledescription="carousel"
      className="group relative -mx-4 -mt-6 overflow-hidden"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="relative h-[68vh] min-h-[420px] w-full sm:h-[78vh]">
        {backdrop && (
          <Image
            key={movie.slug}
            src={backdrop}
            alt=""
            fill
            priority
            fetchPriority="high"
            sizes="100vw"
            className="animate-hero-fade object-cover object-top"
          />
        )}
        {/* Cinematic vignette: text readable, bottom melts into page bg */}
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/20 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-background/90 via-background/30 to-transparent" />

        <div className="absolute bottom-24 left-0 max-w-2xl space-y-4 p-4 sm:bottom-28 sm:p-10">
          <p className="flex items-center gap-2 text-xs font-bold tracking-[0.2em] text-white/80 uppercase">
            <span className="rounded-sm bg-brand px-1.5 py-0.5 text-[10px] text-brand-foreground">
              G
            </span>
            Phim nổi bật
          </p>
          <h1 className="text-4xl font-extrabold text-white drop-shadow-lg sm:text-5xl lg:text-6xl">
            {movie.name}
          </h1>
          {movie.original_name && (
            <p className="text-sm text-white/70">{movie.original_name}</p>
          )}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white/80">
            {movie.quality && (
              <span className="rounded border border-white/40 px-1.5 py-0.5 text-xs font-semibold">
                {movie.quality}
              </span>
            )}
            {movie.year && <span>{movie.year}</span>}
            {movie.current_episode && <span>{movie.current_episode}</span>}
            {movie.time && <span>{movie.time}</span>}
          </div>
          {movie.description && (
            <p className="line-clamp-3 max-w-xl text-sm text-white/85 sm:text-base">
              {movie.description}
            </p>
          )}
          <div className="flex gap-3 pt-2">
            <Button
              asChild
              size="lg"
              className="bg-white font-bold text-black hover:bg-white/80"
            >
              <Link href={`/phim/${movie.slug}`}>
                <Play className="fill-black" /> Xem ngay
              </Link>
            </Button>
            <Button
              asChild
              size="lg"
              className="bg-white/20 font-semibold text-white backdrop-blur-sm hover:bg-white/30"
            >
              <Link href={`/phim/${movie.slug}`}>
                <Info /> Chi tiết
              </Link>
            </Button>
          </div>
        </div>

        {count > 1 && (
          <>
            <div className="absolute top-1/2 right-3 left-3 hidden -translate-y-1/2 justify-between md:flex md:opacity-0 md:transition-opacity md:group-hover:opacity-100">
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
            <div className="absolute right-4 bottom-24 flex gap-1.5 sm:bottom-28">
              {movies.map((m, i) => (
                <button
                  key={m.slug}
                  aria-label={`Slide ${i + 1}`}
                  onClick={() => setIndex(i)}
                  className={cn(
                    "h-1.5 cursor-pointer rounded-full transition-all",
                    i === index ? "w-6 bg-white" : "w-1.5 bg-white/40",
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
