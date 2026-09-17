"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, Heart, X } from "lucide-react";

import { PosterThumb } from "@/components/movies/poster-thumb";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api";
import { browsePath, type BrowseSource } from "@/lib/browse";
import type { MovieCard, PaginatedMovies } from "@/lib/types";
import { cn } from "@/lib/utils";

const ROW_SIZE = 6;
const POSTERS_STALE_MS = 5 * 60_000;

interface PosterTileProps {
  movie: MovieCard;
  liked: boolean;
  skipped: boolean;
  onToggleLike: (slug: string) => void;
  onToggleSkip: (slug: string) => void;
}

function PosterTile({
  movie,
  liked,
  skipped,
  onToggleLike,
  onToggleSkip,
}: PosterTileProps) {
  return (
    <div
      className={cn(
        "bg-card overflow-hidden rounded-lg border transition-colors",
        liked && "border-brand",
        skipped && "border-border opacity-50",
      )}
    >
      <div className="bg-muted relative aspect-[2/3] w-full">
        <PosterThumb src={movie.poster_url || movie.thumb_url} alt={movie.name} />
      </div>
      <div className="flex items-center justify-between gap-1 p-1.5">
        <button
          type="button"
          aria-pressed={liked}
          aria-label={`Thích ${movie.name}`}
          data-testid={`onboarding-poster-like-${movie.slug}`}
          onClick={() => onToggleLike(movie.slug)}
          className={cn(
            "flex size-8 cursor-pointer items-center justify-center rounded-md transition-colors",
            liked
              ? "bg-brand text-brand-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <Heart className={cn("size-4", liked && "fill-current")} />
        </button>
        <button
          type="button"
          aria-pressed={skipped}
          aria-label={`Bỏ qua ${movie.name}`}
          data-testid={`onboarding-poster-skip-${movie.slug}`}
          onClick={() => onToggleSkip(movie.slug)}
          className={cn(
            "flex size-8 cursor-pointer items-center justify-center rounded-md transition-colors",
            skipped
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}

function PosterRowSkeleton() {
  return (
    <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
      {Array.from({ length: ROW_SIZE }).map((_, i) => (
        <Skeleton key={i} className="aspect-[2/3] w-full rounded-lg" />
      ))}
    </div>
  );
}

interface PosterStepProps {
  selectedGenres: string[];
  selectedCountries: string[];
  liked: string[];
  skipped: string[];
  onToggleLike: (slug: string) => void;
  onToggleSkip: (slug: string) => void;
  onBack: () => void;
  onNext: () => void;
  pending: boolean;
}

export function PosterStep({
  selectedGenres,
  selectedCountries,
  liked,
  skipped,
  onToggleLike,
  onToggleSkip,
  onBack,
  onNext,
  pending,
}: PosterStepProps) {
  const { data: latest, isLoading: latestLoading } = useQuery({
    queryKey: ["onboarding", "posters", "latest"],
    queryFn: () =>
      apiFetch<PaginatedMovies>("/api/v1/movies/latest?page=1", {
        auth: false,
      }),
    staleTime: POSTERS_STALE_MS,
  });

  const secondary: BrowseSource | null = selectedGenres[0]
    ? { kind: "genre", slug: selectedGenres[0] }
    : selectedCountries[0]
      ? { kind: "country", slug: selectedCountries[0] }
      : null;

  const { data: secondaryData, isLoading: secondaryLoading } = useQuery({
    queryKey: [
      "onboarding",
      "posters",
      "secondary",
      secondary?.kind ?? "none",
      secondary?.slug ?? "none",
    ],
    queryFn: () =>
      apiFetch<PaginatedMovies>(browsePath(secondary as BrowseSource, 1), {
        auth: false,
      }),
    enabled: secondary !== null,
    staleTime: POSTERS_STALE_MS,
  });

  const firstRow = (latest?.items ?? []).slice(0, ROW_SIZE);
  const firstSlugs = new Set(firstRow.map((m) => m.slug));
  const secondPool = secondaryData?.items ?? latest?.items ?? [];
  const secondRow = secondPool
    .filter((m) => !firstSlugs.has(m.slug))
    .slice(0, ROW_SIZE);

  const loading = latestLoading || (secondary !== null && secondaryLoading);
  const empty =
    !loading && firstRow.length === 0 && secondRow.length === 0;

  return (
    <div className="space-y-6">
      <p className="text-muted-foreground text-sm">
        Thích hoặc bỏ qua vài poster để chúng tôi tinh chỉnh gu của bạn.
      </p>

      {loading ? (
        <div className="space-y-4">
          <PosterRowSkeleton />
          <PosterRowSkeleton />
        </div>
      ) : empty ? (
        <p className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          Chưa tải được poster. Bạn vẫn có thể tiếp tục.
        </p>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
            {firstRow.map((movie) => (
              <PosterTile
                key={movie.slug}
                movie={movie}
                liked={liked.includes(movie.slug)}
                skipped={skipped.includes(movie.slug)}
                onToggleLike={onToggleLike}
                onToggleSkip={onToggleSkip}
              />
            ))}
          </div>
          {secondRow.length > 0 && (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
              {secondRow.map((movie) => (
                <PosterTile
                  key={movie.slug}
                  movie={movie}
                  liked={liked.includes(movie.slug)}
                  skipped={skipped.includes(movie.slug)}
                  onToggleLike={onToggleLike}
                  onToggleSkip={onToggleSkip}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <Button
          type="button"
          variant="ghost"
          onClick={onBack}
          disabled={pending}
        >
          <ChevronLeft /> Quay lại
        </Button>
        <Button
          type="button"
          data-testid="onboarding-next"
          onClick={onNext}
          disabled={pending}
        >
          Tiếp tục
        </Button>
      </div>
    </div>
  );
}
