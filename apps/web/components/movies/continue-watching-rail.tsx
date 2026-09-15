"use client";

import Link from "next/link";
import { Play } from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useContinueWatching } from "@/lib/me";

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
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">Xem tiếp</h2>
        <Link
          href="/me/history"
          className="text-sm text-muted-foreground hover:text-brand"
        >
          Lịch sử xem
        </Link>
      </div>
      <div className="rail-scroll -mx-4 flex gap-4 overflow-x-auto px-4 pb-2">
        {data.items.slice(0, 10).map((p) => {
          const ratio =
            p.duration_seconds && p.duration_seconds > 0
              ? Math.min(100, (p.position_seconds / p.duration_seconds) * 100)
              : 0;
          const remaining =
            p.duration_seconds && p.duration_seconds > p.position_seconds
              ? ` · còn ${formatTime(p.duration_seconds - p.position_seconds)}`
              : "";
          return (
            <Link
              key={p.id}
              href={`/xem/${p.movie_slug}/${p.episode_slug}`}
              className="group w-64 shrink-0 overflow-hidden rounded-xl border border-border bg-card hover:border-brand"
            >
              <div className="space-y-1 p-3">
                <p className="truncate text-sm font-semibold group-hover:text-brand">
                  {p.movie_name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {p.episode_name}
                  {remaining}
                </p>
                <div className="h-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-brand"
                    style={{ width: `${ratio}%` }}
                  />
                </div>
                <Button size="sm" variant="secondary" className="mt-2 w-full">
                  <Play /> Xem tiếp
                </Button>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
