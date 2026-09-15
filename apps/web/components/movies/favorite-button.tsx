"use client";

import { useRouter } from "next/navigation";
import { Heart } from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toaster";
import { ApiError } from "@/lib/errors";
import { useFavoriteStatus, useToggleFavorite } from "@/lib/me";
import { cn } from "@/lib/utils";

interface Props {
  movieSlug: string;
  movieName: string;
  posterUrl: string | null;
}

export function FavoriteButton({ movieSlug, movieName, posterUrl }: Props) {
  const router = useRouter();
  const toast = useToast();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { data } = useFavoriteStatus(movieSlug, isAuthenticated);
  const toggle = useToggleFavorite(movieSlug);

  const isFavorite = data?.is_favorite ?? false;

  const onClick = () => {
    if (!isAuthenticated) {
      router.push(`/login?next=/phim/${movieSlug}`);
      return;
    }
    toggle.mutate(
      { isFavorite, movie_name: movieName, poster_url: posterUrl },
      {
        onSuccess: (nowFavorite) =>
          toast(
            nowFavorite ? "Đã thêm vào yêu thích." : "Đã bỏ khỏi yêu thích.",
            "success",
          ),
        onError: (e) => {
          if (e instanceof ApiError && e.status === 401) {
            router.push(`/login?next=/phim/${movieSlug}`);
          } else {
            toast("Không thể cập nhật yêu thích. Thử lại nhé.", "error");
          }
        },
      },
    );
  };

  return (
    <Button
      variant="secondary"
      size="lg"
      onClick={onClick}
      disabled={authLoading || toggle.isPending}
      aria-pressed={isFavorite}
    >
      <Heart
        className={cn(isFavorite && "fill-brand text-brand")}
      />
      {isFavorite ? "Đã yêu thích" : "Yêu thích"}
    </Button>
  );
}
