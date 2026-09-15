"use client";

import Link from "next/link";
import { History, Play } from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { useProgress } from "@/lib/me";
import type { Episode } from "@/lib/types";

function formatClock(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

interface Props {
  movieSlug: string;
  firstEpisode: Episode | null;
}

export function ResumeButton({ movieSlug, firstEpisode }: Props) {
  const { isAuthenticated } = useAuth();
  const { data: progress } = useProgress(movieSlug, isAuthenticated);

  if (progress && progress.position_seconds > 10) {
    return (
      <Button asChild size="lg">
        <Link href={`/xem/${movieSlug}/${progress.episode_slug}`}>
          <History /> Xem tiếp {progress.episode_name} từ{" "}
          {formatClock(progress.position_seconds)}
        </Link>
      </Button>
    );
  }

  if (!firstEpisode?.slug) {
    return (
      <Button size="lg" disabled>
        <Play /> Chưa có tập phim
      </Button>
    );
  }
  return (
    <Button asChild size="lg">
      <Link href={`/xem/${movieSlug}/${firstEpisode.slug}`}>
        <Play /> Xem ngay
      </Link>
    </Button>
  );
}
