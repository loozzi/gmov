"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api";
import type { MovieCard } from "@/lib/types";

export interface Preferences {
  genres: Record<string, number>;
  countries: Record<string, number>;
  excluded_genres: string[];
  onboarding_completed_at: string | null;
  skipped: boolean;
  has_signals: boolean;
}

export interface SavePreferencesInput {
  genres: Record<string, number>;
  countries: Record<string, number>;
  excluded_genres?: string[];
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

export type FeedbackKind = "interested" | "not_interested";

export interface FeedbackItem {
  movie: MovieCard;
  kind: FeedbackKind;
  created_at: string;
}

export interface Taste {
  genre_weights: Record<string, number>;
  sources: Record<string, Record<string, number>>;
  country_weights: Record<string, number>;
  excluded_genres: string[];
  feedback: FeedbackItem[];
  has_signals: boolean;
  onboarding_completed_at: string | null;
  skipped: boolean;
}

export const TASTE_SOURCE_LABELS: Record<string, string> = {
  explicit: "bạn chọn",
  favorite: "yêu thích",
  rating: "đánh giá",
  finished: "xem xong",
  in_progress: "đang xem",
  watchlist: "muốn xem",
  feedback: "phản hồi",
};

export const PREFERENCE_KEYS = {
  all: ["me", "preferences"] as const,
};

export const RECOMMENDATION_KEYS = {
  all: ["me", "recommendations"] as const,
  list: (limit: number) => ["me", "recommendations", limit] as const,
};

export const TASTE_KEYS = {
  all: ["me", "taste"] as const,
};

export function usePreferences(enabled = true) {
  return useQuery({
    queryKey: PREFERENCE_KEYS.all,
    queryFn: () => apiFetch<Preferences>("/api/v1/me/preferences"),
    enabled,
  });
}

export function useTaste(enabled = true) {
  return useQuery({
    queryKey: TASTE_KEYS.all,
    queryFn: () => apiFetch<Taste>("/api/v1/me/taste"),
    enabled,
  });
}

export function useSavePreferences() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      genres,
      countries,
      excluded_genres,
      skipped,
    }: SavePreferencesInput) =>
      apiFetch<Preferences>("/api/v1/me/preferences", {
        method: "PUT",
        body: JSON.stringify({
          genres,
          countries,
          excluded_genres: excluded_genres ?? [],
          skipped: skipped ?? false,
        }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PREFERENCE_KEYS.all });
      void queryClient.invalidateQueries({ queryKey: TASTE_KEYS.all });
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
      void queryClient.invalidateQueries({ queryKey: TASTE_KEYS.all });
      void queryClient.invalidateQueries({ queryKey: RECOMMENDATION_KEYS.all });
    },
  });
}

export function useRecommendationFeedback() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      movie_slug,
      kind,
    }: {
      movie_slug: string;
      kind: FeedbackKind;
    }) =>
      apiFetch<{ movie_slug: string; kind: FeedbackKind }>(
        "/api/v1/me/recommendations/feedback",
        { method: "POST", body: JSON.stringify({ movie_slug, kind }) },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: TASTE_KEYS.all });
      void queryClient.invalidateQueries({ queryKey: PREFERENCE_KEYS.all });
      void queryClient.invalidateQueries({ queryKey: RECOMMENDATION_KEYS.all });
    },
  });
}

export function useUndoRecommendationFeedback() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (movieSlug: string) =>
      apiFetch<{ ok: boolean }>(
        `/api/v1/me/recommendations/feedback/${encodeURIComponent(movieSlug)}`,
        { method: "DELETE" },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: TASTE_KEYS.all });
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
