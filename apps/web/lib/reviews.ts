"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  keepPreviousData,
} from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

export interface RatingSummary {
  average: number | null;
  count: number;
}

export interface MyRatingStatus {
  stars: number | null;
}

export interface RateResponse {
  movie_slug: string;
  stars: number;
}

export interface CommentUser {
  username: string;
  display_name: string;
}

export interface CommentReply {
  id: string;
  user: CommentUser;
  body: string | null;
  is_hidden: boolean;
  created_at: string;
}

export interface MovieComment {
  id: string;
  movie_slug: string;
  user: CommentUser;
  body: string | null;
  is_hidden: boolean;
  created_at: string;
  replies: CommentReply[];
  reply_count: number;
}

export interface PaginatedComments {
  items: MovieComment[];
  page: number;
  per_page: number;
  total_items: number;
}

export function useRatingSummary(movieSlug: string) {
  return useQuery({
    queryKey: ["reviews", "rating-summary", movieSlug],
    queryFn: () =>
      apiFetch<RatingSummary>(`/api/v1/movies/${movieSlug}/rating`, {
        auth: false,
      }),
    staleTime: 30_000,
  });
}

export function useMyRating(movieSlug: string, enabled = true) {
  return useQuery({
    queryKey: ["reviews", "my-rating", movieSlug],
    queryFn: () =>
      apiFetch<MyRatingStatus>(`/api/v1/me/ratings/${movieSlug}/status`),
    enabled,
    retry: false,
    staleTime: 30_000,
  });
}

export function useRate(movieSlug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (stars: number) =>
      apiFetch<RateResponse>("/api/v1/me/ratings", {
        method: "PUT",
        body: JSON.stringify({ movie_slug: movieSlug, stars }),
      }),
    onMutate: async (stars) => {
      await queryClient.cancelQueries({
        queryKey: ["reviews", "my-rating", movieSlug],
      });
      const previous = queryClient.getQueryData<MyRatingStatus>([
        "reviews",
        "my-rating",
        movieSlug,
      ]);
      queryClient.setQueryData(["reviews", "my-rating", movieSlug], {
        stars,
      });
      return { previous };
    },
    onError: (_e, _v, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          ["reviews", "my-rating", movieSlug],
          context.previous,
        );
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: ["reviews", "my-rating", movieSlug],
      });
      void queryClient.invalidateQueries({
        queryKey: ["reviews", "rating-summary", movieSlug],
      });
    },
  });
}

export function useRemoveRating(movieSlug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<{ ok: boolean }>(`/api/v1/me/ratings/${movieSlug}`, {
        method: "DELETE",
      }),
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: ["reviews", "my-rating", movieSlug],
      });
      void queryClient.invalidateQueries({
        queryKey: ["reviews", "rating-summary", movieSlug],
      });
    },
  });
}

export function useComments(movieSlug: string, page = 1) {
  return useQuery({
    queryKey: ["reviews", "comments", movieSlug, page],
    queryFn: () =>
      apiFetch<PaginatedComments>(
        `/api/v1/comments?movie_slug=${encodeURIComponent(movieSlug)}&page=${page}&per_page=20`,
        { auth: true },
      ),
    placeholderData: keepPreviousData,
  });
}

export function useAddComment(movieSlug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { body: string; parent_id?: string }) =>
      apiFetch<MovieComment>("/api/v1/me/comments", {
        method: "POST",
        body: JSON.stringify({
          movie_slug: movieSlug,
          body: input.body,
          ...(input.parent_id ? { parent_id: input.parent_id } : {}),
        }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["reviews", "comments", movieSlug],
      });
    },
  });
}

export function useDeleteComment(movieSlug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (commentId: string) =>
      apiFetch<{ ok: boolean }>(`/api/v1/me/comments/${commentId}`, {
        method: "DELETE",
      }),
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: ["reviews", "comments", movieSlug],
      });
    },
  });
}
