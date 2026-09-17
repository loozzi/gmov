"use client";

import Link from "next/link";
import { History, Play } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useProgress } from "@/lib/me";
import { progressLabel } from "@/lib/progress";
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
  const { data: progress } = useProgress(movieSlug);

  // Any history row means the movie is in progress: continue at the episode
  // that was last recorded. Embed mode stores no playtime (0s/0s registration
  // or a 1s/1s watched marker), so only show a clock when it is meaningful.
  if (progress) {
    const fromTime =
      progress.position_seconds > 10
        ? ` từ ${formatClock(progress.position_seconds)}`
        : "";
    return (
      <Button asChild size="lg">
        <Link href={`/xem/${movieSlug}/${progress.episode_slug}`}>
          <History /> Xem tiếp{" "}
          {progressLabel(
            progress.episode_index,
            progress.total_episodes,
            progress.episode_name,
          )}
          {fromTime}
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
