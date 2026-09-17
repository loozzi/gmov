"use client";

import { useAuth } from "@/components/auth/auth-provider";
import { MovieRail } from "@/components/movies/movie-rail";
import {
  useRecommendations,
  type RecommendationSource,
} from "@/lib/recommendations";

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

  if (authLoading || !isAuthenticated) return null;
  if (isLoading || isError || !data || data.items.length === 0) return null;

  return (
    <MovieRail
      title={TITLES[data.source]}
      movies={data.items.map((item) => item.movie)}
    />
  );
}
