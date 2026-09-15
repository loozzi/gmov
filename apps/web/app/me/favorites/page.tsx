"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronLeft, ChevronRight, HeartCrack, Trash2 } from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { MovieCard } from "@/components/movies/movie-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toaster";
import { toVietnameseMessage } from "@/lib/errors";
import { useFavorites, useRemoveFavorite } from "@/lib/me";
import type { MovieCard as MovieCardType } from "@/lib/types";

export default function FavoritesPage() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const { data, isLoading, isError, error } = useFavorites(page);
  const remove = useRemoveFavorite();

  if (authLoading || isLoading) {
    return (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {Array.from({ length: 10 }).map((_, i) => (
          <Skeleton key={i} className="aspect-[2/3] w-full" />
        ))}
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card p-12 text-center">
        <p className="text-sm text-muted-foreground">
          Bạn cần đăng nhập để xem danh sách yêu thích.
        </p>
        <Button asChild>
          <Link href="/login?next=/me/favorites">Đăng nhập</Link>
        </Button>
      </div>
    );
  }

  if (isError) {
    return (
      <p className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
        {toVietnameseMessage(error)}
      </p>
    );
  }

  const toCard = (f: {
    movie_slug: string;
    movie_name: string;
    poster_url: string | null;
  }): MovieCardType => ({
    slug: f.movie_slug,
    name: f.movie_name,
    original_name: null,
    thumb_url: f.poster_url,
    poster_url: f.poster_url,
    description: null,
    year: null,
    quality: null,
    language: null,
    current_episode: null,
    total_episodes: null,
    time: null,
  });

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-bold">Phim yêu thích</h1>
      {!data || data.items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card p-12 text-center">
          <HeartCrack className="size-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Bạn chưa lưu phim nào. Nhấn trái tim ở trang chi tiết để lưu lại nhé.
          </p>
          <Button variant="secondary" asChild>
            <Link href="/">Khám phá phim hay</Link>
          </Button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {data.items.map((f) => (
              <div key={f.id} className="relative">
                <MovieCard movie={toCard(f)} />
                <button
                  onClick={() =>
                    remove.mutate(f.movie_slug, {
                      onSuccess: () => toast("Đã bỏ khỏi yêu thích.", "success"),
                      onError: () => toast("Xóa thất bại. Thử lại nhé.", "error"),
                    })
                  }
                  aria-label={`Bỏ thích ${f.movie_name}`}
                  className="absolute top-2 right-2 cursor-pointer rounded-md bg-black/70 p-1.5 text-white hover:text-brand"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-center gap-3 pt-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              <ChevronLeft /> Trước
            </Button>
            <span className="text-sm text-muted-foreground">
              Trang {data.page} / {Math.max(1, Math.ceil(data.total_items / data.per_page))}
            </span>
            <Button
              variant="secondary"
              size="sm"
              disabled={data.page * data.per_page >= data.total_items}
              onClick={() => setPage(page + 1)}
            >
              Sau <ChevronRight />
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
