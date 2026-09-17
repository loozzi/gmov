"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  keepPreviousData,
} from "@tanstack/react-query";

import { useAuth } from "@/components/auth/auth-provider";
import { apiFetch } from "@/lib/api";
import {
  removeGuestProgress,
  useGuestProgressEntry,
  useGuestProgressList,
  type GuestProgressEntry,
} from "@/lib/guest-progress";

export interface Progress {
  id: string;
  movie_slug: string;
  movie_name: string;
  poster_url: string | null;
  episode_slug: string;
  episode_name: string;
  server_name: string | null;
  episode_index: number | null;
  total_episodes: number | null;
  position_seconds: number;
  duration_seconds: number | null;
  updated_at: string;
}

export interface PaginatedProgress {
  items: Progress[];
  page: number;
  per_page: number;
  total_items: number;
}

/** A local entry carries every server field except the row id. */
function entryToProgress(entry: GuestProgressEntry): Progress {
  return { id: entry.movie_slug, ...entry };
}

export interface ProgressResult {
  data: Progress | null;
  isFetched: boolean;
}

export interface ContinueWatchingResult {
  data: PaginatedProgress | null;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
}

export interface Favorite {
  id: string;
  movie_slug: string;
  movie_name: string;
  poster_url: string | null;
  created_at: string;
}

export interface PaginatedFavorites {
  items: Favorite[];
  page: number;
  per_page: number;
  total_items: number;
}

/**
 * Server progress for logged-in users, localStorage progress for guests, so
 * every consumer (player resume, detail "Xem tiếp", history) stays unaware of
 * where the row lives.
 */
export function useContinueWatching(page = 1): ContinueWatchingResult {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const query = useQuery({
    queryKey: ["me", "continue-watching", page],
    queryFn: () =>
      apiFetch<PaginatedProgress>(
        `/api/v1/me/continue-watching?page=${page}&per_page=20`,
      ),
    placeholderData: keepPreviousData,
    enabled: isAuthenticated,
  });
  const guest = useGuestProgressList();

  if (isAuthenticated) {
    return {
      data: query.data ?? null,
      isLoading: query.isLoading,
      isError: query.isError,
      error: query.error,
    };
  }

  const items = guest.map(entryToProgress);
  return {
    data: {
      items,
      page: 1,
      per_page: Math.max(items.length, 1),
      total_items: items.length,
    },
    isLoading: authLoading,
    isError: false,
    error: null,
  };
}

export function useProgress(movieSlug: string): ProgressResult {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const query = useQuery({
    queryKey: ["me", "progress", movieSlug],
    queryFn: () => apiFetch<Progress>(`/api/v1/me/progress/${movieSlug}`),
    enabled: isAuthenticated,
    retry: false,
    staleTime: 30_000,
  });
  const guest = useGuestProgressEntry(movieSlug);

  if (isAuthenticated) {
    return { data: query.data ?? null, isFetched: query.isFetched };
  }
  // Guest rows are already local and synchronous: settled once auth resolved.
  return {
    data: guest ? entryToProgress(guest) : null,
    isFetched: !authLoading,
  };
}

export function useFavorites(page = 1) {
  return useQuery({
    queryKey: ["me", "favorites", page],
    queryFn: () =>
      apiFetch<PaginatedFavorites>(
        `/api/v1/me/favorites?page=${page}&per_page=20`,
      ),
    placeholderData: keepPreviousData,
  });
}

export function useFavoriteStatus(movieSlug: string, enabled = true) {
  return useQuery({
    queryKey: ["me", "favorite-status", movieSlug],
    queryFn: () =>
      apiFetch<{ is_favorite: boolean }>(
        `/api/v1/me/favorites/${movieSlug}/status`,
      ),
    enabled,
    retry: false,
    staleTime: 30_000,
  });
}

export function useToggleFavorite(movieSlug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      isFavorite: boolean;
      movie_name: string;
      poster_url: string | null;
    }) => {
      if (input.isFavorite) {
        await apiFetch(`/api/v1/me/favorites/${movieSlug}`, {
          method: "DELETE",
        });
        return false;
      }
      await apiFetch("/api/v1/me/favorites", {
        method: "POST",
        body: JSON.stringify({
          movie_slug: movieSlug,
          movie_name: input.movie_name,
          poster_url: input.poster_url,
        }),
      });
      return true;
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({
        queryKey: ["me", "favorite-status", movieSlug],
      });
      const previous = queryClient.getQueryData<{
        is_favorite: boolean;
      }>(["me", "favorite-status", movieSlug]);
      queryClient.setQueryData(["me", "favorite-status", movieSlug], {
        is_favorite: !input.isFavorite,
      });
      return { previous };
    },
    onError: (_e, _v, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          ["me", "favorite-status", movieSlug],
          context.previous,
        );
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: ["me", "favorite-status", movieSlug],
      });
      void queryClient.invalidateQueries({ queryKey: ["me", "favorites"] });
    },
  });
}

export function useRemoveFavorite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (movieSlug: string) =>
      apiFetch(`/api/v1/me/favorites/${movieSlug}`, { method: "DELETE" }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["me", "favorites"] });
    },
  });
}

export interface WatchlistItem {
  id: string;
  movie_slug: string;
  movie_name: string;
  poster_url: string | null;
  created_at: string;
}

export interface PaginatedWatchlist {
  items: WatchlistItem[];
  page: number;
  per_page: number;
  total_items: number;
}

export function useWatchlist(page = 1) {
  return useQuery({
    queryKey: ["me", "watchlist", page],
    queryFn: () =>
      apiFetch<PaginatedWatchlist>(
        `/api/v1/me/watchlist?page=${page}&per_page=20`,
      ),
    placeholderData: keepPreviousData,
  });
}

export function useWatchlistStatus(movieSlug: string, enabled = true) {
  return useQuery({
    queryKey: ["me", "watchlist-status", movieSlug],
    queryFn: () =>
      apiFetch<{ is_saved: boolean }>(
        `/api/v1/me/watchlist/${movieSlug}/status`,
      ),
    enabled,
    retry: false,
    staleTime: 30_000,
  });
}

export function useToggleWatchlist(movieSlug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      isSaved: boolean;
      movie_name: string;
      poster_url: string | null;
    }) => {
      if (input.isSaved) {
        await apiFetch(`/api/v1/me/watchlist/${movieSlug}`, {
          method: "DELETE",
        });
        return false;
      }
      await apiFetch("/api/v1/me/watchlist", {
        method: "POST",
        body: JSON.stringify({
          movie_slug: movieSlug,
          movie_name: input.movie_name,
          poster_url: input.poster_url,
        }),
      });
      return true;
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({
        queryKey: ["me", "watchlist-status", movieSlug],
      });
      const previous = queryClient.getQueryData<{
        is_saved: boolean;
      }>(["me", "watchlist-status", movieSlug]);
      queryClient.setQueryData(["me", "watchlist-status", movieSlug], {
        is_saved: !input.isSaved,
      });
      return { previous };
    },
    onError: (_e, _v, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          ["me", "watchlist-status", movieSlug],
          context.previous,
        );
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: ["me", "watchlist-status", movieSlug],
      });
      void queryClient.invalidateQueries({ queryKey: ["me", "watchlist"] });
    },
  });
}

export function useRemoveWatchlist() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (movieSlug: string) =>
      apiFetch(`/api/v1/me/watchlist/${movieSlug}`, { method: "DELETE" }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["me", "watchlist"] });
    },
  });
}

export function useDeleteProgress() {
  const queryClient = useQueryClient();
  const { isAuthenticated } = useAuth();
  return useMutation({
    mutationFn: (movieSlug: string) =>
      isAuthenticated
        ? apiFetch(`/api/v1/me/progress/${movieSlug}`, { method: "DELETE" })
        : Promise.resolve(removeGuestProgress(movieSlug)),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["me"] });
    },
  });
}

export interface ProgressUpsert {
  movie_slug: string;
  movie_name: string;
  poster_url: string | null;
  episode_slug: string;
  episode_name: string;
  server_name: string | null;
  episode_index: number | null;
  total_episodes: number | null;
  position_seconds: number;
  duration_seconds: number | null;
}

export function useUpsertProgress() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ProgressUpsert) =>
      apiFetch("/api/v1/me/progress", {
        method: "PUT",
        body: JSON.stringify(input),
      }),
    onSettled: (_d, _e, input) => {
      void queryClient.invalidateQueries({
        queryKey: ["me", "progress", input.movie_slug],
      });
      void queryClient.invalidateQueries({
        queryKey: ["me", "continue-watching"],
      });
      // Starting to watch drops the movie from the watchlist server-side
      // (progress upsert), so refresh both the list and the toggle status.
      void queryClient.invalidateQueries({ queryKey: ["me", "watchlist"] });
      void queryClient.invalidateQueries({
        queryKey: ["me", "watchlist-status", input.movie_slug],
      });
    },
  });
}

/** Fire-and-forget save for unload; keepalive preserves auth headers. */
export async function sendProgressKeepalive(
  input: ProgressUpsert,
  accessToken: string,
): Promise<void> {
  try {
    await fetch("/api/v1/me/progress", {
      method: "PUT",
      keepalive: true,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(input),
    });
  } catch {
    // Unload path: nothing more we can do.
  }
}

export function useWatched(movieSlug: string, enabled = true) {
  return useQuery({
    queryKey: ["me", "watched", movieSlug],
    queryFn: () =>
      apiFetch<{ episode_slugs: string[] }>(`/api/v1/me/watched/${movieSlug}`),
    enabled,
    retry: false,
    staleTime: 30_000,
  });
}

export function useMarkWatched(movieSlug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      movie_name: string;
      episode_slug: string;
      episode_name: string;
      poster_url: string | null;
      server_name: string | null;
      episode_index?: number | null;
      total_episodes?: number | null;
    }) =>
      apiFetch("/api/v1/me/watched", {
        method: "POST",
        body: JSON.stringify({ movie_slug: movieSlug, ...input }),
      }),
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: ["me", "watched", movieSlug],
      });
      void queryClient.invalidateQueries({
        queryKey: ["me", "continue-watching"],
      });
      // The explicit marker also writes progress, which drops the movie from
      // the watchlist server-side.
      void queryClient.invalidateQueries({ queryKey: ["me", "watchlist"] });
      void queryClient.invalidateQueries({
        queryKey: ["me", "watchlist-status", movieSlug],
      });
    },
  });
}
