"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useRatingSummary } from "@/lib/reviews";

interface Props {
  movieSlug: string;
}

export function RatingSummary({ movieSlug }: Props) {
  const { data, isLoading } = useRatingSummary(movieSlug);

  if (isLoading) {
    return <Skeleton className="h-5 w-44" aria-label="Đang tải đánh giá" />;
  }

  if (!data || data.average === null || data.count === 0) {
    return (
      <p className="text-sm text-muted-foreground">Chưa có đánh giá</p>
    );
  }

  return (
    <p className="text-sm text-muted-foreground" aria-live="polite">
      ★ {data.average.toFixed(1)} ({data.count} lượt đánh giá)
    </p>
  );
}
