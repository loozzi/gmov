"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bookmark } from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toaster";
import { ApiError } from "@/lib/errors";
import { useToggleWatchlist, useWatchlistStatus } from "@/lib/me";
import { cn } from "@/lib/utils";

interface Props {
  movieSlug: string;
  movieName: string;
  posterUrl: string | null;
}

export function WatchlistButton({ movieSlug, movieName, posterUrl }: Props) {
  const router = useRouter();
  const toast = useToast();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { data } = useWatchlistStatus(movieSlug, isAuthenticated);
  const toggle = useToggleWatchlist(movieSlug);
  const [pop, setPop] = useState(false);

  const isSaved = data?.is_saved ?? false;

  const onClick = () => {
    if (!isAuthenticated) {
      router.push(`/login?next=/phim/${movieSlug}`);
      return;
    }
    toggle.mutate(
      { isSaved, movie_name: movieName, poster_url: posterUrl },
      {
        onSuccess: (nowSaved) => {
          setPop(true);
          toast(
            nowSaved
              ? "Đã thêm vào danh sách muốn xem."
              : "Đã xóa khỏi danh sách muốn xem.",
            "success",
          );
        },
        onError: (e) => {
          if (e instanceof ApiError && e.status === 401) {
            router.push(`/login?next=/phim/${movieSlug}`);
          } else {
            toast("Không thể cập nhật danh sách. Thử lại nhé.", "error");
          }
        },
      },
    );
  };

  return (
    <Button
      variant="outline"
      size="lg"
      onClick={onClick}
      disabled={authLoading || toggle.isPending}
      aria-pressed={isSaved}
    >
      <Bookmark
        onAnimationEnd={() => setPop(false)}
        className={cn(isSaved && "fill-brand text-brand", pop && "animate-pop")}
      />
      {isSaved ? "Đã lưu" : "Muốn xem"}
    </Button>
  );
}
