"use client";

import { ThumbsDown, ThumbsUp } from "lucide-react";

import { MovieCard } from "@/components/movies/movie-card";
import type { FeedbackKind } from "@/lib/recommendations";
import type { MovieCard as MovieCardType } from "@/lib/types";

interface Props {
  movie: MovieCardType;
  onFeedback: (movie: MovieCardType, kind: FeedbackKind) => void;
  pending?: boolean;
}

export function RecommendationFeedback({ movie, onFeedback, pending }: Props) {
  return (
    <div className="relative">
      <MovieCard movie={movie} />
      <div className="absolute top-1.5 right-1.5 flex gap-1">
        <button
          type="button"
          aria-label={`Quan tâm ${movie.name}`}
          data-testid={`rec-interested-${movie.slug}`}
          disabled={pending}
          onClick={() => onFeedback(movie, "interested")}
          className="cursor-pointer rounded-md bg-black/65 p-1.5 text-white transition-colors hover:bg-emerald-600 disabled:opacity-50"
        >
          <ThumbsUp className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label={`Không quan tâm ${movie.name}`}
          data-testid={`rec-not-interested-${movie.slug}`}
          disabled={pending}
          onClick={() => onFeedback(movie, "not_interested")}
          className="cursor-pointer rounded-md bg-black/65 p-1.5 text-white transition-colors hover:bg-red-600 disabled:opacity-50"
        >
          <ThumbsDown className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
