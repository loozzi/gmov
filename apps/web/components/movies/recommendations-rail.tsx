"use client";

import { useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { MovieRail } from "@/components/movies/movie-rail";
import { RecommendationFeedback } from "@/components/movies/recommendation-feedback";
import { useToast } from "@/components/ui/toaster";
import { toVietnameseMessage } from "@/lib/errors";
import {
  useRecommendations,
  useRecommendationFeedback,
  useUndoRecommendationFeedback,
  type FeedbackKind,
  type RecommendationSource,
} from "@/lib/recommendations";
import type { MovieCard as MovieCardType } from "@/lib/types";

const TITLES: Record<RecommendationSource, string> = {
  personal: "Gợi ý cho bạn",
  popular: "Phổ biến",
  newest: "Mới cập nhật",
};

export function RecommendationsRail() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { data, isLoading, isError } = useRecommendations(
    20,
    isAuthenticated,
  );
  const toast = useToast();
  const feedback = useRecommendationFeedback();
  const undo = useUndoRecommendationFeedback();
  const [hidden, setHidden] = useState<Record<string, FeedbackKind>>({});

  if (authLoading || !isAuthenticated) return null;
  if (isLoading || isError || !data || data.items.length === 0) return null;
  if (data.source === "newest") return null;

  const restore = (slug: string) =>
    setHidden((prev) => {
      const next = { ...prev };
      delete next[slug];
      return next;
    });

  const handleFeedback = (movie: MovieCardType, kind: FeedbackKind) => {
    setHidden((prev) => ({ ...prev, [movie.slug]: kind }));
    feedback.mutate(
      { movie_slug: movie.slug, kind },
      {
        onSuccess: () =>
          toast(
            kind === "interested"
              ? `Đã ghi nhận: bạn quan tâm ${movie.name}`
              : `Sẽ bớt gợi ý giống ${movie.name}`,
            "success",
            {
              label: "Hoàn tác",
              onClick: () => {
                restore(movie.slug);
                undo.mutate(movie.slug, {
                  onError: (error) =>
                    toast(toVietnameseMessage(error), "error"),
                });
              },
            },
          ),
        onError: (error) => {
          restore(movie.slug);
          toast(toVietnameseMessage(error), "error");
        },
      },
    );
  };

  const items = data.items.filter((item) => !(item.movie.slug in hidden));

  const reasons: Record<string, string> = {};
  for (const item of items) {
    if (item.reason) reasons[item.movie.slug] = item.reason;
  }

  return (
    <MovieRail
      title={TITLES[data.source]}
      movies={items.map((item) => item.movie)}
      reasons={reasons}
      renderCard={(movie) => (
        <RecommendationFeedback
          movie={movie}
          onFeedback={handleFeedback}
          pending={feedback.isPending}
        />
      )}
    />
  );
}
