"use client";

import Link from "next/link";
import { Play } from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { Skeleton } from "@/components/ui/skeleton";
import { useContinueWatching } from "@/lib/me";
import { progressLabel, progressPercent } from "@/lib/progress";

function formatTime(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}` : `${m} phút`;
}

export function ContinueWatchingRail() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { data, isLoading } = useContinueWatching(1);

  if (authLoading) {
    return (
      <div className="flex gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-64 shrink-0" />
        ))}
      </div>
    );
  }
  if (!isAuthenticated || isLoading || !data || data.items.length === 0) {
    return null;
  }

  return (
    <section className="group/rail space-y-2">
      <div className="flex items-baseline gap-2">
        <h2 className="text-lg font-semibold sm:text-xl">Xem tiếp</h2>
        <Link
          href="/me/history"
          className="flex items-center gap-0.5 text-xs font-medium text-muted-foreground opacity-100 transition-all duration-200 group-hover/rail:translate-x-1 hover:text-brand sm:opacity-0 sm:group-hover/rail:opacity-100"
        >
          Lịch sử xem
        </Link>
      </div>
      <div className="rail-scroll -mx-4 flex gap-4 overflow-x-auto px-4 pb-2">
        {data.items.slice(0, 10).map((p) => {
          const label = progressLabel(
            p.episode_index,
            p.total_episodes,
            p.episode_name,
          );
          const ratio = progressPercent(
            p.episode_index,
            p.total_episodes,
            p.position_seconds,
            p.duration_seconds,
          );
          const remaining =
            p.duration_seconds && p.duration_seconds > p.position_seconds
              ? ` · còn ${formatTime(p.duration_seconds - p.position_seconds)}`
              : "";
          return (
            <Link
              key={p.id}
              href={`/xem/${p.movie_slug}/${p.episode_slug}`}
              className="group w-64 shrink-0 overflow-hidden rounded-lg bg-card transition-all duration-200 hover:z-10 hover:scale-[1.03] hover:shadow-2xl sm:w-72"
            >
              <div className="relative flex aspect-video items-center justify-center bg-gradient-to-br from-muted via-card to-muted">
                <span className="flex size-12 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                  <Play className="size-5 fill-white" />
                </span>
                <span className="absolute bottom-2 left-2 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-semibold text-white">
                  {label}
                </span>
              </div>
              <div className="space-y-1 p-3">
                <p className="truncate text-sm font-semibold group-hover:text-brand">
                  {p.movie_name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {label}
                  {remaining}
                </p>
                <div className="h-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-brand"
                    style={{ width: `${ratio}%` }}
                  />
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
