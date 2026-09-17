"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api";
import type { MovieCard } from "@/lib/types";

export interface Preferences {
  genres: Record<string, number>;
  countries: Record<string, number>;
  onboarding_completed_at: string | null;
  skipped: boolean;
}

export interface SavePreferencesInput {
  genres: Record<string, number>;
  countries: Record<string, number>;
  skipped?: boolean;
}

export interface PosterFeedbackInput {
  liked: string[];
  skipped?: string[];
}

export interface RecommendationItem {
  movie: MovieCard;
  reason: string | null;
}

export type RecommendationSource = "personal" | "popular" | "newest";

export interface RecommendationsResponse {
  items: RecommendationItem[];
  source: RecommendationSource;
}

export const PREFERENCE_KEYS = {
  all: ["me", "preferences"] as const,
};

export const RECOMMENDATION_KEYS = {
  all: ["me", "recommendations"] as const,
  list: (limit: number) => ["me", "recommendations", limit] as const,
};

export function usePreferences(enabled = true) {
  return useQuery({
    queryKey: PREFERENCE_KEYS.all,
    queryFn: () => apiFetch<Preferences>("/api/v1/me/preferences"),
    enabled,
  });
}

export function useSavePreferences() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ genres, countries, skipped }: SavePreferencesInput) =>
      apiFetch<Preferences>("/api/v1/me/preferences", {
        method: "PUT",
        body: JSON.stringify({ genres, countries, skipped: skipped ?? false }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PREFERENCE_KEYS.all });
      void queryClient.invalidateQueries({ queryKey: RECOMMENDATION_KEYS.all });
    },
  });
}

export function usePosterFeedback() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ liked, skipped }: PosterFeedbackInput) =>
      apiFetch<Preferences>("/api/v1/me/preferences/posters", {
        method: "POST",
        body: JSON.stringify({ liked, skipped: skipped ?? [] }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PREFERENCE_KEYS.all });
    },
  });
}

export function useResetPreferences() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<void>("/api/v1/me/preferences", { method: "DELETE" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PREFERENCE_KEYS.all });
      void queryClient.invalidateQueries({ queryKey: RECOMMENDATION_KEYS.all });
    },
  });
}

export function useRecommendations(limit = 20, enabled = true) {
  return useQuery({
    queryKey: RECOMMENDATION_KEYS.list(limit),
    queryFn: () =>
      apiFetch<RecommendationsResponse>(
        `/api/v1/me/recommendations?limit=${limit}`,
      ),
    enabled,
  });
}
