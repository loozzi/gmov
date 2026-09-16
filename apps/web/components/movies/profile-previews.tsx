"use client";

import { MovieRail } from "@/components/movies/movie-rail";
import { useAuth } from "@/components/auth/auth-provider";
import { useContinueWatching, useFavorites, useWatchlist } from "@/lib/me";
import { progressLabel } from "@/lib/progress";
import type { MovieCard as MovieCardType } from "@/lib/types";

const PREVIEW_COUNT = 6;

interface LibraryItem {
  movie_slug: string;
  movie_name: string;
  poster_url: string | null;
}

function toCard(item: LibraryItem, currentEpisode: string | null = null): MovieCardType {
  return {
    slug: item.movie_slug,
    name: item.movie_name,
    original_name: null,
    thumb_url: item.poster_url,
    poster_url: item.poster_url,
    description: null,
    year: null,
    quality: null,
    language: null,
    current_episode: currentEpisode,
    total_episodes: null,
    time: null,
  };
}

/** Profile-page previews: a few favorites / watchlist / history entries,
 * each linking to the movie detail page. */
export function ProfilePreviews() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const favorites = useFavorites(1);
  const watchlist = useWatchlist(1);
  const progress = useContinueWatching(1);

  if (authLoading || !isAuthenticated) return null;

  const favoriteCards =
    favorites.data?.items.slice(0, PREVIEW_COUNT).map((f) => toCard(f)) ?? [];
  const watchlistCards =
    watchlist.data?.items.slice(0, PREVIEW_COUNT).map((f) => toCard(f)) ?? [];
  const historyCards =
    progress.data?.items
      .slice(0, PREVIEW_COUNT)
      .map((p) =>
        toCard(
          p,
          progressLabel(p.episode_index, p.total_episodes, p.episode_name),
        ),
      ) ?? [];

  return (
    <div className="space-y-6">
      <MovieRail
        title="Lịch sử xem"
        href="/me/history"
        movies={historyCards}
        emptyHint="Bạn chưa xem phim nào."
      />
      <MovieRail
        title="Muốn xem"
        href="/me/watchlist"
        movies={watchlistCards}
        emptyHint="Danh sách muốn xem đang trống."
      />
      <MovieRail
        title="Phim yêu thích"
        href="/me/favorites"
        movies={favoriteCards}
        emptyHint="Bạn chưa lưu phim yêu thích nào."
      />
    </div>
  );
}
