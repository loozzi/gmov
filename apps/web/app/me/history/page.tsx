"use client";

import Link from "next/link";
import { useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  History,
  Play,
  Trash2,
} from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { PosterThumb } from "@/components/movies/poster-thumb";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toaster";
import { toVietnameseMessage } from "@/lib/errors";
import { useContinueWatching, useDeleteProgress } from "@/lib/me";
import { progressLabel, progressPercent, seriesLabel } from "@/lib/progress";

function formatClock(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function HistoryPage() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const { data, isLoading, isError, error } = useContinueWatching(page);
  const del = useDeleteProgress();

  if (authLoading || isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card p-12 text-center">
        <p className="text-sm text-muted-foreground">
          Bạn cần đăng nhập để xem lịch sử.
        </p>
        <Button asChild>
          <Link href="/login?next=/me/history">Đăng nhập</Link>
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

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-bold">Lịch sử xem</h1>
      {!data || data.items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card p-12 text-center">
          <History className="size-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Bạn chưa xem phim nào. Bắt đầu ngay thôi!
          </p>
          <Button variant="secondary" asChild>
            <Link href="/">Khám phá phim hay</Link>
          </Button>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {data.items.map((p) => {
              const label = progressLabel(
                p.episode_index,
                p.total_episodes,
                p.episode_name,
              );
              const hasSeries =
                seriesLabel(p.episode_index, p.total_episodes) != null;
              return (
                <div
                  key={p.id}
                  className="flex items-center gap-3 rounded-xl border border-border bg-card p-3"
                >
                  <Link
                    href={`/phim/${p.movie_slug}`}
                    className="relative aspect-[2/3] w-12 shrink-0 overflow-hidden rounded-md bg-muted"
                  >
                    <PosterThumb
                      src={p.poster_url}
                      alt={p.movie_name}
                      sizes="48px"
                    />
                  </Link>
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/phim/${p.movie_slug}`}
                      className="truncate text-sm font-semibold hover:text-brand"
                    >
                      {p.movie_name}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {label}
                      {p.server_name ? ` · ${p.server_name}` : ""}
                      {p.duration_seconds && p.duration_seconds > 0 ? (
                        p.position_seconds >= 0.9 * p.duration_seconds ? (
                          <> · <span className="text-green-400">Đã xem xong</span></>
                        ) : (
                          <> · đã xem {formatClock(p.position_seconds)}</>
                        )
                      ) : (
                        <> · đã xem {formatClock(p.position_seconds)}</>
                      )}
                    </p>
                    {hasSeries || p.duration_seconds ? (
                      <div className="mt-1.5 h-1 max-w-xs overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-brand"
                          style={{
                            width: `${progressPercent(
                              p.episode_index,
                              p.total_episodes,
                              p.position_seconds,
                              p.duration_seconds,
                            )}%`,
                          }}
                        />
                      </div>
                    ) : null}
                  </div>
                  <Button size="sm" asChild>
                    <Link href={`/xem/${p.movie_slug}/${p.episode_slug}`}>
                      <Play /> Xem tiếp
                    </Link>
                  </Button>
                  <button
                    onClick={() =>
                      del.mutate(p.movie_slug, {
                        onSuccess: () => toast("Đã xóa khỏi lịch sử.", "success"),
                        onError: () => toast("Xóa thất bại. Thử lại nhé.", "error"),
                      })
                    }
                    aria-label={`Xóa lịch sử ${p.movie_name}`}
                    className="cursor-pointer rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-red-400"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              );
            })}
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
              Trang {data.page} /{" "}
              {Math.max(1, Math.ceil(data.total_items / data.per_page))}
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
